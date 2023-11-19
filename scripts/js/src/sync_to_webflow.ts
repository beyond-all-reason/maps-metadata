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
import { GameType, MapList } from '../../../gen/types/map_list.js';
import { readMapCDNInfos } from './cdn_maps.js';
import { MapCDNInfo } from '../../../gen/types/cdn_maps.js';
import {
    WebflowImageRef,
    WebflowMapFieldsRead,
    WebflowMapFieldsWrite,
    WebflowMapTagFieldsRead,
    WebflowMapTagFieldsWrite,
} from './webflow_types.js';
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
        this.limit = pLimit(20);
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
    async getImageHash(url: string | null): Promise<string> {
        if (!url) {  // Handles both null and '';
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

const getImageHash = (url: string | null) => imageHashesCache.getImageHash(url);

async function sameImage(url1: string | null, url2: string | null): Promise<boolean> {
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

function isSameMapTagRefs(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    return a.every((v, i) => v === b[i]);
}

function slugFromName(name: string): string {
    return name.toLowerCase().replace(/[. _]/g, '-').replace(/[^a-z0-9-]/g, '');
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
 * and second for a url to the image. It also gives us a more strongly
 * typed interface to work with for comparison.
 */

// WebsiteMapTag is the internal representation of a tag used in this script.
interface WebsiteMapTag {
    name: string;
    slug: string;
}

function isWebsiteMapTagEqual(a: WebsiteMapTag, b: WebsiteMapTag): boolean {
    return a.name === b.name && a.slug === b.slug;
}

interface WebflowMapTag extends WebsiteMapTag { }

// WebflowMapTag is the native Webflow representation of a tag as used by the
// Webflow API.
class WebflowMapTag {
    item: WebflowItem & WebflowMapTagFieldsRead;

    constructor(item: WebflowItem) {
        const o = this.item = item as WebflowItem & WebflowMapTagFieldsRead;

        this.name = o.name;
        this.slug = o.slug;
    }

    static generateFields(tag: WebsiteMapTag): WebflowMapTagFieldsWrite {
        return {
            name: tag.name,
            slug: tag.slug,
            _archived: false,
            _draft: false,
        };
    }
}

async function getMapTagCollection(mapCollection: WebflowCollection, webflow: Webflow): Promise<WebflowCollection> {
    const fields = mapCollection.fields.filter(f => f.slug === 'game-tags-ref-2');
    if (fields.length !== 1) {
        throw new Error(`Expected one field with slug 'game-tags-ref-2' in ${mapCollection.slug}, got ${fields.length}`);
    }
    const field = fields[0];
    const collectionId = field.validations!.collectionId;
    const collection = await webflow.collection({ collectionId });
    return collection;
}

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
    description: string | null;
    author: string;
    bgImageUrl: string | null;
    perspectiveShotUrl: string | null;
    moreImagesUrl: string[];
    windMin: number | null;
    windMax: number | null;
    tidalStrength: number | null;
    teamCount: number;
    maxPlayers: number;
    textureMapUrl: string;
    heightMapUrl: string;
    metalMapUrl: string;
    mapTags: string[];
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
        a.maxPlayers === b.maxPlayers &&
        isSameMapTagRefs(a.mapTags, b.mapTags);
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
        this.width = o.width || -1;
        this.height = o.height || -1;
        this.mapSize = o.mapsize || -1;
        this.description = o.description || null;
        this.author = o.author || '';
        this.bgImageUrl = o['bg-image']?.url || null;
        this.perspectiveShotUrl = o['perspective-shot']?.url || null;
        this.moreImagesUrl = o['more-images']?.map(i => i.url) || [];
        this.windMin = o['wind-min'] || null;
        this.windMax = o['wind-max'] || null;
        this.tidalStrength = o['tidal-strength'] || null
        this.teamCount = o['team-count'] || -1;
        this.maxPlayers = o['max-players'] || -1;
        this.textureMapUrl = o['mini-map']?.url || '';
        this.heightMapUrl = o['height-map']?.url || '';
        this.metalMapUrl = o['metal-map']?.url || '';
        this.mapTags = o['game-tags-ref-2'] || [];
    }

    static async generateFields(info: WebsiteMapInfo, base?: WebflowMapInfo): Promise<WebflowMapFieldsWrite> {
        return {
            name: info.name,
            slug: slugFromName(info.name),
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
            'bg-image': info.bgImageUrl ? await pickImage(info.bgImageUrl, base?.item['bg-image']) : null,
            'perspective-shot': info.perspectiveShotUrl ? await pickImage(info.perspectiveShotUrl, base?.item['perspective-shot']) : null,
            'more-images': await pickImages(info.moreImagesUrl, base?.item['more-images']),
            'wind-min': info.windMin,
            'wind-max': info.windMax,
            'tidal-strength': info.tidalStrength,
            'team-count': info.teamCount,
            'max-players': info.maxPlayers,
            'mini-map': await pickImage(info.textureMapUrl, base?.item['mini-map']),
            'height-map': await pickImage(info.heightMapUrl, base?.item['height-map']),
            'metal-map': await pickImage(info.metalMapUrl, base?.item['metal-map']),
            'game-tags-ref-2': info.mapTags,
        };
    }
}

// buildWebflowInfo builds the WebflowMapInfo from Rowy data keyed by rowyId.
async function buildWebflowInfo(
    maps: MapList,
    cdnInfo: Map<string, MapCDNInfo>,
    mapsMetadata: Map<string, any>
): Promise<[Map<string, WebsiteMapInfo>, Map<string, WebsiteMapTag>]> {
    const imagorUrlBase = 'https://maps-metadata.beyondallreason.dev/i/';
    const rowyBucket = 'rowy-1f075.appspot.com';

    const mapInfo: Map<string, WebsiteMapInfo> = new Map();
    const allMapTags: Map<string, WebsiteMapTag> = new Map();
    const tagsOrder: Map<string, number> = new Map();

    for (const [rowyId, map] of Object.entries(maps)) {
        const mi = cdnInfo.get(map.springName);
        if (!mi) {
            throw new Error(`Missing download url for ${map.springName}`);
        }
        const meta = mapsMetadata.get(rowyId);

        // Just in case cache version changed or something.
        const metaLoc = await getParsedMapLocation(map.springName);
        for (const img of ['height.png', 'metal.png', 'texture.jpg']) {
            assert(meta.extractedFiles.includes(img));
        }

        const mapTags = new Set<string>();

        for (const gameType of map.gameType) {
            const name = gameType.toUpperCase();
            const slug = slugFromName(gameType);
            allMapTags.set(slug, { name, slug });
            tagsOrder.set(slug, {
                'team': 1,
                'ffa': 2,
                'pve': 3,
                '1v1': 1001,
            }[gameType]);
            mapTags.add(slug);
        }

        for (const startbox of Object.values(map.startboxesSet || {})) {
            const numTeams = startbox.startboxes.length;
            if (numTeams < 2 || numTeams > 4) {
                continue;
            }
            const minPlayers = Math.ceil(startbox.maxPlayersPerStartbox * 0.6);
            for (let numPlayers = minPlayers; numPlayers <= startbox.maxPlayersPerStartbox; ++numPlayers) {
                if ((numPlayers == 1 && numTeams > 2) || numPlayers > 8) {
                    continue;
                }
                const name = `${numPlayers}V`.repeat(numTeams - 1) + `${numPlayers}`;
                const slug = slugFromName(name);
                allMapTags.set(slug, { name, slug });
                tagsOrder.set(slug, 1000 * numTeams + numPlayers);
                mapTags.add(slug);
            }
        }

        const info: WebsiteMapInfo = {
            name: map.displayName,
            rowyId,
            minimapUrl: `${imagorUrlBase}fit-in/1024x1024/filters:format(webp):quality(85)/${rowyBucket}/${encodeURI(map.photo[0].ref)}`,
            downloadUrl: mi.mirrors[0],
            width: meta.smf.mapWidth / 64,
            height: meta.smf.mapHeight / 64,
            mapSize: meta.smf.mapWidth * meta.smf.mapHeight / (64 * 64),
            description: map.description || null,
            author: map.author,
            bgImageUrl: (map.backgroundImage.length > 0 ? `${imagorUrlBase}fit-in/2250x/filters:format(webp):quality(85)/${rowyBucket}/${encodeURI(map.backgroundImage[0]!.ref)}` : null),
            perspectiveShotUrl: (map.perspectiveShot.length > 0 ? `${imagorUrlBase}fit-in/2250x/filters:format(webp):quality(85)/${rowyBucket}/${encodeURI(map.perspectiveShot[0]!.ref)}` : null),
            moreImagesUrl: map.inGameShots.map(i => `${imagorUrlBase}fit-in/2250x/filters:format(webp):quality(85)/${rowyBucket}/${encodeURI(i.ref)}`),
            windMin: ('smd' in meta ? meta.smd.minWind : meta.mapInfo.atmosphere.minWind) || null,
            windMax: ('smd' in meta ? meta.smd.maxWind : meta.mapInfo.atmosphere.maxWind) || null,
            tidalStrength: ('smd' in meta ? meta.smd.tidalStrength : meta.mapInfo.tidalStrength) || null,
            teamCount: map.teamCount,
            maxPlayers: map.playerCount,
            textureMapUrl: `${imagorUrlBase}fit-in/1024x1024/filters:format(webp):quality(85)/${metaLoc.bucket}/${encodeURI(metaLoc.path + '/texture.jpg')}`,
            heightMapUrl: `${imagorUrlBase}fit-in/1024x1024/filters:format(webp):quality(85)/${metaLoc.bucket}/${encodeURI(metaLoc.path + '/height.png')}`,
            metalMapUrl: `${imagorUrlBase}fit-in/1024x1024/filters:format(png)/${metaLoc.bucket}/${encodeURI(metaLoc.path + '/metal.png')}`,
            mapTags: Array.from(mapTags).sort((a, b) => tagsOrder.get(a)! - tagsOrder.get(b)!),
        };

        for (const [k, v] of Object.entries(info)) {
            if (v === undefined || v === '') {
                throw new Error(`Missing value for map ${map.springName} key ${k}`);
            }
        }

        mapInfo.set(rowyId, info);
    }
    return [mapInfo, allMapTags];
}

function resolveMapTagsInMapInfos(mapInfos: Map<string, WebsiteMapInfo>, allMapTags: Map<string, WebflowMapTag>, dryRun: boolean) {
    for (const mapInfo of mapInfos.values()) {
        mapInfo.mapTags = mapInfo.mapTags.map(tag => {
            const t = allMapTags.get(tag);
            if (!t) {
                if (dryRun) {
                    return tag;
                }
                throw new Error(`Missing tag ${tag}`);
            }
            return t.item._id;
        });
    }
}

async function getAllWebflowItems(collection: WebflowCollection): Promise<WebflowItem[]> {
    const items: WebflowItem[] = [];
    const limit = 100;
    for (let offset = 0; true; offset += limit) {
        const response = await limiter.schedule(() => collection.items({ limit, offset }));
        if (response.length === 0) {
            break;
        }
        items.push(...response);
    }
    return items;
}

// getAllWebflowMaps returns all maps from the Webflow collection mapped by rowyId.
async function getAllWebflowMaps(mapsCollection: WebflowCollection): Promise<Map<string, WebflowMapInfo>> {
    const items = await getAllWebflowItems(mapsCollection);
    const maps = items.map(item => new WebflowMapInfo(item));
    return new Map(maps.map(map => [map.rowyId, map]));
}

// getAllWebflowMaps returns all map tags from the Webflow collection mapped by map tag slug.
async function getAllWebflowMapTags(mapTagsCollection: WebflowCollection): Promise<Map<string, WebflowMapTag>> {
    const items = await getAllWebflowItems(mapTagsCollection);
    const tags = items.map(item => new WebflowMapTag(item));
    return new Map(tags.map(tag => [tag.slug, tag]));
}

async function syncMapTagsToWebflowAdditions(
    src: Map<string, WebsiteMapTag>,
    dest: Map<string, WebflowMapTag>,
    mapTagsCollection: WebflowCollection,
    dryRun: boolean
) {
    for (const tag of src.values()) {
        const webflowTag = dest.get(tag.slug);
        if (!webflowTag) {
            const fields = WebflowMapTag.generateFields(tag);
            console.log(`Adding tag ${tag.name}`);
            if (!dryRun) {
                const item = await limiter.schedule(() => mapTagsCollection.createItem(fields));
                dest.set(tag.slug, new WebflowMapTag(item));
            } else {
                console.log(fields);
            }
        } else if (!isWebsiteMapTagEqual(tag, webflowTag)) {
            console.log(`Updating tag ${tag.name}`);
            const fields = WebflowMapTag.generateFields(tag);
            if (!dryRun) {
                const item = await limiter.schedule(() => webflowTag.item.update(fields));
                dest.set(tag.slug, new WebflowMapTag(item));
            } else {
                console.log(webflowTag);
                console.log(fields);
            }
        }
    }
}

async function syncMapTagsToWebflowRemovals(
    src: Map<string, WebsiteMapTag>,
    dest: Map<string, WebflowMapTag>,
    dryRun: boolean
) {
    for (const tag of dest.values()) {
        if (!src.has(tag.slug)) {
            console.log(`Removing tag ${tag.name}`);
            if (!dryRun) {
                await limiter.schedule(() => tag.item.remove());
                dest.delete(tag.slug);
            }
        }
    }
}

async function syncMapsToWebflow(
    src: Map<string, WebsiteMapInfo>,
    dest: Map<string, WebflowMapInfo>,
    mapsCollection: WebflowCollection,
    dryRun: boolean
) {
    const updatesP: Promise<[boolean, WebsiteMapInfo, WebflowMapInfo]>[] = [];
    for (const map of src.values()) {
        const webflowMap = dest.get(map.rowyId);
        if (!webflowMap) {
            const fields = await WebflowMapInfo.generateFields(map);
            console.log(`Adding ${map.name}`);
            if (!dryRun) {
                const item = await limiter.schedule(() => mapsCollection.createItem(fields));
                dest.set(map.rowyId, new WebflowMapInfo(item));
            } else {
                console.log(fields);
            }
        } else {
            updatesP.push((async () => [await isWebflowMapInfoEqual(map, webflowMap), map, webflowMap])())
        }
    }
    for (const map of dest.values()) {
        if (!src.has(map.rowyId)) {
            console.log(`Removing ${map.name}`);
            if (!dryRun) {
                await limiter.schedule(() => map.item.remove());
                dest.delete(map.rowyId);
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
            console.log(webflowMap);
            console.log(fields);
        }
    }
}

async function publishUpdatedWebflowItems(mapsCollection: WebflowCollection, items: Map<any, { item: WebflowItem }>, dryRun: boolean) {
    const itemIds = Array.from(items.values())
        .map(i => i.item)
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
    const mapTagsCollection = await getMapTagCollection(mapsCollection, webflow);
    const webflowMapTags = await getAllWebflowMapTags(mapTagsCollection);
    const maps = await readMapList();
    const cdnInfo = await readMapCDNInfos();
    const mapsMetadata = await fetchMapsMetadata(maps);
    const [rowyMapsInfo, rowyMapTagsInfo] = await buildWebflowInfo(maps, cdnInfo, mapsMetadata);

    try {
        await syncMapTagsToWebflowAdditions(rowyMapTagsInfo, webflowMapTags, mapTagsCollection, dryRun);
        resolveMapTagsInMapInfos(rowyMapsInfo, webflowMapTags, dryRun);
        await syncMapsToWebflow(rowyMapsInfo, webflowMaps, mapsCollection, dryRun);
        await publishUpdatedWebflowItems(mapTagsCollection, webflowMapTags, dryRun);
        await publishUpdatedWebflowItems(mapsCollection, webflowMaps, dryRun);
        await syncMapTagsToWebflowRemovals(rowyMapTagsInfo, webflowMapTags, dryRun);
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
        console.log(util.inspect(webflowMaps, { showHidden: false, depth: null, colors: true }));

        const webflowMapTags = await getMapTagCollection(mapsCollection, webflow);
        const webflowTags = await getAllWebflowMapTags(webflowMapTags);
        console.log(util.inspect(webflowTags, { showHidden: false, depth: null, colors: true }));
    });

program.parse();
