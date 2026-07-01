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
            console.error(`Map ${map.springName} has multiple startbox configurations for the same number (${startboxes.length}) of teams.`);
            error = true;
        }
        players.add(startboxes.length);

        for (const startbox of startboxes) {
            const poly = startbox.poly;
            if (poly.length === 2) {
                // Legacy 2-point rectangle: top-left and bottom-right corners.
                const [a, b] = poly;
                if (a.x >= b.x || a.y >= b.y) {
                    console.error(`Map ${map.springName} has a startbox for players ${startboxes.length} with invalid rectangle coordinates: ${JSON.stringify(startbox)}`);
                    error = true;
                }
            } else {
                // N-point polygon: reject rings with ~zero signed (shoelace) area.
                // Concavity and most self-intersections pass (game-side containment
                // uses ray-casting), but a self-intersecting ring whose signed area
                // cancels to ~0 is rejected here too.
                let area2 = 0;
                for (let i = 0; i < poly.length; i++) {
                    const a = poly[i];
                    const b = poly[(i + 1) % poly.length];
                    area2 += a.x * b.y - b.x * a.y;
                }
                if (Math.abs(area2) < 1) {
                    console.error(`Map ${map.springName} has a degenerate polygon startbox for players ${startboxes.length}: ${JSON.stringify(startbox)}`);
                    error = true;
                }
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
