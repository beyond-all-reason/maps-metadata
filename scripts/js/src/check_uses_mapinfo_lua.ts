// Verifies all maps use mapinfo.lua and not older methods.

import { readMapList, fetchMapsMetadata } from './maps_metadata.js';

const maps = await readMapList();
const mapsMetadata = await fetchMapsMetadata(maps);

const whitelist: Set<string> = new Set(['Mescaline_V2']);

let anyWithoutMapinfo = false;
for (const [rowyId, map] of Object.entries(maps)) {
    const meta = mapsMetadata.get(rowyId);
    if (!meta.mapInfo) {
        if (whitelist.has(map.springName)) {
            console.log(`${map.springName} doesn't use mapinfo.lua but whitelisted.`);
        } else {
            console.error(`ERROR: ${map.springName} doesn't use mapinfo.lua.`);
            anyWithoutMapinfo = true;
        }
    }
}
if (anyWithoutMapinfo) {
    process.exit(1);
}
