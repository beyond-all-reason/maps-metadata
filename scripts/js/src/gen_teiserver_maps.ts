import { readMapList } from "./maps_metadata.js";
import fs from "node:fs/promises";
import { program } from "@commander-js/extra-typings";
import stringify from "json-stable-stringify";
import type {
  TeiserverMapInfo,
  TeiserverMaps,
} from "../../../gen/types/teiserver_maps.js";
import { MapModoptions } from '../../../gen/types/map_modoptions.js';
import type { StartboxesInfo } from '../../../gen/types/map_list.js';

// TEIServer's data model and Tachyon protocol only carry axis-aligned
// rectangles ({top, bottom, left, right} in [0,1] coords). When a map ships
// an N-point polygon (or a Catmull-Rom spline) startbox, collapse it to its
// bounding-box rectangle here so TEIServer keeps validating without a
// schema change on its side. The full polygon shape is preserved in the
// mapmetadata_startboxes_set modoption (see gen_map_modoptions.ts) and
// decoded game-side; this rectified copy is only the rect-only view for
// TEIServer/Tachyon.
function rectifyStartboxes(set: StartboxesInfo[]): StartboxesInfo[] {
  return set.map(info => ({
    ...info,
    // The cast covers two unrelated narrowing issues:
    //   1) json2ts renders `minItems: 1` as a non-empty tuple
    //      `[Startbox, ...Startbox[]]`, but `.map()` returns plain `Startbox[]`.
    //   2) json2ts renders `minItems: 2 / maxItems: 2` as a tuple too, and the
    //      array literal `[{x,y},{x,y}]` widens to `{x,y}[]` rather than the
    //      tuple shape, so the `oneOf` rect branch wouldn't match without help.
    // The runtime shape is correct in both cases; we just bypass the inference.
    startboxes: info.startboxes.map(box => {
      if (box.poly.length === 2) return box;
      let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
      for (const p of box.poly) {
        if (p.x < xmin) xmin = p.x;
        if (p.x > xmax) xmax = p.x;
        if (p.y < ymin) ymin = p.y;
        if (p.y > ymax) ymax = p.y;
      }
      return { poly: [{ x: xmin, y: ymin }, { x: xmax, y: ymax }] };
    }) as StartboxesInfo['startboxes']
  }));
}

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
