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

// Precomputed average wind values from Monte Carlo simulation of the engine's
// wind random walk. Source: BAR's luaui/Widgets/gui_top_bar.lua updateAvgWind().
// Keys are [minWind][maxWind].
const avgWindTable: Record<number, Record<number, number>> = {
    0: { 1: 0.8, 2: 1.5, 3: 2.2, 4: 3.0, 5: 3.7, 6: 4.5, 7: 5.2, 8: 6.0, 9: 6.7, 10: 7.5, 11: 8.2, 12: 9.0, 13: 9.7, 14: 10.4, 15: 11.2, 16: 11.9, 17: 12.7, 18: 13.4, 19: 14.2, 20: 14.9, 21: 15.7, 22: 16.4, 23: 17.2, 24: 17.9, 25: 18.6, 26: 19.2, 27: 19.6, 28: 20.0, 29: 20.4, 30: 20.7 },
    1: { 2: 1.6, 3: 2.3, 4: 3.0, 5: 3.8, 6: 4.5, 7: 5.2, 8: 6.0, 9: 6.7, 10: 7.5, 11: 8.2, 12: 9.0, 13: 9.7, 14: 10.4, 15: 11.2, 16: 11.9, 17: 12.7, 18: 13.4, 19: 14.2, 20: 14.9, 21: 15.7, 22: 16.4, 23: 17.2, 24: 17.9, 25: 18.6, 26: 19.2, 27: 19.6, 28: 20.0, 29: 20.4, 30: 20.7 },
    2: { 3: 2.6, 4: 3.2, 5: 3.9, 6: 4.6, 7: 5.3, 8: 6.0, 9: 6.8, 10: 7.5, 11: 8.2, 12: 9.0, 13: 9.7, 14: 10.5, 15: 11.2, 16: 12.0, 17: 12.7, 18: 13.4, 19: 14.2, 20: 14.9, 21: 15.7, 22: 16.4, 23: 17.2, 24: 17.9, 25: 18.6, 26: 19.2, 27: 19.6, 28: 20.0, 29: 20.4, 30: 20.7 },
    3: { 4: 3.6, 5: 4.2, 6: 4.8, 7: 5.5, 8: 6.2, 9: 6.9, 10: 7.6, 11: 8.3, 12: 9.0, 13: 9.8, 14: 10.5, 15: 11.2, 16: 12.0, 17: 12.7, 18: 13.5, 19: 14.2, 20: 15.0, 21: 15.7, 22: 16.4, 23: 17.2, 24: 17.9, 25: 18.7, 26: 19.2, 27: 19.7, 28: 20.0, 29: 20.4, 30: 20.7 },
    4: { 5: 4.6, 6: 5.2, 7: 5.8, 8: 6.4, 9: 7.1, 10: 7.8, 11: 8.5, 12: 9.2, 13: 9.9, 14: 10.6, 15: 11.3, 16: 12.1, 17: 12.8, 18: 13.5, 19: 14.3, 20: 15.0, 21: 15.7, 22: 16.5, 23: 17.2, 24: 18.0, 25: 18.7, 26: 19.2, 27: 19.7, 28: 20.1, 29: 20.4, 30: 20.7 },
    5: { 6: 5.5, 7: 6.1, 8: 6.8, 9: 7.4, 10: 8.0, 11: 8.7, 12: 9.4, 13: 10.1, 14: 10.8, 15: 11.5, 16: 12.2, 17: 12.9, 18: 13.6, 19: 14.4, 20: 15.1, 21: 15.8, 22: 16.5, 23: 17.3, 24: 18.0, 25: 18.8, 26: 19.3, 27: 19.7, 28: 20.1, 29: 20.4, 30: 20.7 },
    6: { 7: 6.5, 8: 7.1, 9: 7.7, 10: 8.4, 11: 9.0, 12: 9.7, 13: 10.3, 14: 11.0, 15: 11.7, 16: 12.4, 17: 13.1, 18: 13.8, 19: 14.5, 20: 15.2, 21: 15.9, 22: 16.7, 23: 17.4, 24: 18.1, 25: 18.8, 26: 19.4, 27: 19.8, 28: 20.2, 29: 20.5, 30: 20.8 },
    7: { 8: 7.5, 9: 8.1, 10: 8.7, 11: 9.3, 12: 10.0, 13: 10.6, 14: 11.3, 15: 11.9, 16: 12.6, 17: 13.3, 18: 14.0, 19: 14.7, 20: 15.4, 21: 16.1, 22: 16.8, 23: 17.5, 24: 18.2, 25: 19.0, 26: 19.5, 27: 19.9, 28: 20.3, 29: 20.6, 30: 20.9 },
    8: { 9: 8.5, 10: 9.1, 11: 9.7, 12: 10.3, 13: 11.0, 14: 11.6, 15: 12.2, 16: 12.9, 17: 13.6, 18: 14.2, 19: 14.9, 20: 15.6, 21: 16.3, 22: 17.0, 23: 17.7, 24: 18.4, 25: 19.1, 26: 19.6, 27: 20.0, 28: 20.4, 29: 20.7, 30: 21.0 },
    9: { 10: 9.5, 11: 10.1, 12: 10.7, 13: 11.3, 14: 11.9, 15: 12.6, 16: 13.2, 17: 13.8, 18: 14.5, 19: 15.2, 20: 15.8, 21: 16.5, 22: 17.2, 23: 17.9, 24: 18.6, 25: 19.3, 26: 19.8, 27: 20.2, 28: 20.5, 29: 20.8, 30: 21.1 },
    10: { 11: 10.5, 12: 11.1, 13: 11.7, 14: 12.3, 15: 12.9, 16: 13.5, 17: 14.2, 18: 14.8, 19: 15.4, 20: 16.1, 21: 16.8, 22: 17.4, 23: 18.1, 24: 18.8, 25: 19.5, 26: 20.0, 27: 20.4, 28: 20.7, 29: 21.0, 30: 21.2 },
    11: { 12: 11.5, 13: 12.1, 14: 12.7, 15: 13.3, 16: 13.9, 17: 14.5, 18: 15.1, 19: 15.8, 20: 16.4, 21: 17.1, 22: 17.7, 23: 18.4, 24: 19.1, 25: 19.7, 26: 20.2, 27: 20.6, 28: 20.9, 29: 21.2, 30: 21.4 },
    12: { 13: 12.5, 14: 13.1, 15: 13.6, 16: 14.2, 17: 14.9, 18: 15.5, 19: 16.1, 20: 16.7, 21: 17.4, 22: 18.0, 23: 18.7, 24: 19.3, 25: 20.0, 26: 20.4, 27: 20.8, 28: 21.1, 29: 21.4, 30: 21.6 },
    13: { 14: 13.5, 15: 14.1, 16: 14.6, 17: 15.2, 18: 15.8, 19: 16.5, 20: 17.1, 21: 17.7, 22: 18.4, 23: 19.0, 24: 19.6, 25: 20.3, 26: 20.7, 27: 21.1, 28: 21.4, 29: 21.6, 30: 21.8 },
    14: { 15: 14.5, 16: 15.0, 17: 15.6, 18: 16.2, 19: 16.8, 20: 17.4, 21: 18.1, 22: 18.7, 23: 19.3, 24: 20.0, 25: 20.6, 26: 21.0, 27: 21.3, 28: 21.6, 29: 21.8, 30: 22.0 },
    15: { 16: 15.5, 17: 16.0, 18: 16.6, 19: 17.2, 20: 17.8, 21: 18.4, 22: 19.0, 23: 19.6, 24: 20.3, 25: 20.9, 26: 21.3, 27: 21.6, 28: 21.9, 29: 22.1, 30: 22.3 },
    16: { 17: 16.5, 18: 17.0, 19: 17.6, 20: 18.2, 21: 18.8, 22: 19.4, 23: 20.0, 24: 20.6, 25: 21.3, 26: 21.7, 27: 21.9, 28: 22.2, 29: 22.4, 30: 22.5 },
    17: { 18: 17.5, 19: 18.0, 20: 18.6, 21: 19.2, 22: 19.8, 23: 20.4, 24: 21.0, 25: 21.6, 26: 22.0, 27: 22.3, 28: 22.5, 29: 22.7, 30: 22.8 },
    18: { 19: 18.5, 20: 19.0, 21: 19.6, 22: 20.2, 23: 20.8, 24: 21.4, 25: 22.0, 26: 22.4, 27: 22.6, 28: 22.8, 29: 23.0, 30: 23.1 },
    19: { 20: 19.5, 21: 20.0, 22: 20.6, 23: 21.2, 24: 21.8, 25: 22.4, 26: 22.7, 27: 22.9, 28: 23.1, 29: 23.2, 30: 23.4 },
    20: { 21: 20.4, 22: 21.0, 23: 21.6, 24: 22.2, 25: 22.8, 26: 23.1, 27: 23.3, 28: 23.4, 29: 23.6, 30: 23.7 },
    21: { 22: 21.4, 23: 22.0, 24: 22.6, 25: 23.2, 26: 23.5, 27: 23.6, 28: 23.8, 29: 23.9, 30: 24.0 },
    22: { 23: 22.4, 24: 23.0, 25: 23.6, 26: 23.8, 27: 24.0, 28: 24.1, 29: 24.2, 30: 24.2 },
    23: { 24: 23.4, 25: 24.0, 26: 24.2, 27: 24.4, 28: 24.4, 29: 24.5, 30: 24.5 },
    24: { 25: 24.4, 26: 24.6, 27: 24.7, 28: 24.7, 29: 24.8, 30: 24.8 },
};

