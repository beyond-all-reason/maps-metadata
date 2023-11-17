// Synces maps data to Webflow collection.

import { writeFileSync, readFileSync } from 'node:fs';
import util from 'util';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import got from 'got';
import Webflow from 'webflow-api';
import { Item as WebflowItem, Collection as WebflowCollection } from 'webflow-api/dist/api';
import Bottleneck from 'bottleneck';
import { program } from '@commander-js/extra-typings';
import { readMapList, fetchMapsMetadata, getParsedMapLocation } from './maps_metadata.js';
import { MapList } from '../../../gen/types/map_list.js';
import { readMapCDNInfos } from './cdn_maps.js';
import { MapCDNInfo } from '../../../gen/types/cdn_maps.js';
import { WebflowMapFieldsRead, WebflowMapFieldsWrite, WebflowImageRef } from './webflow_types.js';
import assert from 'node:assert';
import pLimit, { LimitFunction } from 'p-limit';

const mapsCacheDir = process.env.MAPS_CACHE_DIR || '.maps-cache'

class ImageHashesCache {
    private readonly limit: LimitFunction;
    private newHashes: number = 0;
    private readonly cachePath: string;
    private static readonly imageHashesCacheVersion: number = 1;
    private readonly imageHashesCache: Map<string, string>;

    constructor(cachePath: string) {
        this.limit = pLimit(10);
        this.cachePath = cachePath;
        this.imageHashesCache = new Map();

        process.on('beforeExit', () => this.saveImageHashesCacheSync());
        try {
            const c = JSON.parse(readFileSync(
                this.cachePath, { encoding: 'utf8' }));
            if (c.version == ImageHashesCache.imageHashesCacheVersion) {
                this.imageHashesCache = new Map(c.entries);
            }
        } catch (e) {
            console.warn(`Warning: ${e}`);
        }
    }

    saveImageHashesCacheSync() {
        try {
            writeFileSync(
                this.cachePath,
                JSON.stringify({
                    version: ImageHashesCache.imageHashesCacheVersion,
                    entries: [...this.imageHashesCache]
                }));
        } catch (e) {
            console.warn(`Warning: ${e}`);
        }
    }

    // getImageHash returns the hash of the image at the given url.
    async getImageHash(url: string | undefined): Promise<string> {
        if (!url) {
            return '';
        }
        if (this.imageHashesCache.has(url)) {
            return this.imageHashesCache.get(url)!;
        }
        const hash = createHash('sha256');
        await this.limit(() => pipeline(got.stream(url), hash));
        const digest = hash.digest('hex');
        console.log(`Hashed ${url} to ${digest}`);
        this.imageHashesCache.set(url, digest);

        if (++this.newHashes > 30) {
            this.saveImageHashesCacheSync();
            this.newHashes = 0;
        }
        return digest;
    }
}

// Cache of url to image hash so we don't have to download the image to get the hash.
const imageHashesCache = new ImageHashesCache(path.join(mapsCacheDir, 'imageHashesCache.json'));

const getImageHash = (url: string | undefined) => imageHashesCache.getImageHash(url);

async function sameImage(url1?: string, url2?: string): Promise<boolean> {
    const [h1, h2] = await Promise.all([getImageHash(url1), getImageHash(url2)]);
    return h1 === h2;
}

async function sameImages(urls1: string[], urls2: string[]): Promise<boolean> {
    const [h1, h2] = await Promise.all([
        Promise.all(urls1.map(getImageHash)),
        Promise.all(urls2.map(getImageHash))
    ]);
    if (urls1.length !== urls2.length) {
        return false;
    }
    h1.sort();
    h2.sort();
    return h1.every((v, i) => v === h2[i]);
}

async function pickImage(url: string, base?: WebflowImageRef): Promise<string> {
    if (base && await sameImage(url, base.url)) {
        return base.fileId;
    }
    return url;
}

async function pickImages(urls: string[], base?: WebflowImageRef[]): Promise<string[]> {
    const [h, hBaseEntries] = await Promise.all([
        Promise.all(urls.map(async url => {
            return [url, await getImageHash(url)] as [string, string];
        })),
        Promise.all((base || []).map(async i => {
            return [await getImageHash(i.url), i.fileId] as [string, string];
        }))
    ]);
    const hBase = new Map(hBaseEntries);
    return h.map(([url, hash]) => {
        const baseFileId = hBase.get(hash);
        if (baseFileId) {
            return baseFileId;
        }
        return url;
    });
}

