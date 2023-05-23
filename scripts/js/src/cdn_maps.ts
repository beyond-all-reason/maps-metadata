// A library to read JSON with CDN maps info.

import fs from 'node:fs/promises';
import type { MapCDNInfo, CDNMaps } from '../../../gen/types/cdn_maps.js';

export async function readMapCDNInfos(): Promise<Map<string, MapCDNInfo>> {
    const contents = await fs.readFile('gen/cdn_maps.validated.json', { 'encoding': 'utf8' });
    const data = JSON.parse(contents) as CDNMaps;
    const entries = data.map(m => [m[0].springname, m[0]] as [string, MapCDNInfo]);
    return new Map(entries);
}
