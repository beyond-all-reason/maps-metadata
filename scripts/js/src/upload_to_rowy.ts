import { Firestore } from '@google-cloud/firestore';
import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';
import type { MapList } from '../../../gen/types/map_list.js';

/*
To create dump:

dump.lua:
```
json = require "json"
md = require "mapDetails"
file = io.open("mapDetails.json", "w")
io.output(file)
io.write(json.encode(md))
io.close(file)
```

json.lua from https://github.com/rxi/json.lua

$ lua5.1 dump.lua
*/

const prog = program
    .argument('<mapDetails>', 'Map details in JSON.')
    .parse();
const [mapDetailsPath] = prog.processedArgs;

interface MapDetails {
    [k: string]: {
        Width: number;
        Height: number;
        Is1v1?: number;
        IsTeam?: number;
        IsFFA?: number;
        IsCertified?: number;
        Special?: string;
        Flat?: number;
        Hills?: number;
        Water?: number;
        IsInPool?: number;
        PlayerCount?: string;
        TeamCount?: string;
        Author?: string;
        InfoText?: string;
    };
}

const mapDetails: MapDetails = JSON.parse(await fs.readFile(mapDetailsPath, { encoding: 'utf8' }));

const firestore = new Firestore();
const maps = firestore.collection('maps');

const docRefs = await maps.listDocuments();
const docs = await firestore.getAll(...docRefs);
const existingMaps: Set<string> = new Set(docs
    .map(d => d.data())
    .filter(e => e != undefined)
    .map(e => e!['springName']));

const mapList: MapList = {};

for (const [springName, detail] of Object.entries(mapDetails)) {
    if (existingMaps.has(springName)) {
        console.log(`${springName} already in rowy`);
        continue;
    }
    mapList[springName] = {
        springName: springName,
        author: detail.Author || "UNKNOWN",
        certified: !!detail.IsCertified,
        inPool: !!detail.IsInPool,
        terrain: [],
        gameType: [],
    }
    const e = mapList[springName];

    if (detail.PlayerCount) e.playerCount = parseInt(detail.PlayerCount, 10);
    if (detail.TeamCount) e.teamCount = parseInt(detail.TeamCount, 10);
    if (detail.InfoText) e.description = detail.InfoText;
    if (detail.IsFFA) e.gameType.push('ffa');
    if (detail.IsTeam) e.gameType.push('team');
    if (detail.Is1v1) e.gameType.push('1v1');
    if (detail.Flat) e.terrain.push('flat');
    if (detail.Hills) e.terrain.push('hills');
    if (detail.Water) e.terrain.push('water');
    if (detail.Special) e.special = detail.Special;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const toAdd = Object.values(mapList);
for (const [i, e] of toAdd.entries()) {
    console.log(`${i}/${toAdd.length} adding ${e.springName}`);

    // By default script is not armed as it's dangerous.
    console.log("Not doing anything, script disarmed");
    // await maps.add(e);

    await delay(10000);
}
