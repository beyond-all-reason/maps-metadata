export interface Env {
	R2_MAPS_METADATA: R2Bucket;
	R2_IMAGOR_RESULTS: R2Bucket;
	IMAGOR_URL: string;
}

const CACHE_FOREVER = 'public, max-age=31536000, immutable';
const CACHE_HEAD = 'public, max-age=600';
const CACHE_LATEST = 'public, max-age=1800, stale-while-revalidate=1800, stale-if-error=86400';

// This function is super delicate, and requires also correct configuration of S3_SAFE_CHARS env
// variable in the imagor service. As of version 1.4.4 it should be set to `' ":,`.
function escapeImagorResultsPath(path: string): string {
	let encoded = encodeURIComponent(path.replace(/[\r\n\v\f\u0085\u2028\u2029]+/g, ''));
	for (const c of `/" :,`) {
		encoded = encoded.replaceAll(encodeURIComponent(c), c);
	}
	return encoded;
}

async function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

class Retryable extends Error { }
class RetryLimitExceeded extends Error { }

async function exponentialRetry<T>(maxRetry: number, baseDelayMs: number, func: () => Promise<T>): Promise<T> {
	for (let retry = 0; retry < maxRetry; ++retry) {
		try {
			return await func();
		} catch (e) {
			if (!(e instanceof Retryable)) {
				throw e;
			}
			await sleep((2 ** retry * baseDelayMs) * (0.5 + Math.random()));
		}
	}
	throw new RetryLimitExceeded();
}

async function getImage(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const cache = caches.default;

	// Try to get load object from cache
	const cacheKey = new Request(new URL(url.pathname, url.origin), request);
	const cachedRes = await cache.match(cacheKey);
	if (cachedRes) {
		const response = new Response(cachedRes.body, cachedRes);
		response.headers.set('x-maps-metadata-imagor-cache', 'hit');
		return response;
	}

	const path = url.pathname.substring('/i/'.length);
	const objectPath = escapeImagorResultsPath(path);
	let object = await env.R2_IMAGOR_RESULTS.get(objectPath);
	let r2Hit = true;
	if (!object) {
		r2Hit = false;
		const res = await fetch(`${env.IMAGOR_URL}/unsafe/${path}`);
		if (!res.ok) {
			return new Response(`Imagor failed: ${await res.text()}`, { status: res.status });
		}

		// Wait for imagor result to be available in R2 bucket.
		try {
			object = await exponentialRetry(7, 20, async () => {
				const object = await env.R2_IMAGOR_RESULTS.get(objectPath);
				if (!object) {
					throw new Retryable();
				}
				return object;
			});
		} catch (e) {
			if (e instanceof RetryLimitExceeded) {
				return new Response(`Failed to resolve object in imagor result storage path: ${objectPath}`, { status: 404 });
			}
			throw e;
		}
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('cache-control', CACHE_FOREVER);
	headers.set('x-maps-metadata-imagor-cache', r2Hit ? 'r2-hit' : 'miss');
	const response = new Response(object.body, { headers });
	ctx.waitUntil(cache.put(cacheKey, response.clone()));
	return response;
}

async function getFile(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const cache = caches.default;

	const path = url.pathname.slice(1).split('/');
	if (path[path.length - 1] === '') {
		return new Response('No index support', { status: 404 });
	}

	const disableCache = request.headers.get('cache-control') === 'no-cache';

	// Load HEAD value when fetching /HEAD or from /latest/*
	let headCacheHit: boolean | null = null;
	let head = '';
	if (url.pathname === '/HEAD' || url.pathname.startsWith('/latest/')) {
		const headReq = new Request(new URL('/HEAD', url.origin));
		const headCache = disableCache ? undefined : await cache.match(headReq);
		if (headCache) {
			head = await headCache.text();
			headCacheHit = true;
		} else {
			headCacheHit = false;
			const headObj = await env.R2_MAPS_METADATA.get('HEAD');
			if (!headObj) {
				return new Response('Not found', { status: 404 });
			}
			head = await headObj.text();

			if (!disableCache) ctx.waitUntil(cache.put(headReq, new Response(head, {
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

	const shouldRedirect = path[path.length - 1].startsWith('redir.');

	const objectPath = `${commit}/${path.slice(1).join('/')}`;

	// Try to get load object from cache
	const objectReq = new Request(new URL(objectPath, url.origin), request);
	const objectCache = disableCache ? undefined : await cache.match(objectReq);
	if (objectCache) {
		let response;
		if (shouldRedirect) {
			response = new Response(null, {
				status: 301,
				headers: { 'Location': await objectCache.text() }
			});
		} else {
			response = new Response(objectCache.body, objectCache);
		}
		setHeaders(response.headers, true);
		return response;
	}

	// Fallback to loading from R2
	const object = await env.R2_MAPS_METADATA.get(objectPath);
	if (!object) {
		return new Response('Not found', { status: 404 });
	}

	// Put object from R2 in cache
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('cache-control', CACHE_FOREVER);
	let response;
	if (shouldRedirect) {
		if (object.size > 2000) {
			throw new Error('The redirect url is too long');
		}
		const redir = await object.text();
		if (!disableCache) {
			const cacheResp = new Response(redir, { headers });
			ctx.waitUntil(cache.put(objectReq, cacheResp));
		}
		response = new Response(null, {
			status: 301,
			headers: { 'Location': redir }
		});
	} else {
		response = new Response(object.body, { headers });
		if (!disableCache) ctx.waitUntil(cache.put(objectReq, response.clone()));
	}
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

			const url = new URL(request.url);
			if (url.pathname === '/') {
				return new Response('maps-metadata');
			} else if (url.pathname.startsWith('/i/')) {
				return await getImage(request, env, ctx);
			} else {
				return await getFile(request, env, ctx);
			}
		} catch (e: any) {
			return new Response(`Internal error: ${e.stack}`, { status: 500 });
		}
	},
};
