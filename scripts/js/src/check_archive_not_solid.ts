// Verifies no map archives are solid.

import { readMapList, fetchMapsMetadata } from './maps_metadata.js';

const maps = await readMapList();
const mapsMetadata = await fetchMapsMetadata(maps);

const whitelist = new Set([
    'Altored Divide Bar Remake 1.6',
    'Angel Crossing 1.5',
    'Bismuth Valley v2.2',
    'Callisto v3',
    'Coastlines_Dry_V2.2',
    'Copper Hill v1',
    'Crater Islands Remake v1.0',
    'Death Valley v1',
    'Deeploria Fields v1.5',
    'Desolation v1',
    'EmainMacha Remake 2.1',
    'Eye Of Horus 1.7',
    'Flats and Forests v2.1',
    'Gecko Isle Remake v1.2',
    'Geyser Plains BAR v1.2',
    'Ghenna Rising 4.0',
    'Greenest Fields 1.3',
    'Heartbreak Hill v4',
    'Hooked 1.1',
    'Hotlips Remake v3.1',
    'Hotstepper 5 1.2',
    'Ice Scream v2.5',
    'Incandescence Remake 3.3',
    'Into Battle Redux v3',
    'Kolmogorov Remake 3.0',
    'Lake Carne v2',
    'Mariposa Island v2.4',
    'Melting Glacier v1.1',
    'Mithril Mountain v2',
    'Neurope_Remake 4.2',
    'Onyx Cauldron 2.2',
    'Point of No Return v1.0',
    'Red Rock Desert v1',
    'Requiem Outpost 1.0',
    'ReRaghnarok 1',
    'Sertagatta v6.0',
    'Seths Ravine Remake 1.3',
    'Shallow Straits v1',
    'Silent Sea v1',
    'Silveridge v1',
    'Sky Isle v1.1',
    'Sphagnum Bog v1.2',
    'Timna Island 1.0',
    'Tumult Remake v1.0',
    'Tundra Continents v2.3',
    'Valles Marineris 2.6',
    'Zed Remake 3.3',
]);

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
