import { readMapList, fetchMapsMetadata } from './maps_metadata.js';
import { readMapCDNInfos } from './cdn_maps.js';
import fs from 'node:fs/promises';
import { program } from '@commander-js/extra-typings';
import stringify from "json-stable-stringify";
import type { LobbyMap } from '../../../gen/types/lobby_maps.js';
import { getDerivedInfo } from './derived_map_info.js';

const imagorUrlBase = 'https://maps-metadata.beyondallreason.dev/i/';
const rowyBucket = 'rowy-1f075.appspot.com';

async function genLobbyMaps(): Promise<string> {
    const maps = await readMapList();
    const cdnInfo = await readMapCDNInfos();
    const mapsMetadata = await fetchMapsMetadata(maps);

    const lobbyMaps: LobbyMap[] = [];
    for (const [rowyId, map] of Object.entries(maps)) {
        if (!map.certified && !map.inPool) {
            continue;
        }

        const mi = cdnInfo.get(map.springName);
        if (!mi) {
            throw new Error(`Missing download url for ${map.springName}`);
        }
        const meta = mapsMetadata.get(rowyId);
        const derivedInfo = getDerivedInfo(map, meta);

        lobbyMaps.push({
            springName: map.springName,
            displayName: map.displayName,
            author: map.author,
            description: map.description,
            certified: map.certified,
            startboxesSet: Object.values(map.startboxesSet || {}),
            terrain: derivedInfo.terrainOrdered,
            startPos: map.startPosActive && map.startPos ? map.startPos : undefined,
            mapLists: Array.from(map.mapLists || []).sort(),
            tags: derivedInfo.tags,
            mapWidth: derivedInfo.width,
            mapHeight: derivedInfo.height,
            windMin: derivedInfo.windMin,
            windMax: derivedInfo.windMax,
            tidalStrength: derivedInfo.tidalStrength,
            filename: mi.filename,
            images: {
                preview: `${imagorUrlBase}fit-in/1024x1024/filters:format(webp):quality(75)/${rowyBucket}/${encodeURI(map.photo[0].ref)}`,
            },
            playerCountMin: derivedInfo.minPlayerCount,
            playerCountMax: map.playerCount,
        });
    }
    lobbyMaps.sort((a, b) => a.springName.localeCompare(b.springName));
    return stringify(lobbyMaps);
}

const prog = program
    .argument('<lobbyMaps>', 'Lobby maps output path.')
    .parse();
const [lobbyMapsPath] = prog.processedArgs;
await fs.writeFile(lobbyMapsPath, await genLobbyMaps());