/**
 * There are 3 layers of data mapping in this script:
 * 1. Source of data in the format of MapList as used in this repository
 *    and ammended with cdn info etc.
 * 2. Native Webflow represention of data as used by the Webflow API.
 * 3. Internal WebsiteMapInfo representation of data in this script which
 *    is used to bridge the gap between 1 and 2.
 *
 * We use the internal representation because both the source and the
 * Webflow API have different ways of representing the same data with
 * webflow e.g. requiring a two fiels for a photo: one for actual image
 * and second for a url to the image.
 */


// WebsiteMapInfo is the internal representation of data used in this script.
// it is the most thruthful representation of data as we want it to be in
// webflow.
interface WebsiteMapInfo {
    name: string;
    rowyId: string;
    minimapUrl: string;
    downloadUrl: string;
    width: number;
    height: number;
    mapSize: number;
    description?: string;
    author: string;
    bgImageUrl?: string;
    perspectiveShotUrl?: string;
    moreImagesUrl: string[];
    windMin?: number;
    windMax?: number;
    tidalStrength?: number;
    teamCount: number;
    maxPlayers: number;
    textureMapUrl: string;
    heightMapUrl: string;
    metalMapUrl: string;
}

async function isWebflowMapInfoEqual(a: WebsiteMapInfo, b: WebsiteMapInfo): Promise<boolean> {
    const allImagesSame = (await Promise.all([
        sameImage(a.minimapUrl, b.minimapUrl),
        sameImage(a.bgImageUrl, b.bgImageUrl),
        sameImage(a.perspectiveShotUrl, b.perspectiveShotUrl),
        sameImages(a.moreImagesUrl, b.moreImagesUrl),
        sameImage(a.textureMapUrl, b.textureMapUrl),
        sameImage(a.heightMapUrl, b.heightMapUrl),
        sameImage(a.metalMapUrl, b.metalMapUrl)
    ])).every(x => x);

    return allImagesSame &&
        a.name === b.name &&
        a.rowyId === b.rowyId &&
        a.downloadUrl === b.downloadUrl &&
        a.width === b.width &&
        a.height === b.height &&
        a.mapSize === b.mapSize &&
        a.description === b.description &&
        a.author === b.author &&
        a.windMin === b.windMin &&
        a.windMax === b.windMax &&
        a.tidalStrength === b.tidalStrength &&
        a.teamCount === b.teamCount &&
        a.maxPlayers === b.maxPlayers;
}


interface WebflowMapInfo extends WebsiteMapInfo { }

// WebflowMap is the native Webflow representation of data as used by the
// Webflow API.
class WebflowMapInfo {
    item: WebflowItem & WebflowMapFieldsRead;

    constructor(item: WebflowItem) {
        const o = this.item = item as WebflowItem & WebflowMapFieldsRead;

        this.name = o.name;
        this.rowyId = o.rowyid || '';
        this.minimapUrl = o.minimap?.url || '';
        this.downloadUrl = o.downloadurl || '';
        this.width = o.width || 0;
        this.height = o.height || 0;
        this.mapSize = o.mapsize || 0;
        this.description = o.description;
        this.author = o.author || '';
        this.bgImageUrl = o['bg-image']?.url;
        this.perspectiveShotUrl = o['perspective-shot']?.url;
        this.moreImagesUrl = o['more-images']?.map(i => i.url) || [];
        this.windMin = o['wind-min'];
        this.windMax = o['wind-max'];
        this.tidalStrength = o['tidal-strength'];
        this.teamCount = o['team-count'] || 0;
        this.maxPlayers = o['max-players'] || 0;
        this.textureMapUrl = o['mini-map']?.url || '';
        this.heightMapUrl = o['height-map']?.url || '';
        this.metalMapUrl = o['metal-map']?.url || '';
    }

    static async generateFields(info: WebsiteMapInfo, base?: WebflowMapInfo): Promise<WebflowMapFieldsWrite> {
        const fields: WebflowMapFieldsWrite = {
            name: info.name,
            slug: info.name.toLowerCase().replace(/[. _]/g, '-').replace(/[^a-z0-9-]/g, ''),
            _archived: false,
            _draft: false,
            rowyid: info.rowyId,
            minimap: await pickImage(info.minimapUrl, base?.item.minimap),
            downloadurl: info.downloadUrl,
            width: info.width,
            height: info.height,
            mapsize: info.mapSize,
            description: info.description,
            author: info.author,
            'bg-image': info.bgImageUrl ? await pickImage(info.bgImageUrl, base?.item['bg-image']) : undefined,
            'perspective-shot': info.perspectiveShotUrl ? await pickImage(info.perspectiveShotUrl, base?.item['perspective-shot']) : undefined,
            'more-images': await pickImages(info.moreImagesUrl, base?.item['more-images']),
            'wind-min': info.windMin,
            'wind-max': info.windMax,
            'tidal-strength': info.tidalStrength,
            'team-count': info.teamCount,
            'max-players': info.maxPlayers,
            'mini-map': await pickImage(info.textureMapUrl, base?.item['mini-map']),
            'height-map': await pickImage(info.heightMapUrl, base?.item['height-map']),
            'metal-map': await pickImage(info.metalMapUrl, base?.item['metal-map']),
        };
        return fields;
    }
}

