// A library to read data from maps cache and maps list.

import { Storage } from '@google-cloud/storage';
import got from 'got';
import path from 'node:path';
import fs from 'node:fs/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import stream from 'node:stream/promises';
import process from 'node:process';
import type { MapList } from '../../../gen/types/map_list.js';


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
        writeFileSync(
            path.join(mapsCacheDir, 'mapLocationCache.json'),
            JSON.stringify({
                date: new Date().getTime(),
                version: mapLocationCacheVersion,
                entries: [...mapLocationCache]
            }));
    });

    try {
        const mlc = JSON.parse(readFileSync(
            path.join(mapsCacheDir, 'mapLocationCache.json'), { encoding: 'utf8' }));
        if (mlc.version == mapLocationCacheVersion &&
            new Date().getTime() - mlc.date < 1000 * 60 * 60 * 48) {
            return new Map(mlc.entries);
        }
    } catch (e) {
        console.warn(`Failed to read mapLocationCache.json: ${e}`);
    }
    return new Map();
}

const mapLocationCache: Map<string, MapLocation> = loadMapLocationCache();

async function getMapLocation(springName: string): Promise<MapLocation> {
    if (!mapLocationCache.has(springName)) {
        const mapMeta = await got(`${mapsParserURL}/parse-map/${encodeURIComponent(springName)}`).json<ParseMapResponse>();
        mapLocationCache.set(springName, {
            bucket: mapMeta.bucket,
            path: mapMeta.path
        });
    }
    return mapLocationCache.get(springName)!;
}

export async function getMapFilePath(springName: string, fileName: string): Promise<string> {
    const location = await getMapLocation(springName);
    const cachePath = path.join(mapsCacheDir, location.path, fileName);
    const fileExists = !!await fs.stat(cachePath).catch(e => null);
    if (!fileExists) {
        await downloadFile(location.bucket, path.join(location.path, fileName), cachePath);
    }
    return cachePath;
}

export async function readMapList(): Promise<MapList> {
    const contents = await fs.readFile('gen/map_list.validated.json', { 'encoding': 'utf8' });
    return JSON.parse(contents) as MapList;
}
