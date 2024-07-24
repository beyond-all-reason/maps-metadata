// Script generating map presets and map battle presets for SPADS. Those
// presets are setting modoptions per map on the server side.

import fs from 'node:fs/promises';
import { program } from '@commander-js/extra-typings';
import { MapModoptions } from '../../../gen/types/map_modoptions.js';

async function readMapModoptions(): Promise<MapModoptions[]> {
    const contents = await fs.readFile('gen/map_modoptions.validated.json', { 'encoding': 'utf8' });
    return JSON.parse(contents) as MapModoptions[];
}

const AUTOMATED_HEADER = `#
# AUTOMATICALLY GENERATED FILE, DO NOT EDIT!
#
# This file is automatically generated from the beyond-all-reason/maps-metadata repository and any
# changes here will be overridden by the next update. If you want to make any changes please follow
# https://github.com/beyond-all-reason/maps-metadata/wiki/Adding-a-created-map-to-the-game
#
`;

function genPresets(mapModoptions: MapModoptions[]): [string, string] {
    let preset =
`${AUTOMATED_HEADER}
[_DEFAULT_.smf] (transparent)
battlePreset:map_DEFAULT
`;

    let battlePreset =
`${AUTOMATED_HEADER}
[map_DEFAULT] (transparent)
${Object.keys(mapModoptions[0].modoptions).join(':\n')}:
`;

    for (const m of mapModoptions) {
        const battlePresetName = 'map_' + m.springName.replace(/[^a-zA-Z0-9_]/g, '_');

        preset +=
`
[${m.springName}.smf] (transparent)
battlePreset:${battlePresetName}
`;

        battlePreset +=
`
[${battlePresetName}] (transparent)
${Object.entries(m.modoptions).map(([k, v]) => `${k}:${v}`).join('\n')}
`;
    }

    return [preset, battlePreset];
}

const prog = program
    .argument('<mapPresets>', 'Map presets output path.')
    .argument('<mapBattlePresets>', 'Map battle presets output path.')
    .parse();
const [mapPresetsPath, mapBattlePresetsPath] = prog.processedArgs;
const [mapPresets, mapBattlePresets] = genPresets(await readMapModoptions());
await fs.writeFile(mapPresetsPath, mapPresets);
await fs.writeFile(mapBattlePresetsPath, mapBattlePresets);
