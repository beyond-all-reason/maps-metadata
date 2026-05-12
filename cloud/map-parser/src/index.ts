import express from 'express';
import { Storage } from '@google-cloud/storage';
import { Piscina } from 'piscina';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CACHE_VERSION } from './shared.ts';
import type { ParseResult, WorkerInput } from './shared.ts';

const app = express();
const port = process.env.PORT || 8080;

if (!process.env.BUCKET) {
    console.error('Missing required environment variable BUCKET');
    process.exit(1);
}
const bucketName: string = process.env.BUCKET;

const publicUrlBase = process.env.PUBLIC_URL || `https://storage.googleapis.com/${bucketName}`;

const storage = new Storage();

function envInt(name: string, defaultValue: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return defaultValue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
        console.error(`Invalid ${name}=${raw}, expected non-negative integer`);
        process.exit(1);
    }
    return n;
}

// Parsing is memory- and CPU-heavy; cap concurrent parses and queued requests
// so a burst can't pile up unbounded. Cached requests bypass the pool entirely
// via the fast-path check below.
const PARSE_CONCURRENCY = envInt('PARSE_CONCURRENCY', 1);
const PARSE_MAX_QUEUED = envInt('PARSE_MAX_QUEUED', 2);
const MAX_INFLIGHT = PARSE_CONCURRENCY + PARSE_MAX_QUEUED;
const PARSE_TIMEOUT_MS = envInt('PARSE_TIMEOUT_MS', 5 * 60 * 1000);

// minThreads === maxThreads is load-bearing: when piscina aborts the running
// task it terminates the worker, then calls _ensureMinimumWorkers to spawn a
// replacement. If minThreads is lower, queued tasks can orphan.
const pool = new Piscina({
    filename: new URL('./parse-worker.ts', import.meta.url).href,
    minThreads: PARSE_CONCURRENCY,
    maxThreads: PARSE_CONCURRENCY,
});

// Piscina's own maxQueue / queueSize don't apply to abortable tasks (they go
// into skipQueue, which is unbounded), so we track in-flight requests here.
let inFlight = 0;

async function checkCached(springName: string): Promise<boolean> {
    if (bucketName === 'local') return false;
    const baseBucketPath = `${springName}/cache-${CACHE_VERSION}`;
    const [exists] = await storage.bucket(bucketName).file(`${baseBucketPath}/metadata.json`).exists();
    return exists;
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
        // Runs on the main thread so cached requests are served while a parse
        // is in flight in the worker.
        if (await checkCached(springName)) {
            res.status(200).json({ message: 'Cache found.', ...baseOkRes });
            return;
        }

        if (inFlight >= MAX_INFLIGHT) {
            res.status(429).json({ message: 'Too many concurrent requests, try again later.' });
            return;
        }

        // Main thread owns the tempDir so cleanup is guaranteed even when
        // piscina terminates the worker on abort (no cooperative `finally`).
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'parse-map-'));
        inFlight++;
        try {
            const input: WorkerInput = { springName, tempDir };
            const result: ParseResult = await pool.run(input, { signal });

            if (result.status === 'not_found') {
                console.log(`Map ${springName} not found`);
                res.status(404).json({ message: 'Map not found.' });
                return;
            }

            res.status(200).json({
                message: result.status === 'cached' ? 'Cache found.' : 'Cache generated.',
                ...baseOkRes,
                ...(result.status === 'fresh' && bucketName === 'local' ? { path: tempDir } : {}),
            });
        } finally {
            inFlight--;
            if (bucketName !== 'local') {
                await fs.rm(tempDir, { recursive: true, force: true })
                    .catch(err => console.error(`Failed to clean up ${tempDir}:`, err));
            }
        }
    } catch (error) {
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
