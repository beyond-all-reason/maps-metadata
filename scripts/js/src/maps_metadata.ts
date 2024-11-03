// A library to read data from maps cache and maps list.

import { Storage } from '@google-cloud/storage';
import got from 'got';
import path from 'node:path';
import fs from 'node:fs/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import stream from 'node:stream/promises';
import process from 'node:process';
import type { MapList } from '../../../gen/types/map_list.js';
import pLimit from 'p-limit';


const storage = new Storage();

const mapsCacheDir = process.env.MAPS_CACHE_DIR || '.maps-cache'
const mapsParserURL = process.env.MAP_PARSER_URL || 'https://map-parser-oseq47fmga-ew.a.run.app';

interface ParseMapResponse {
    message: string,
    bucket: string,
    path: string,
    baseUrl: string,
}

interface MapLocation {
    bucket: string,
    path: string,
}

async function downloadFile(bucket: string, filePath: string, outputPath: string): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    let fileHandle = null;
    try {
        fileHandle = await fs.open(outputPath, 'w');
        await stream.pipeline(
            storage.bucket(bucket).file(filePath).createReadStream(),
            fileHandle.createWriteStream()
        );
    } finally {
        await fileHandle?.close();
    }
}

function loadMapLocationCache(): Map<string, MapLocation> {
    const mapLocationCacheVersion = 1;

    process.on('beforeExit', () => {
        try {
            writeFileSync(
                path.join(mapsCacheDir, 'mapLocationCache.json'),
                JSON.stringify({
                    version: mapLocationCacheVersion,
                    entries: [...mapLocationCache]
                }));
        } catch (e) {
            console.warn(`Warning: ${e}`);
        }
    });

    try {
        const mlc = JSON.parse(readFileSync(
            path.join(mapsCacheDir, 'mapLocationCache.json'), { encoding: 'utf8' }));
        if (mlc.version == mapLocationCacheVersion) {
            return new Map(mlc.entries);
        }
    } catch (e) {
        console.warn(`Warning: ${e}`);
    }
    return new Map();
}

const mapLocationCache: Map<string, MapLocation> = loadMapLocationCache();

async function getParsedMapLocation(springName: string): Promise<MapLocation> {
    if (!mapLocationCache.has(springName)) {
        const mapMeta = await got(`${mapsParserURL}/parse-map/${encodeURIComponent(springName)}`).json<ParseMapResponse>();
        mapLocationCache.set(springName, {
            bucket: mapMeta.bucket,
            path: mapMeta.path
        });
    }
    return mapLocationCache.get(springName)!;
}

async function getMapFilePath(springName: string, fileName: string): Promise<[string, MapLocation]> {
    const location = await getParsedMapLocation(springName);
    const cachePath = path.join(mapsCacheDir, location.path, fileName);
    const fileExists = !!await fs.stat(cachePath).catch(e => null);
    if (!fileExists) {
        await downloadFile(location.bucket, path.join(location.path, fileName), cachePath);
    }
    return [cachePath, location];
}

export async function fetchMapsMetadata(maps: MapList): Promise<Map<string, any>> {
    const limit = pLimit(10);

    const metadata = Object.entries(maps).map(([id, m]) => limit(async (): Promise<[string, any]> => {
        const [path, location] = await getMapFilePath(m.springName, 'metadata.json');
        const meta = JSON.parse(await fs.readFile(path, { encoding: 'utf8' }));
        if ('location' in meta) {
            throw new Error('This should never happen, key conflict!');
        }
        meta.location = location;
        return [id, meta];
    }));
    return new Map(await Promise.all(metadata));
}

export async function readMapList(): Promise<MapList> {
    const contents = await fs.readFile('gen/map_list.validated.json', { 'encoding': 'utf8' });
    return JSON.parse(contents) as MapList;
}
