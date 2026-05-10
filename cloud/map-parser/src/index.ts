import express from 'express';
import { Storage } from '@google-cloud/storage';
import { MapParser } from 'spring-map-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import child_process from 'node:child_process';
import stream from 'node:stream/promises';
import { Readable } from 'node:stream';
import sevenBin from '7zip-bin';
import Jimp from 'jimp';

const execFile = promisify(child_process.execFile);

const app = express();
const port = process.env.PORT || 8080;

if (!process.env.BUCKET) {
    console.error('Missing required environment variable BUCKET');
    process.exit(1);
}
const bucketName: string = process.env.BUCKET;

const publicUrlBase = process.env.PUBLIC_URL || `https://storage.googleapis.com/${bucketName}`;

const storage = new Storage();

// Must change this value when making incompatible change to the cache.
const CACHE_VERSION = 'v3';

// Parsing is memory-heavy; serialize to avoid concurrent OOMs.
// MAX_QUEUE_SIZE bounds total in-flight requests (running + waiting) so a
// burst can't pile up unbounded tempDirs / sockets.
const MAX_QUEUE_SIZE = 3;
const PARSE_TIMEOUT_MS = 5 * 60 * 1000;

class TooManyRequestsError extends Error {
    constructor() { super('Too many concurrent parse requests queued.'); }
}

let queueSize = 0;
let parseQueue: Promise<void> = Promise.resolve();
function withParseLock<T>(fn: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (queueSize >= MAX_QUEUE_SIZE) {
        return Promise.reject(new TooManyRequestsError());
    }
    queueSize++;
    const result = parseQueue.then(() => {
        signal.throwIfAborted();
        return fn(signal);
    });
    // parseQueue must resolve (never reject) so subsequent callers chaining off it aren't rejected by a prior failure.
    parseQueue = result.finally(() => { queueSize--; }).then(() => undefined, () => undefined);
    return result;
}

async function checkCached(springName: string): Promise<boolean> {
    if (bucketName === 'local') return false;
    const baseBucketPath = `${springName}/cache-${CACHE_VERSION}`;
    const [exists] = await storage.bucket(bucketName).file(`${baseBucketPath}/metadata.json`).exists();
    return exists;
}

async function is7zArchiveSolid(archivePath: string, signal: AbortSignal): Promise<boolean> {
    const { stdout } = await execFile(
        sevenBin.path7za, ['l', '-x!*', archivePath], { signal }
    );

    const solidLine = stdout
        .split('\n')
        .find((line) => line.trim().startsWith('Solid ='));

    if (!solidLine) {
        throw new Error('Solid information not found about the archive.');
    }

    switch (solidLine.split('=')[1].trim()) {
        case '+':
            return true;
        case '-':
            return false;
        default:
            throw new Error('Unexpected value for the solid archive, expected + or -.');
    }
}

async function isMapArchiveSolid(archivePath: string, signal: AbortSignal): Promise<boolean> {
    switch (path.extname(archivePath)) {
        case '.sd7':
            return await is7zArchiveSolid(archivePath, signal);
        case '.sdz':
            return false;
        default:
            throw new Error('Only .sd7 and .sdz files supported');
    }
}

async function downloadMap(springName: string, destination: string, signal: AbortSignal): Promise<string | null> {
    const findResponse = await fetch(`https://files-cdn.beyondallreason.dev/find?category=map&springname=${encodeURIComponent(springName)}`, { signal });
    if (!findResponse.ok) {
        throw new Error(`Failed to find map "${springName}": ${findResponse.status} ${findResponse.statusText}`);
    }
    const findData = await findResponse.json() as Array<{ mirrors: string[], filename: string }>;

    if (findData.length === 0) {
        return null;
    }

    const mapUrl = findData[0].mirrors[0];
    const fileName = path.join(destination, findData[0].filename);

    const mapResponse = await fetch(mapUrl, { signal });
    if (!mapResponse.ok) {
        throw new Error(`Failed to download map from "${mapUrl}": ${mapResponse.status} ${mapResponse.statusText}`);
    }
    const mapFile = await fs.open(fileName, 'w');
    try {
        await stream.pipeline(Readable.fromWeb(mapResponse.body!), mapFile.createWriteStream(), { signal });
    } finally {
        await mapFile.close();
    }
    return fileName;
}

type ParseResult =
    | { status: 'not_found' }
    | { status: 'cached' }
    | { status: 'fresh'; tempDir: string };

