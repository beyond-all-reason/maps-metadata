import { readMapList } from './maps_metadata.js';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { program } from '@commander-js/extra-typings';
import stringify from "json-stable-stringify";
import { MapModoptions } from '../../../gen/types/map_modoptions.js';
import { StartPosConf } from '../../../gen/types/map_list.js';

function encodeStartPos(startPos: StartPosConf) {
    const str = stringify(startPos);
    const compressed = zlib.deflateSync(str);
    const encoded = compressed.toString('base64url').replace(/=+$/, '');
    return encoded;
}

async function genLiveMaps(): Promise<string> {
    const maps = await readMapList();
    const mapModoptions: MapModoptions[] = Object.values(maps)
        .filter(m => m.startPos && m.startPosActive)
        .map(m => ({
            springName: m.springName,
            modoptions: {
                mapmetadata_startpos: encodeStartPos(m.startPos!)
            }
        }));
    mapModoptions.sort((a, b) => a.springName.localeCompare(b.springName));
    return stringify(mapModoptions);
}

const prog = program
    .argument('<mapModoptions>', 'Map modoptions output path.')
    .parse();
const [liveMapsPath] = prog.processedArgs;
await fs.writeFile(liveMapsPath, await genLiveMaps());
