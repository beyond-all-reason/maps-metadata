// Script to update BYAR-Chobby repo based on latest state.
// Ran from GitHub Actions as part of deployment.

import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { readMapList } from './maps_metadata.js';
import pLimit from 'p-limit';
import got from 'got';

const prog = program
    .argument('<byar-chobby-repo>', 'Path to BYAR-Chobby repo.')
    .parse();
const [byarChobbyRepoPath] = prog.processedArgs;

// ImagePathMapper is a helper class to map map names to their corresponding
// image paths in the byar chobby repository that contains images. It performs
// normalization to make sure to pick up files that are already in the repo and
// not create duplicates.
class ImagePathMapper {
    private fileLookup: Map<string, string> = new Map();

    private constructor(private readonly imagesPath: string, private readonly extension: '.png' | '.jpg') {
        this.imagesPath = imagesPath;
        this.extension = extension;
    }

    private async init() {
        for (const image of await fs.readdir(this.imagesPath)) {
            if (image.endsWith(this.extension)) {
                const key = image.slice(0, -this.extension.length).toLowerCase();
                if (this.fileLookup.has(key)) {
                    throw new Error(`Duplicate image name: ${key}`);
                }
                this.fileLookup.set(
                    image.slice(0, -this.extension.length).toLowerCase(),
                    path.join(this.imagesPath, image));
            }
        }
    }

    public static async create(imagesPath: string, extension: '.png' | '.jpg'): Promise<ImagePathMapper> {
        const mapper = new ImagePathMapper(imagesPath, extension);
        await mapper.init();
        return mapper;
    }

    public getMapImagePath(mapName: string): string {
        const key = mapName.replace(/ /g, '_').toLowerCase();
        if (!this.fileLookup.has(key)) {
            return path.join(this.imagesPath, mapName.replace(/ /g, '_') + this.extension);
        }
        return this.fileLookup.get(key)!;
    }
}

const imagorUrlBase = 'https://maps-metadata.beyondallreason.dev/i/';

// WARNING: If you change any of those two parameters, it will regenerate all images so also change
// all images for current maps in Chobby repo.
const minimapOverrideUrlBase = `${imagorUrlBase}fit-in/1024x1024/filters:format(jpeg):quality(90)`;
const minimapThumbnailUrlBase = `${imagorUrlBase}fit-in/stretch/128x128/filters:fill(transparent):format(png)`;

const rowyBucket = 'rowy-1f075.appspot.com';
const overridesMapper = await ImagePathMapper.create(
    path.join(byarChobbyRepoPath, 'LuaMenu/configs/gameConfig/byar/minimapOverride'), '.jpg');
const thumbnailsMapper = await ImagePathMapper.create(
    path.join(byarChobbyRepoPath, 'LuaMenu/configs/gameConfig/byar/minimapThumbnail'), '.png');

const maps = await readMapList();

const requests: Promise<any>[] = [];
// Limit to 15 concurrent requests.
const limit = pLimit(15);

for (const map of Object.values(maps)) {
    for (const [mapper, urlBase] of [
        [overridesMapper, minimapOverrideUrlBase],
        [thumbnailsMapper, minimapThumbnailUrlBase],
    ] as Array<[ImagePathMapper, string]>) {
        requests.push(limit(() => {
            return pipeline(
                got.stream(`${urlBase}/${rowyBucket}/${encodeURI(map.photo[0].ref)}`),
                createWriteStream(mapper.getMapImagePath(map.springName))
            )
        }
        ));
    }
}
await Promise.all(requests);
