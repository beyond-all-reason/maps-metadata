// A helper library that abstracts away extraction of high level derived
// information for usage across consumers.

import type { MapInfo } from '../../../gen/types/map_list.js';
import mapSchema from '../../../gen/schemas/map_list.json';

function getRowyMapTerrainsOrder(): Map<string, number> {
    const terrains = mapSchema['$defs'].terrainType.enum;
    return new Map(terrains.map((t, i) => [t, i]));
}

function orDefault<T>(n: T | undefined, def: T): T {
    return n === undefined ? def : n;
}

const terrainsOrder = getRowyMapTerrainsOrder();

export function getDerivedInfo(
    map: MapInfo,
    meta: any
) {
    const tagsOrder: Map<string, number> = new Map();
    const mapTags = new Set<string>();

    for (const gameType of map.gameType) {
        // Skip team because almost all maps have it so it doesn't add much value.
        if (gameType === 'team') {
            continue;
        }
        tagsOrder.set(gameType, {
            'team': 1,
            'ffa': 2,
            'pve': 3,
            '1v1': 1001,
        }[gameType]);
        mapTags.add(gameType);
    }

    const startboxes = Array.from(Object.values(map.startboxesSet || {}));
    for (const startbox of startboxes) {
        const numTeams = startbox.startboxes.length;
        if (numTeams < 2 || numTeams > 4) {
            continue;
        }
        const minPlayers = Math.ceil(startbox.maxPlayersPerStartbox * 0.6);
        for (let numPlayers = minPlayers; numPlayers <= startbox.maxPlayersPerStartbox; ++numPlayers) {
            if ((numPlayers == 1 && numTeams > 2)
                || numPlayers > 8
                || numPlayers * numTeams < (map.minPlayerCount ?? 0)) {
                continue;
            }
            const name = `${numPlayers}v`.repeat(numTeams - 1) + `${numPlayers}`;
            tagsOrder.set(name, 1000 * numTeams + numPlayers);
            mapTags.add(name);
        }
    }

    // Special logic for the 1v1v1 tag.
    if ((map.gameType.includes('ffa') && [3, 6].includes(map.playerCount))
        || startboxes.some(s => s.startboxes.length === 3 && s.maxPlayersPerStartbox <= 2)
    ) {
        const name = '1v1v1';
        tagsOrder.set(name, 3001);
        mapTags.add(name);
    }

    const info = {
        width: meta.smf.mapWidth / 64,
        height: meta.smf.mapHeight / 64,
        // Defaults from spring/cont/base/maphelper/maphelper/mapdefaults.lua
        windMin: orDefault('smd' in meta ? meta.smd.minWind : meta.mapInfo.atmosphere.minWind, 5),
        windMax: orDefault('smd' in meta ? meta.smd.maxWind : meta.mapInfo.atmosphere.maxWind, 25),
        tidalStrength: 'smd' in meta ? meta.smd.tidalStrength : meta.mapInfo.tidalStrength,
        tags: Array.from(mapTags).sort((a, b) => tagsOrder.get(a)! - tagsOrder.get(b)!),
        terrainOrdered: Array.from(map.terrain).sort((a, b) => terrainsOrder.get(a)! - terrainsOrder.get(b)!),
        minPlayerCount: map.minPlayerCount ?? Math.ceil(map.playerCount * 0.6)
    };

    // Sanity check because the metadata stuff is using `any` type.
    for (const [k, v] of Object.entries(info)) {
        if (v === undefined || v === '') {
            throw new Error(`Missing value for map ${map.springName} key ${k}`);
        }
    }

    return info;
}