// buildWebflowInfo builds the WebflowMapInfo from Rowy data keyed by rowyId.
async function buildWebflowInfo(
    maps: MapList,
    cdnInfo: Map<string, MapCDNInfo>,
    mapsMetadata: Map<string, any>
): Promise<Map<string, WebsiteMapInfo>> {
    const imagorUrlBase = 'https://maps-metadata.beyondallreason.dev/i/';
    const rowyBucket = 'rowy-1f075.appspot.com';

    const webflowInfo: Map<string, WebsiteMapInfo> = new Map();
    for (const [rowyId, map] of Object.entries(maps)) {
        const mi = cdnInfo.get(map.springName);
        if (!mi) {
            throw new Error(`Missing download url for ${map.springName}`);
        }
        const meta = mapsMetadata.get(rowyId);

        // Just in case cache version changed or something.
        const metaLoc = await getParsedMapLocation(map.springName);
        for (const img of ['height.png', 'metal.png']) {
            assert(meta.extractedFiles.includes(img));
        }

        webflowInfo.set(rowyId, {
            name: map.displayName,
            rowyId,
            minimapUrl: `${imagorUrlBase}fit-in/1024x1024/filters:format(jpeg):quality(90)/${rowyBucket}/${encodeURI(map.photo[0].ref)}`,
            downloadUrl: mi.mirrors[0],
            width: meta.smf.mapWidth / 64,
            height: meta.smf.mapHeight / 64,
            mapSize: meta.smf.mapWidth * meta.smf.mapHeight / (64 * 64),
            description: map.description || undefined,
            author: map.author,
            bgImageUrl: (map.backgroundImage.length > 0 ? `${imagorUrlBase}fit-in/2250x/filters:format(webp):quality(90)/${rowyBucket}/${encodeURI(map.backgroundImage[0]!.ref)}` : undefined),
            perspectiveShotUrl: (map.perspectiveShot.length > 0 ? `${imagorUrlBase}fit-in/2250x/filters:format(webp):quality(90)/${rowyBucket}/${encodeURI(map.perspectiveShot[0]!.ref)}` : undefined),
            moreImagesUrl: map.inGameShots.map(i => `${imagorUrlBase}fit-in/2250x/filters:format(webp):quality(90)/${rowyBucket}/${encodeURI(i.ref)}`),
            windMin: 'smd' in meta ? meta.smd.minWind : meta.mapInfo.atmosphere.minWind,
            windMax: 'smd' in meta ? meta.smd.maxWind : meta.mapInfo.atmosphere.maxWind,
            tidalStrength: 'smd' in meta ? meta.smd.tidalStrength : meta.mapInfo.tidalStrength,
            teamCount: map.teamCount,
            maxPlayers: map.playerCount,
            textureMapUrl: `${imagorUrlBase}fit-in/1024x1024/filters:format(webp):quality(90)/${metaLoc.bucket}/${encodeURI(metaLoc.path + '/texture.jpg')}`,
            heightMapUrl: `${imagorUrlBase}fit-in/1024x1024/filters:format(webp):quality(90)/${metaLoc.bucket}/${encodeURI(metaLoc.path + '/height.png')}`,
            metalMapUrl: `${imagorUrlBase}fit-in/1024x1024/filters:format(png)/${metaLoc.bucket}/${encodeURI(metaLoc.path + '/metal.png')}`,
        });
    }
    return webflowInfo;
}

// getAllWebflowMaps returns all maps from the Webflow collection mapped by rowyId.
async function getAllWebflowMaps(mapsCollection: WebflowCollection): Promise<Map<string, WebflowMapInfo>> {
    const items: WebflowItem[] = [];
    const limit = 100;
    for (let offset = 0; true; offset += limit) {
        const response = await limiter.schedule(() => mapsCollection.items({ limit, offset }));
        if (response.length === 0) {
            break;
        }
        items.push(...response);
    }
    const maps = items.map(item => new WebflowMapInfo(item));
    const mapsByRowyId = new Map<string, WebflowMapInfo>();
    for (const map of maps) {
        mapsByRowyId.set(map.rowyId, map);
    }
    return mapsByRowyId;
}

