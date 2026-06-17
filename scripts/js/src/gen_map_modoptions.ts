import { readMapList } from './maps_metadata.js';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { program } from '@commander-js/extra-typings';
import stringify from "json-stable-stringify";
import { MapModoptions } from '../../../gen/types/map_modoptions.js';
import { StartPosConf, StartboxesInfo } from '../../../gen/types/map_list.js';

// JSON -> zlib deflate -> base64url with padding stripped. Matches the transport
// the game decoder expects and the map_modoptions value pattern
// (^[a-zA-Z0-9_.-]+$), which forbids '=' padding.
function encodeModoptionValue(value: unknown): string {
    const compressed = zlib.deflateSync(stringify(value));
    return compressed.toString('base64url').replace(/=+$/, '');
}

function encodeStartPos(startPos: StartPosConf): string {
    return encodeModoptionValue(startPos);
}

// The game resolves a startboxes arrangement by team count (set[tostring(numTeams)]).
// maps-metadata keys startboxesSet by document id, so re-key by the arrangement's
// team count here. check_startboxes.ts guarantees team counts are unique within a
// set, so no key collides.
function encodeStartboxesSet(set: Record<string, StartboxesInfo>): string {
    const byTeamCount: Record<string, StartboxesInfo> = {};
    for (const info of Object.values(set)) {
        byTeamCount[String(info.startboxes.length)] = info;
    }
    return encodeModoptionValue(byTeamCount);
}

async function genLiveMaps(): Promise<string> {
    const maps = await readMapList();
    const mapModoptions: MapModoptions[] = [];

    for (const m of Object.values(maps)) {
        const modoptions: Record<string, string> = {};

        if (m.startPos && m.startPosActive) {
            modoptions.mapmetadata_startpos = encodeStartPos(m.startPos);
        }

        if (m.startboxesSet && Object.keys(m.startboxesSet).length > 0) {
            modoptions.mapmetadata_startboxes_set = encodeStartboxesSet(m.startboxesSet);
        }

        if (Object.keys(modoptions).length > 0) {
            mapModoptions.push({ springName: m.springName, modoptions });
        }
    }

    mapModoptions.sort((a, b) => a.springName.localeCompare(b.springName));
    return stringify(mapModoptions);
}

const prog = program
    .argument('<mapModoptions>', 'Map modoptions output path.')
    .parse();
const [liveMapsPath] = prog.processedArgs;
await fs.writeFile(liveMapsPath, await genLiveMaps());
