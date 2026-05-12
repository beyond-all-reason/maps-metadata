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