async function parseAndCacheMap(springName: string, signal: AbortSignal): Promise<ParseResult> {
    // Re-check cache now that we hold the lock — a parallel request may have
    // populated it while we were queued.
    if (await checkCached(springName)) {
        return { status: 'cached' };
    }
    signal.throwIfAborted();

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `parse-map-`));
    try {
        const baseBucketPath = `${springName}/cache-${CACHE_VERSION}`;

        const mapPath = await downloadMap(springName, tempDir, signal);
        if (!mapPath) {
            return { status: 'not_found' };
        }

        const isArchiveSolid = await isMapArchiveSolid(mapPath, signal);

        console.log(`Starting to parse ${springName}`);
        const map = await new MapParser({
            verbose: true,
            mipmapSize: 16,
            skipSmt: false,
            parseResources: true,
            resources: ['detailNormalTex', 'specularTex'],
            parseSkybox: true,
        }).parseMap(mapPath);
        console.log('Parsing map done');
        signal.throwIfAborted();

        // Write images sequentially to limit peak memory usage.
        // Large textures are written first, then destructively scaled for
        // previews so the full-resolution buffer can be garbage-collected.
        const extractedFiles: string[] = [];

        const writeImage = async (fileName: string, image: Jimp): Promise<void> => {
            signal.throwIfAborted();
            await image.writeAsync(path.join(tempDir, fileName));
            console.log(`Wrote ${fileName}`);
            signal.throwIfAborted();
            extractedFiles.push(fileName);
        };

        // Capture texture dimensions before any destructive scaling
        const texW = map.textureMap!.getWidth();
        const texH = map.textureMap!.getHeight();

        // Texture map (largest images)
        await writeImage('texture.jpg', map.textureMap!.quality(90));
        await writeImage('texture-preview.jpg', map.textureMap!.scaleToFit(600, 600).quality(80));

        // Dry texture (without water overlay)
        await writeImage('texture-dry.jpg', map.textureMapDry!.quality(90));
        await writeImage('texture-dry-preview.jpg', map.textureMapDry!.scaleToFit(600, 600).quality(80));

        // Smaller maps can be written in parallel
        await Promise.all([
            writeImage('height.png', map.heightMap!),
            writeImage('type.png', map.typeMap!),
            writeImage('metal.png', map.metalMap!),
            writeImage('mini.jpg', map.miniMap!.quality(85)),
        ]);

        // Resource images — scale down to fit texture dimensions but never upscale
        if (map.resources) {
            for (const [resource, image] of Object.entries(map.resources) as [string, Jimp | undefined][]) {
                if (image) {
                    if (image.getWidth() > texW || image.getHeight() > texH) {
                        image.scaleToFit(texW, texH);
                    }
                    await writeImage(`res_${resource}.png`, image);
                }
            }
        }

        // Skybox
        if (map.skybox) {
            await writeImage('skybox.png', map.skybox!);
        }

        if (bucketName !== 'local') {
            console.log('Uploading images to bucket');
            const uploadPromises = extractedFiles.map(fileName => {
                const filePath = path.join(tempDir, fileName);
                return storage.bucket(bucketName).upload(filePath, { destination: `${baseBucketPath}/${fileName}` });
            });
            await Promise.all(uploadPromises);
        }

        // Create smf object copy without tables that contain a lot of data.
        let smfCopy: any = undefined;
        if (map.smf) {
            smfCopy = Object.assign({}, map.smf);
            for (const prop of ['heightMap', 'metalMap', 'miniMap', 'typeMap', 'tileIndexMap', 'heightMapValues']) {
                delete smfCopy[prop];
            }
        }

        // Save metadata as JSON
        const metadata = {
            mapInfo: map.mapInfo,
            minHeight: map.minHeight,
            maxHeight: map.maxHeight,
            fileName: map.fileNameWithExt,
            springName: springName,
            isArchiveSolid,
            smd: map.smd,
            smf: smfCopy,
            cacheVersion: CACHE_VERSION,
            extractedFiles
        };

        signal.throwIfAborted();
        const metadataPath = path.join(tempDir, 'metadata.json');
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), { signal });
        if (bucketName !== 'local') {
            console.log('Writing metadata.json to bucket');
            await storage.bucket(bucketName).upload(metadataPath, { destination: `${baseBucketPath}/metadata.json` });
        }

        console.log(`Finished parsing ${springName}`);
        return { status: 'fresh', tempDir };
    } finally {
        if (bucketName !== 'local') {
            await fs.rm(tempDir, { recursive: true, force: true })
                .catch(err => console.error(`Failed to clean up ${tempDir}:`, err));
        } else {
            console.log(`Wrote files to ${tempDir}`);
        }
    }
}

app.get('/parse-map/:springName', async (req, res) => {
    const springName = req.params.springName;
    const baseBucketPath = `${springName}/cache-${CACHE_VERSION}`;
    const baseOkRes = {
        bucket: bucketName,
        path: bucketName == 'local' ? '' : baseBucketPath,
        baseUrl: `${publicUrlBase}/${encodeURI(baseBucketPath)}`,
    };

    const reqAbort = new AbortController();
    const onClose = () => {
        if (!res.writableEnded) reqAbort.abort(new Error('Client disconnected'));
    };
    req.on('close', onClose);
    const signal = AbortSignal.any([reqAbort.signal, AbortSignal.timeout(PARSE_TIMEOUT_MS)]);

    try {
        // Fast-path: skip the queue entirely if the cache is already populated.
        if (await checkCached(springName)) {
            res.status(200).json({ message: 'Cache found.', ...baseOkRes });
            return;
        }

        const result = await withParseLock(
            (s) => parseAndCacheMap(springName, s),
            signal,
        );

        if (result.status === 'not_found') {
            console.log(`Map ${springName} not found`);
            res.status(404).json({ message: 'Map not found.' });
            return;
        }

        res.status(200).json({
            message: result.status === 'cached' ? 'Cache found.' : 'Cache generated.',
            ...baseOkRes,
            ...(result.status === 'fresh' && bucketName === 'local' ? { path: result.tempDir } : {}),
        });
    } catch (error) {
        if (error instanceof TooManyRequestsError) {
            if (!res.headersSent) {
                res.status(429).json({ message: 'Too many concurrent requests, try again later.' });
            }
            return;
        }
        if (signal.aborted) {
            console.error('Parse aborted:', signal.reason);
            // Only the timeout branch needs a response; if reqAbort fired the
            // client is gone and writes are no-ops.
            if (!res.headersSent && !reqAbort.signal.aborted) {
                res.status(504).json({ message: 'Request timed out.' });
            }
            return;
        }
        console.error(error);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Internal server error.' });
        }
    } finally {
        req.off('close', onClose);
    }
});

app.listen(port, () => {
    console.log(`Server running at ${port}`);
});
