// Verifies additional properties of startpos that are not checked by the schema.

import { readMapList } from './maps_metadata.js';

let error = false;

const maps = await readMapList();
for (const map of Object.values(maps)) {
    if (!map.startPos) {
        if (map.startPosActive) {
            console.error(`startPosActive is set to true, but startPos not set`);
            error = true;
        }
        continue;
    }
    const confs: Map<number, Set<number>> = new Map();
    for (const team of map.startPos.team || []) {
        if (!confs.has(team.teamCount)) {
            confs.set(team.teamCount, new Set());
        }
        if (confs.get(team.teamCount)!.has(team.playersPerTeam)) {
            console.error(`There are duplicate startpos configurations for ${team.teamCount} teams with ${team.playersPerTeam} players`);
            error = true;
        }
        confs.get(team.teamCount)!.add(team.playersPerTeam);

        // TODO: maybe also check that positions are not out of bounds using map metadata?

        const errorPrefix = `Map ${map.springName} startpos for ${team.teamCount} teams ${team.playersPerTeam} players`;
        if (team.teamCount != team.sides.length) {
            console.error(`${errorPrefix} doesn't have correct number sides`);
            error = true;
        }
        for (const side of team.sides) {
            if (team.playersPerTeam != side.starts.length) {
                console.error(`${errorPrefix} side doesn't have correct number of players`);
                error = true;
            }
            for (const start of side.starts) {
                if (!(start.spawnPoint in map.startPos.positions)) {
                    console.error(`${errorPrefix} uses unknown position ${start.spawnPoint} for spawnPoint`);
                    error = true;
                }
                if (start.baseCenter && !(start.baseCenter in map.startPos.positions)) {
                    console.error(`${errorPrefix} uses unknown position ${start.spawnPoint} for spawnPoint`);
                    error = true;
                }
            }
        }
    }
}
if (error) {
    process.exit(1);
}
