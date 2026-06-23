import { readMapList, readMapModoptionsBySpringName } from "./maps_metadata.js";
import fs from "node:fs/promises";
import { program } from "@commander-js/extra-typings";
import stringify from "json-stable-stringify";
import type {
  TeiserverMapInfo,
  TeiserverMaps,
} from "../../../gen/types/teiserver_maps.js";
import type { StartboxesInfo } from '../../../gen/types/map_list.js';
import { polyBoundingRect } from './startbox_utils.js';

// Collapse polygons to their bounding box for rect-only TEIServer/Tachyon.
// [first, ...rest] keeps the result a non-empty tuple (minItems: 1).
function rectifyStartboxes(set: StartboxesInfo[]): StartboxesInfo[] {
  return set.map(info => {
    const [first, ...rest] = info.startboxes;
    return {
      ...info,
      startboxes: [
        { poly: polyBoundingRect(first.poly) },
        ...rest.map(box => ({ poly: polyBoundingRect(box.poly) })),
      ],
    };
  });
}

const imagorUrlBase = 'https://maps-metadata.beyondallreason.dev/i/';
const rowyBucket = 'rowy-1f075.appspot.com';

async function genTeiserverMaps(): Promise<string> {
  const maps = await readMapList();
  const mapModoptions = await readMapModoptionsBySpringName();

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
      startboxesSet: rectifyStartboxes(Object.values(map.startboxesSet || {})),
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
