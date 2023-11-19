// Verifies additional properties of startboxes that are not checked by the schema.

import { readMapList } from './maps_metadata.js';

let error = false;

const maps = await readMapList();
for (const map of Object.values(maps)) {
    if (!map.startboxesSet) {
        continue;
    }
    const players = new Set<number>();
    for (const startboxesInfo of Object.values(map.startboxesSet)) {
        const startboxes = startboxesInfo.startboxes;
        if (players.has(startboxes.length)) {
            console.error(`Map ${map.springName} has multiple startboxes with for the same number (${startboxes.length}) of players.`);
            error = true;
        }
        players.add(startboxes.length);

        for (const startbox of startboxes) {
            const [a, b] = startbox.poly;
            if (a.x >= b.x || a.y >= b.y) {
                console.error(`Map ${map.springName} has a startbox for players ${startboxes.length} with invalid coordinates: ${JSON.stringify(startbox)}`);
                error = true;
            }
        }

        if (startboxes.length * startboxesInfo.maxPlayersPerStartbox > map.playerCount) {
            console.error(`Map ${map.springName} has startboxes for ${startboxes.length} players with ${startboxesInfo.maxPlayersPerStartbox} player count, but maxPlayers for map is ${map.playerCount}.`);
            error = true;
        }
    }
}
if (error) {
    process.exit(1);
}
