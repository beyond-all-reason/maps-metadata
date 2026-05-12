import type { Storage } from '@google-cloud/storage';

// Must change CACHE_VERSION when making incompatible change to the cache.
export const CACHE_VERSION = 'v3';

export type ParseResult =
    | { status: 'not_found' }
    | { status: 'cached' }
    | { status: 'fresh' };

export type WorkerInput = {
    springName: string;
    tempDir: string;
};

export async function checkCached(storage: Storage, bucketName: string, springName: string): Promise<boolean> {
    if (bucketName === 'local') return false;
    const baseBucketPath = `${springName}/cache-${CACHE_VERSION}`;
    const [exists] = await storage.bucket(bucketName).file(`${baseBucketPath}/metadata.json`).exists();
    return exists;
}
