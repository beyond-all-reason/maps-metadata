// Imports startboxes from https://github.com/beyond-all-reason/spads_config_bar/blob/main/etc/mapBoxes.conf to rowy.

import { Firestore } from '@google-cloud/firestore';
import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';
import { readMapList } from '../maps_metadata.js';
import type { MapList, Startbox, StartboxesInfo, Point } from '../../../../gen/types/map_list.js';

// Parses mapBoxes.conf which is in format
function parseMapBoxes(contents: string): Map<string, StartboxesInfo[]> {
    const mapToStartboxes: Map<string, StartboxesInfo[]> = new Map();

    const lines = contents.split("\n");
    for (let line of lines) {
        // Ignore empty lines or comment lines
        if (line.trim() === "" || line.trim().startsWith("#")) continue;

        const [mapData, startboxData] = line.split("|");
        const [mapName, nbTeams] = mapData.split(".smf:");

        const startboxes: Startbox[] = startboxData.split(";").map(box => {
            const [x1, y1, x2, y2] = box.split(" ").map(Number);
            const poly: [Point, Point] = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
            return { poly };
        });
        if (startboxes.length !== Number(nbTeams)) {
            throw new Error(`Expected ${nbTeams} startboxes for ${mapName} but got ${startboxes.length}`);
        }
        if (startboxes.length < 1) {
            throw new Error(`Expected at least 1 startboxes for ${mapName} but got ${startboxes.length}`);
        }
        const startboxesInfo: StartboxesInfo = { startboxes: startboxes as any };
        if (mapToStartboxes.has(mapName)) {
            mapToStartboxes.get(mapName)!.push(startboxesInfo);
        } else {
            mapToStartboxes.set(mapName, [startboxesInfo]);
        }
    }
    return mapToStartboxes;
}

const prog = program
    .argument('<mapBoxesPath>', 'Map boxes path.')
    .parse();
const contents = await fs.readFile(prog.processedArgs[0], { encoding: 'utf8' });
const mapToStartboxes = parseMapBoxes(contents);

const mapList: MapList = await readMapList();
const springNameToId: Map<string, string> = new Map(Object.entries(mapList).map(([id, map]) => [map.springName, id]));

// console.log(JSON.stringify(Object.fromEntries(mapToStartboxes), null, 2));

const firestore = new Firestore();

for (const [springName, startboxeses] of mapToStartboxes) {
    if (!springNameToId.has(springName)) {
        console.warn(`No map with springName ${springName}`);
        continue;
    }
    const mapId = springNameToId.get(springName)!;
    console.log(`Updating ${springName} with ${startboxeses.length} startboxes`);
    for (const startboxesInfo of startboxeses) {
        console.log(`  team ${startboxesInfo.startboxes.length}`);
        await firestore.collection('maps').doc(mapId).collection('startboxesSet').add({
            startboxes: startboxesInfo.startboxes,
            numTeams: startboxesInfo.startboxes.length,
        });
    }
}
