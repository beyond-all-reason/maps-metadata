import { readMapList } from './maps_metadata.js';
import { readMapCDNInfos } from './cdn_maps.js';
import fs from 'node:fs/promises';
import { program } from '@commander-js/extra-typings';
import stringify from "json-stable-stringify";
import type { LiveMapEntry } from '../../../gen/types/live_maps.js';

async function genLiveMaps(): Promise<string> {
    const maps = await readMapList();
    const cdnMaps = await readMapCDNInfos();
    const liveMaps: LiveMapEntry[] = Object.values(maps)
        .filter(m => m.certified || m.inPool)
        .map(m => {
            const cdnMap = cdnMaps.get(m.springName);
            if (!cdnMap) {
                throw new Error(`Map ${m.springName} not found in CDN maps.`);
            }
            return {
                springName: m.springName,
                downloadURL: cdnMap.mirrors[0],
                fileName: cdnMap.filename,
                md5: cdnMap.md5,
            }
        });
    liveMaps.sort((a, b) => a.springName.localeCompare(b.springName));
    return stringify(liveMaps);
}

const prog = program
    .argument('<liveMaps>', 'Live maps output path.')
    .parse();
const [liveMapsPath] = prog.processedArgs;
await fs.writeFile(liveMapsPath, await genLiveMaps());
