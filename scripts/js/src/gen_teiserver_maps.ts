import { readMapList } from "./maps_metadata.js";
import fs from "node:fs/promises";
import { program } from "@commander-js/extra-typings";
import stringify from "json-stable-stringify";
import type {
  TeiserverMapInfo,
  TeiserverMaps,
} from "../../../gen/types/teiserver_maps.js";
import { MapModoptions } from '../../../gen/types/map_modoptions.js';

const imagorUrlBase = 'https://maps-metadata.beyondallreason.dev/i/';
const rowyBucket = 'rowy-1f075.appspot.com';

async function readMapModoptions(): Promise<{[springName: string]: MapModoptions['modoptions']}> {
    const contents = await fs.readFile('gen/map_modoptions.validated.json', { 'encoding': 'utf8' });
    const mapModoptions = JSON.parse(contents) as MapModoptions[];
    return Object.fromEntries(mapModoptions.map((m) => [m.springName, m.modoptions]));
}

async function genTeiserverMaps(): Promise<string> {
  const maps = await readMapList();
  const mapModoptions = await readMapModoptions();

  const tMaps: TeiserverMapInfo[] = [];
  for (const [_rowyId, map] of Object.entries(maps)) {
    if (!map.inPool) {
      continue;
    }

    // TODO: Do some better mapping, maybe add dedicated clear map lists
    // in Rowy for exactly this purpose. Atm just reusing the one that
    // exists for competitive 1v1.
    const matchmakingQueues: TeiserverMapInfo["matchmakingQueues"] = [];
    if (map.mapLists?.includes("competitive2p")) {
      matchmakingQueues.push("1v1");
    }

    tMaps.push({
      springName: map.springName,
      displayName: map.displayName,
      thumbnail: `${imagorUrlBase}fit-in/640x640/filters:format(webp):quality(85)/${rowyBucket}/${encodeURI(map.photo[0].ref)}`,
      startboxesSet: Object.values(map.startboxesSet || {}),
      matchmakingQueues,
      modoptions: mapModoptions[map.springName]
    });
  }

  tMaps.sort((a, b) => a.springName.localeCompare(b.springName));
  const teiserverMaps: TeiserverMaps = { maps: tMaps };
  return stringify(teiserverMaps);
}

const prog = program
  .argument("<teiserverMaps>", "Lobby maps output path.")
  .parse();
const [teiserverMapsPath] = prog.processedArgs;
await fs.writeFile(teiserverMapsPath, await genTeiserverMaps());