function getAvgWind(windMin: number, windMax: number): number | undefined {
    if (windMin === windMax) return windMin;
    return avgWindTable[windMin]?.[windMax];
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
        mapHeightMin: meta.minHeight,
        mapHeightMax: meta.maxHeight,
        // Defaults from spring/cont/base/maphelper/maphelper/mapdefaults.lua
        windMin: orDefault('smd' in meta ? meta.smd.minWind : meta.mapInfo.atmosphere.minWind, 5),
        windMax: orDefault('smd' in meta ? meta.smd.maxWind : meta.mapInfo.atmosphere.maxWind, 25),
        windAvg: getAvgWind(
            orDefault('smd' in meta ? meta.smd.minWind : meta.mapInfo.atmosphere.minWind, 5),
            orDefault('smd' in meta ? meta.smd.maxWind : meta.mapInfo.atmosphere.maxWind, 25),
        ),
        tidalStrength: 'smd' in meta ? meta.smd.tidalStrength : meta.mapInfo.tidalStrength,
        version: meta.mapInfo?.version as string | undefined,
        voidWater: orDefault(meta.mapInfo?.voidWater as boolean | undefined, false),
        tags: Array.from(mapTags).sort((a, b) => tagsOrder.get(a)! - tagsOrder.get(b)!),
        terrainOrdered: Array.from(map.terrain).sort((a, b) => terrainsOrder.get(a)! - terrainsOrder.get(b)!),
        minPlayerCount: map.minPlayerCount ?? Math.ceil(map.playerCount * 0.6)
    };

    // Sanity check because the metadata stuff is using `any` type.
    for (const [k, v] of Object.entries(info)) {
        if (k === 'windAvg') continue;
        if (k === 'version') continue; // version is optional in mapinfo.lua
        if (v === undefined || v === '') {
            throw new Error(`Missing value for map ${map.springName} key ${k}`);
        }
    }

    return info;
}
