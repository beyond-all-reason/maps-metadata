import type { MapList } from '../../../gen/types/map_list.js';
import got from 'got';
import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';
import pLimit from 'p-limit';


const prog = program
    .argument('<map-list>', 'File with schema')
    .parse();
const [mapListFile] = prog.processedArgs;
const mapListContent = await fs.readFile(mapListFile, { encoding: 'utf8' });
const maps = JSON.parse(mapListContent) as MapList;

const limit = pLimit(10);
const requests = Object.values(maps).map(m => limit(() => got('https://files-cdn.beyondallreason.dev/find', {
    searchParams: {
        'category': 'map',
        'springname': m.springName
    }
})));
const mapsInfo = await Promise.all(requests);
for (const info of mapsInfo) {
    if (!info.ok) {
        console.error(`Error fetching map info ${info.url}: ${info.statusCode}`);
        process.exit(1);
    }
}
