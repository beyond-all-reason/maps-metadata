import express from 'express';
import { Storage } from '@google-cloud/storage';
import { MapParser } from 'spring-map-parser';
import axios from 'axios';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import child_process from 'node:child_process';
import stream from 'node:stream/promises';
import { Readable } from 'node:stream';
import sevenBin from '7zip-bin';
import Jimp from 'jimp';

const execFile = promisify(child_process.execFile);

const app = express();
const port = process.env.PORT || 8080;

const bucketName = process.env.BUCKET;
if (!bucketName) {
    console.error('Missing required environment variable BUCKET');
    process.exit(1);
}

const publicUrlBase = process.env.PUBLIC_URL || `https://storage.googleapis.com/${bucketName}`;

const storage = new Storage();

// Must change this value when making incompatible change to the cache.
const CACHE_VERSION = 'v2';

async function is7zArchiveSolid(archivePath: string): Promise<boolean> {
    const { stdout } = await execFile(
        sevenBin.path7za, ['l', '-x!*', archivePath]
    );

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
    const response = await axios.get(`https://files-cdn.beyondallreason.dev/find?category=map&springname=${encodeURIComponent(springName)}`);

    if (response.data.length === 0) {
        return null;
    }

    const mapUrl = response.data[0].mirrors[0];
    const fileName = path.join(destination, response.data[0].filename);

    const { data: mapData } = await axios.get<Readable>(mapUrl, { responseType: 'stream' });
    const mapFile = await fs.open(fileName, 'w');
    try {
        await stream.pipeline(mapData, mapFile.createWriteStream());
    } finally {
        await mapFile.close();
    }
    return fileName;
}

app.get('/parse-map/:springName', async (req, res) => {
    const springName = req.params.springName;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `parse-map-`));
    try {
        const baseBucketPath = `${springName}/cache-${CACHE_VERSION}`;
        const baseOkRes = {
            bucket: bucketName,
            path: bucketName == 'local' ? tempDir : baseBucketPath,
            baseUrl: `${publicUrlBase}/${encodeURI(baseBucketPath)}`,
        };

        if (bucketName !== "local") {
            // Check if the cache exists and has the same version
            const [alreadyCached] = await storage.bucket(bucketName).file(`${baseBucketPath}/metadata.json`).exists();
            if (alreadyCached) {
                res.status(200).json({
                    message: 'Cache found.',
                    ...baseOkRes
                });
                return;
            }
        }

        // Download map file
        const mapPath = await downloadMap(springName, tempDir);
        if (!mapPath) {
            res.status(404).json({ message: 'Map not found.' });
            return;
        }

        const isArchiveSolid = await isMapArchiveSolid((mapPath));

        // Parse map
        const parser = new MapParser({
            verbose: true,
            mipmapSize: 16,
            skipSmt: false,
            // For now skip parsing resources, we will enable it once we better
            // know what kind of formats are useful for export as raw files
            // are just massive and not that usefull in cache.
            parseResources: false,
        });
        const map = await parser.parseMap(mapPath);

        const images: Record<string, Jimp> = {
            'texture.jpg': map.textureMap!.clone().quality(90),
            'texture-preview.jpg': map.textureMap!.clone().scaleToFit(600, 600).quality(80),
            'height.png': map.heightMap!,
            'type.png': map.typeMap!,
            'metal.png': map.metalMap!,
            'mini.jpg': map.miniMap!.clone().quality(85)
        };
        for (const [resource, image] of Object.entries(map.resources ?? {})) {
            if (image) {
                images[`res_${resource}.png`] = image;
            }
        }

        const writePromises = Object.entries(images).map(([fileName, image]) => {
            return image.writeAsync(path.join(tempDir, fileName));  
        });
        await Promise.all(writePromises);

        if (bucketName !== 'local') {
            const uploadPromises = Object.keys(images).map(fileName => {
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
            extractedFiles: Object.keys(images)
        };

        const metadataPath = path.join(tempDir, 'metadata.json');
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        if (bucketName !== 'local') {
            await storage.bucket(bucketName).upload(metadataPath, { destination: `${baseBucketPath}/metadata.json` });
        }

        res.status(200).json({
            message: 'Cache generated.',
            ...baseOkRes
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error.' });
    } finally {
        if (bucketName !== 'local') {
            // Cleanup local temp files
            await fs.rm(tempDir, { recursive: true });
        } else {
            console.log(`Wrote files to ${tempDir}`);
        }
    }
});

app.listen(port, () => {
    console.log(`Server running at ${port}`);
});
