import { MapList } from "../../gen/map_list.d.ts";
import { pooledMap } from "https://deno.land/std@0.182.0/async/pool.ts";

const maps = JSON.parse(await Deno.readTextFile(Deno.args[0])) as MapList;

const mapsInfo = pooledMap(10, maps.map((map) => map.springname), (name) => {
    return fetch(
        `https://files-cdn.beyondallreason.dev/find?category=map&springname=${
            encodeURIComponent(name)
        }`,
    );
});

for await (const infoResp of mapsInfo) {
    if (!infoResp.ok) {
        console.error(
            `Error fetching map info ${infoResp.url}: ${infoResp.statusText}`,
        );
        Deno.exit(1);
    }
}