async function syncToWebflow(
    src: Map<string, WebsiteMapInfo>,
    dest: Map<string, WebflowMapInfo>,
    mapsCollection: WebflowCollection,
    dryRun: boolean
) {
    const updatesP: Promise<[boolean, WebsiteMapInfo, WebflowMapInfo]>[] = [];
    for (const [rowyId, map] of src) {
        const webflowMap = dest.get(rowyId);
        if (!webflowMap) {
            const fields = await WebflowMapInfo.generateFields(map);
            console.log(`Adding ${map.name}`);
            if (!dryRun) {
                const item = await limiter.schedule(() => mapsCollection.createItem(fields));
                dest.set(rowyId, new WebflowMapInfo(item));
            } else {
                console.log(fields);
            }
        } else {
            updatesP.push((async () => [await isWebflowMapInfoEqual(map, webflowMap), map, webflowMap])())
        }
    }
    for (const [rowyId, map] of dest) {
        if (!src.has(rowyId)) {
            console.log(`Removing ${map.name}`);
            if (!dryRun) {
                await limiter.schedule(() => map.item.remove());
                dest.delete(rowyId);
            }
        }
    }
    const updates = await Promise.all(updatesP);
    for (const [_, map, webflowMap] of updates.filter(([same]) => !same)) {
        console.log(`Updating ${map.name}`);
        const fields = await WebflowMapInfo.generateFields(map, webflowMap);
        if (!dryRun) {
            const item = await limiter.schedule(() => webflowMap.item.update(fields));
            dest.set(map.rowyId, new WebflowMapInfo(item));
        } else {
            console.log(webflowMap.item);
            console.log(fields);
        }
    }
}

async function publishUpdatedWebflowMaps(mapsCollection: WebflowCollection, maps: Map<string, WebflowMapInfo>, dryRun: boolean) {
    const itemIds = Array.from(maps.values())
        .map(m => m.item)
        .filter(i => !i['published-on'] || Date.parse(i['published-on']) < Date.parse(i['updated-on']))
        .map(i => i._id);
    console.log(`Publishing ${itemIds.length} items`);
    if (!dryRun) {
        const chunkSize = 100;
        for (let i = 0; i < itemIds.length; i += chunkSize) {
            const itemIdsChunk = itemIds.slice(i, i + chunkSize);
            await limiter.schedule(() => webflow.publishItems({ collectionId: mapsCollection._id, itemIds: itemIdsChunk }));
        }
    }
}

program.name('sync_to_webflow');

if (!process.env.WEBFLOW_COLLECTION_ID || !process.env.WEBFLOW_API_TOKEN) {
    console.error('Missing WEBFLOW_COLLECTION_ID or WEBFLOW_API_TOKEN');
    process.exit(1);
}
const webflow = new Webflow({ token: process.env.WEBFLOW_API_TOKEN });
const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 600 });
const mapsCollectionId = process.env.WEBFLOW_COLLECTION_ID;

async function syncCommand(dryRun: boolean) {
    const mapsCollection = await limiter.schedule(() => webflow.collection({ collectionId: mapsCollectionId }));
    const webflowMaps = await getAllWebflowMaps(mapsCollection);
    const maps = await readMapList();
    const cdnInfo = await readMapCDNInfos();
    const mapsMetadata = await fetchMapsMetadata(maps);
    const rowyWebflowInfo = await buildWebflowInfo(maps, cdnInfo, mapsMetadata);

    try {
        await syncToWebflow(rowyWebflowInfo, webflowMaps, mapsCollection, dryRun);
        await publishUpdatedWebflowMaps(mapsCollection, webflowMaps, dryRun);
    } catch (e: any) {
        // To make sure we will get full info from inside of the response.
        if ('message' in e) {
            console.error(e.message);
        } else {
            console.error(e);
        }
        if ('response' in e) {
            console.error(e.response.data);
        }
        process.exit(1);
    }
}

program.command('sync')
    .description('Syncs data from Rowy to Webflow.')
    .option('-d, --dry-run', 'Only compute and print difference, don\'t sync.', false)
    .action(({ dryRun }) => syncCommand(dryRun));

program.command('dump-data')
    .description('Dumps Webflow collection data.')
    .action(async () => {
        const mapsCollection = await limiter.schedule(() => webflow.collection({ collectionId: mapsCollectionId }));
        const webflowMaps = await getAllWebflowMaps(mapsCollection);
        console.log(util.inspect(webflowMaps, { showHidden: false, depth: null, colors: true }))
    });

program.parse();
