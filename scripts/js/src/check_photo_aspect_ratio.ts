// Verifies that the aspect ratio of the map photo is the same as the map itself.

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { readMapList, fetchMapsMetadata } from './maps_metadata.js';
import pLimit from 'p-limit';
import got from 'got';
import { imageSize } from 'image-size';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

const photoCacheDir = path.join(process.env.MAPS_CACHE_DIR || '.maps-cache', 'photo-cache');
await fs.mkdir(photoCacheDir, { recursive: true });

const imagorUrlBase = 'https://maps-metadata.beyondallreason.dev/i/';

// We reuse the same param as for update_byar_chobby_images.ts.
const urlBase = `${imagorUrlBase}fit-in/512x512/filters:format(webp):quality(1)`;
const rowyBucket = 'rowy-1f075.appspot.com';

const maps = await readMapList();
const mapsMetadata = await fetchMapsMetadata(maps);

const requests: Promise<any>[] = [];
const limit = pLimit(15);
const photoUrlHash = new Map<string, string>();
for (const [rowyId, map] of Object.entries(maps)) {
    requests.push(limit(async () => {
        const url = `${urlBase}/${rowyBucket}/${encodeURI(map.photo[0].ref)}`;
        const hash = createHash('sha256').update(url).digest('hex');
        photoUrlHash.set(rowyId, hash);

        const imgPath = path.join(photoCacheDir, hash + '.webp');
        const fileExists = !!await fs.stat(imgPath).catch(e => null);
        if (!fileExists) {
            await pipeline(
                got.stream(url),
                createWriteStream(imgPath)
            );
        }
    }));
}
await Promise.all(requests);

let allOk = true;


const whitelist = new Set([
    'Heartbreak Hill v4',
    'Death Valley v1',
    'Fallendell_V4',
]);

for (const [rowyId, map] of Object.entries(maps)) {
    const imgSizes = imageSize(path.join(photoCacheDir, photoUrlHash.get(rowyId) + '.webp'));
    const imageRatio = imgSizes.width! / imgSizes.height!;
    const meta = mapsMetadata.get(rowyId);
    const mapRatio = meta.smf.mapWidth / meta.smf.mapHeight;
    const inferedMapHeight = ((meta.smf.mapWidth / 64) * imgSizes.height!) / imgSizes.width!;

    if (Math.abs(inferedMapHeight - meta.smf.mapHeight / 64) > 0.75) {
        console.error(`Map ${map.springName} has wrong aspect ratio: ${imageRatio} vs ${mapRatio}`);
        if (whitelist.has(map.springName)) {
            console.log("whitelisted");
        } else {
            allOk = false;
        }
    }
}

if (!allOk) {
    process.exit(1);
}
