import { getMapFilePath, readMapList } from './maps_metadata.js';
import pLimit from 'p-limit';
import fs from 'node:fs/promises';
import { program } from '@commander-js/extra-typings';
import { MapList } from '../../../gen/types/map_list.js';

export interface MapDetails {
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

async function fetchMapsMetadata(maps: MapList): Promise<Map<string, any>> {
    const limit = pLimit(10);

    const metadata = Object.entries(maps).map(([id, m]) => limit(async (): Promise<[string, any]> => {
        const path = await getMapFilePath(m.springName, 'metadata.json');
        const meta = JSON.parse(await fs.readFile(path, { encoding: 'utf8' }));
        return [id, meta];
    }));
    return new Map(await Promise.all(metadata));
}

function buildMapDetails(maps: MapList, mapsMetadata: Map<string, any>): MapDetails {
    const mapDetails: MapDetails = {};
    for (const id of Object.keys(maps)) {
        const mapInfo = maps[id];
        const meta = mapsMetadata.get(id);

        mapDetails[mapInfo.springName] = {
            Width: meta.smf.mapWidth / 64,
            Height: meta.smf.mapHeight / 64,
            Is1v1: mapInfo.gameType.includes('1v1') ? 1 : undefined,
            IsTeam: mapInfo.gameType.includes('team') ? 1 : undefined,
            IsFFA: mapInfo.gameType.includes('ffa') ? 1 : undefined,
            IsCertified: mapInfo.certified ? 1 : undefined,
            Special: mapInfo.special,
            Flat: mapInfo.terrain.includes('flat') ? 1 : undefined,
            Hills: mapInfo.terrain.includes('hills') ? 1 : undefined,
            Water: mapInfo.terrain.includes('water') ? 1 : undefined,
            IsInPool: mapInfo.inPool ? 1 : undefined,
            PlayerCount: mapInfo.playerCount ? mapInfo.playerCount.toString() : undefined,
            TeamCount: mapInfo.teamCount ? mapInfo.teamCount.toString() : undefined,
            Author: mapInfo.author != 'UNKNOWN' ? mapInfo.author : undefined,
            InfoText: mapInfo.description,
        }
    }
    return mapDetails;
}

function serializeMapDetails(mapDetails: MapDetails): string {
    const fieldsOrder = [
        'Width',
        'Height',
        'Is1v1',
        'IsTeam',
        'IsFFA',
        'IsCertified',
        'Special',
        'Flat',
        'Hills',
        'Water',
        'IsInPool',
        'PlayerCount',
        'TeamCount',
        'Author',
        'InfoText'
    ];

    function escapeLuaString(str: string): string {
        return str
            .replaceAll('\\', '\\\\')
            .replaceAll('\n', '\\n')
            .replaceAll('\'', '\\\'');
    }

    const lines: string[] = ['return {'];
    const springNames = Object.keys(mapDetails);
    springNames.sort();
    for (const springName of springNames) {
        const details: any = mapDetails[springName];
        const fields: string[] = [];
        for (const field of fieldsOrder) {
            let value: string;
            if (details[field] === undefined) {
                value = 'nil';
            } else if (typeof details[field] === 'number') {
                value = details[field].toString();
            } else {
                value = `'${escapeLuaString(details[field].toString())}'`;
            }
        }
        lines.push(`['${escapeLuaString(springName)}']={${fields.join(', ')}},`);
    }
    lines.push('}\n');
    return lines.join('\n');
}

const prog = program
    .argument('<mapDetails>', 'Map details output.')
    .parse();
const [mapDetailsPath] = prog.processedArgs;

const maps = await readMapList();

await fs.writeFile(mapDetailsPath,
    serializeMapDetails(
        buildMapDetails(maps, await fetchMapsMetadata(maps))));
