export interface Env {
	R2_BUCKET: R2Bucket;
}

const CACHE_FOREVER = 'public, max-age=31536000, immutable';
const CACHE_HEAD = 'public, max-age=600';
const CACHE_LATEST = 'public, max-age=1800, stale-while-revalidate=1800, stale-if-error=86400';

async function getContents(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const cache = caches.default;

	if (url.pathname === '/') {
		return new Response('maps-metadata');
	}

	const path = url.pathname.slice(1).split('/');
	if (path[path.length - 1] === '') {
		return new Response('No index support', { status: 404 });
	}

	// Load HEAD value when fetching /HEAD or from /latest/*
	let headCacheHit: boolean | null = null;
	let head = '';
	if (url.pathname === '/HEAD' || url.pathname.startsWith('/latest/')) {
		const headReq = new Request(new URL('/HEAD', url.origin));
		const headCache = await cache.match(headReq);
		if (headCache) {
			head = await headCache.text();
			headCacheHit = true;
		} else {
			headCacheHit = false;
			const headObj = await env.R2_BUCKET.get('HEAD');
			if (!headObj) {
				return new Response('Not found', { status: 404 });
			}
			head = await headObj.text();

			ctx.waitUntil(cache.put(headReq, new Response(head, {
				headers: { 'cache-control': CACHE_HEAD }
			})));
		}
	}

	const commit = head !== '' ? head : path[0];

	function setHeaders(headers: Headers, cacheHit: boolean) {
		headers.set('x-maps-metadata-cache', cacheHit ? 'hit' : 'miss');
		if (headCacheHit !== null) {
			headers.set('x-maps-metadata-head-cache', headCacheHit ? 'hit' : 'miss');
		}
		headers.set('x-maps-metadata-commit', commit);
		headers.set('access-control-allow-origin', '*');
		if (path[0] === 'latest') {
			headers.set('cache-control', CACHE_LATEST);
		} else {
			headers.set('cache-control', CACHE_FOREVER);
		}
	}

	if (url.pathname === '/HEAD') {
		const headers = new Headers();
		setHeaders(headers, headCacheHit!);
		headers.set('content-type', 'text/plain');
		headers.set('cache-control', CACHE_HEAD);
		return new Response(head, { headers });
	}

	const objectPath = `${commit}/${path.slice(1).join('/')}`;

	// Try to get load object from cache
	const objectReq = new Request(new URL(objectPath, url.origin), request);
	const objectCache = await cache.match(objectReq);
	if (objectCache) {
		const response = new Response(objectCache.body, objectCache);
		setHeaders(response.headers, true);
		return response;
	}

	// Fallback to loading from R2
	const object = await env.R2_BUCKET.get(objectPath);
	if (!object) {
		return new Response('Not found', { status: 404 });
	}

	// Put object from R2 in cache
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('cache-control', CACHE_FOREVER);
	const response = new Response(object.body, { headers });
	ctx.waitUntil(cache.put(objectReq, response.clone()));

	setHeaders(response.headers, false);
	return response;
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		try {
			const allowedMethods = ['GET', 'HEAD'];
			if (!allowedMethods.includes(request.method)) {
				return new Response('Method not allowed', {
					status: 405, headers: { 'allow': allowedMethods.join(', ') }
				});
			}

			return await getContents(request, env, ctx);
		} catch (e: any) {
			return new Response(`Internal error: ${e.stack}`, { status: 500 });
		}
	},
};
