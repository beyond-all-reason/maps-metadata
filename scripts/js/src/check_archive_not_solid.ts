// Verifies no map archives are solid.

import { readMapList, fetchMapsMetadata } from './maps_metadata.js';

const maps = await readMapList();
const mapsMetadata = await fetchMapsMetadata(maps);

const whitelist: Set<string> = new Set([]);

let anySolid = false;
for (const [rowyId, map] of Object.entries(maps)) {
    const meta = mapsMetadata.get(rowyId);
    if (meta.isArchiveSolid) {
        if (whitelist.has(map.springName)) {
            console.log(`${map.springName} is solid but whitelisted.`);
        } else {
            console.error(`ERROR: ${map.springName} is solid.`);
            anySolid = true;
        }
    }
}
if (anySolid) {
    process.exit(1);
}
