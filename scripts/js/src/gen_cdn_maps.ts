import { readMapList } from './maps_metadata.js';
import pLimit from 'p-limit';
import fs from 'node:fs/promises';
import { program } from '@commander-js/extra-typings';
import stringify from "json-stable-stringify";
import got from 'got';

async function genCDNMaps(): Promise<string> {
    const maps = await readMapList();
    const limit = pLimit(20);
    const requests = Object.values(maps).map(m => limit(
        () => got('https://files-cdn.beyondallreason.dev/find', {
            searchParams: {
                'category': 'map',
                'springname': m.springName
            }
        }).json()));
    const mapsInfo = await Promise.all(requests);
    mapsInfo.sort((a: any, b: any) => a[0].springname.localeCompare(b[0].springname));
    return stringify(mapsInfo);
}

const prog = program
    .argument('<cdnMaps>', 'CDN maps output path.')
    .parse();
const [cdnMapsPath] = prog.processedArgs;
await fs.writeFile(cdnMapsPath, await genCDNMaps());
