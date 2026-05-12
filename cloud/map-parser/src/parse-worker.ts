import { Storage } from '@google-cloud/storage';
import { MapParser } from 'spring-map-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import child_process from 'node:child_process';
import stream from 'node:stream/promises';
import { Readable } from 'node:stream';
import sevenBin from '7zip-bin';
import Jimp from 'jimp';
import { CACHE_VERSION, checkCached } from './shared.ts';
import type { ParseResult, WorkerInput } from './shared.ts';

const execFile = promisify(child_process.execFile);

const storage = new Storage();
const bucketName: string = process.env.BUCKET!;

async function is7zArchiveSolid(archivePath: string): Promise<boolean> {
    const { stdout } = await execFile(sevenBin.path7za, ['l', '-x!*', archivePath]);

    const solidLine = stdout
        .split('\n')
        .find((line) => line.trim().startsWith('Solid ='));

    if (!solidLine) {
        throw new Error('Solid information not found about the archive.');
    }

    switch (solidLine.split('=')[1].trim()) {
        case '+':
            return true;
        case '-':
            return false;
        default:
            throw new Error('Unexpected value for the solid archive, expected + or -.');
    }
}

async function isMapArchiveSolid(archivePath: string): Promise<boolean> {
    switch (path.extname(archivePath)) {
        case '.sd7':
            return await is7zArchiveSolid(archivePath);
        case '.sdz':
            return false;
        default:
            throw new Error('Only .sd7 and .sdz files supported');
    }
}

async function downloadMap(springName: string, destination: string): Promise<string | null> {
    const findResponse = await fetch(`https://files-cdn.beyondallreason.dev/find?category=map&springname=${encodeURIComponent(springName)}`);
    if (!findResponse.ok) {
        throw new Error(`Failed to find map "${springName}": ${findResponse.status} ${findResponse.statusText}`);
    }
    const findData = await findResponse.json() as Array<{ mirrors: string[], filename: string }>;

    if (findData.length === 0) {
        return null;
    }

    const mapUrl = findData[0].mirrors[0];
    const fileName = path.join(destination, findData[0].filename);

    const mapResponse = await fetch(mapUrl);
    if (!mapResponse.ok) {
        throw new Error(`Failed to download map from "${mapUrl}": ${mapResponse.status} ${mapResponse.statusText}`);
    }
    const mapFile = await fs.open(fileName, 'w');
    try {
        await stream.pipeline(Readable.fromWeb(mapResponse.body!), mapFile.createWriteStream());
    } finally {
        await mapFile.close();
    }
    return fileName;
}

async function parseAndCacheMap({ springName, tempDir }: WorkerInput): Promise<ParseResult> {
    // Re-check cache: while this task was queued (potentially minutes behind
    // an in-flight parse), another instance may have populated the bucket.
    if (await checkCached(storage, bucketName, springName)) {
        return { status: 'cached' };
    }

    const baseBucketPath = `${springName}/cache-${CACHE_VERSION}`;

    console.log(`Downloading ${springName}`);
    const mapPath = await downloadMap(springName, tempDir);
    if (!mapPath) {
        return { status: 'not_found' };
    }

    const isArchiveSolid = await isMapArchiveSolid(mapPath);

    console.log(`Starting to parse ${springName}`);
    const map = await new MapParser({
        verbose: true,
        mipmapSize: 16,
        skipSmt: false,
        parseResources: true,
        resources: ['detailNormalTex', 'specularTex'],
        parseSkybox: true,
        tmpDir: path.join(tempDir, 'extract'),
    }).parseMap(mapPath);
    console.log('Parsing map done');

    // Cleanup map file as it's not needed anymore and wastes ram.
    await fs.rm(mapPath);

    // Write images sequentially to limit peak memory usage.
    // Large textures are written first, then destructively scaled for
    // previews so the full-resolution buffer can be garbage-collected.
    const extractedFiles: string[] = [];

    const writeImage = async (fileName: string, image: Jimp): Promise<void> => {
        await image.writeAsync(path.join(tempDir, fileName));
        console.log(`Wrote ${fileName}`);
        extractedFiles.push(fileName);
    };

    // Capture texture dimensions before any destructive scaling
    const texW = map.textureMap!.getWidth();
    const texH = map.textureMap!.getHeight();

    // Texture map (largest images)
    await writeImage('texture.jpg', map.textureMap!.quality(90));
    await writeImage('texture-preview.jpg', map.textureMap!.scaleToFit(600, 600).quality(80));

    // Dry texture (without water overlay)
    await writeImage('texture-dry.jpg', map.textureMapDry!.quality(90));
    await writeImage('texture-dry-preview.jpg', map.textureMapDry!.scaleToFit(600, 600).quality(80));

    // Smaller maps can be written in parallel
    await Promise.all([
        writeImage('height.png', map.heightMap!),
        writeImage('type.png', map.typeMap!),
        writeImage('metal.png', map.metalMap!),
        writeImage('mini.jpg', map.miniMap!.quality(85)),
    ]);

    // Resource images — scale down to fit texture dimensions but never upscale
    if (map.resources) {
        for (const [resource, image] of Object.entries(map.resources) as [string, Jimp | undefined][]) {
            if (image) {
                if (image.getWidth() > texW || image.getHeight() > texH) {
                    image.scaleToFit(texW, texH);
                }
                await writeImage(`res_${resource}.png`, image);
            }
        }
    }

    // Skybox
    if (map.skybox) {
        await writeImage('skybox.png', map.skybox!);
    }

    if (bucketName !== 'local') {
        console.log('Uploading images to bucket');
        const uploadPromises = extractedFiles.map(fileName => {
            const filePath = path.join(tempDir, fileName);
            return storage.bucket(bucketName).upload(filePath, { destination: `${baseBucketPath}/${fileName}` });
        });
        await Promise.all(uploadPromises);
    }

    // Create smf object copy without tables that contain a lot of data.
    let smfCopy: any = undefined;
    if (map.smf) {
        smfCopy = Object.assign({}, map.smf);
        for (const prop of ['heightMap', 'metalMap', 'miniMap', 'typeMap', 'tileIndexMap', 'heightMapValues']) {
            delete smfCopy[prop];
        }
    }

    // Save metadata as JSON
    const metadata = {
        mapInfo: map.mapInfo,
        minHeight: map.minHeight,
        maxHeight: map.maxHeight,
        fileName: map.fileNameWithExt,
        springName: springName,
        isArchiveSolid,
        smd: map.smd,
        smf: smfCopy,
        cacheVersion: CACHE_VERSION,
        extractedFiles
    };

    const metadataPath = path.join(tempDir, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    if (bucketName !== 'local') {
        console.log('Writing metadata.json to bucket');
        await storage.bucket(bucketName).upload(metadataPath, { destination: `${baseBucketPath}/metadata.json` });
    }

    console.log(`Finished parsing ${springName}`);
    if (bucketName === 'local') {
        console.log(`Wrote files to ${tempDir}`);
    }
    return { status: 'fresh' };
}

export default parseAndCacheMap;
