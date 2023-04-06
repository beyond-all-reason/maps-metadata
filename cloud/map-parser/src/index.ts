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
const CACHE_VERSION = 'v1';

async function isArchiveSolid(archivePath: string): Promise<boolean> {
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

async function donwloadMap(springName: string, destination: string): Promise<boolean> {
    const response = await axios.get(`https://files-cdn.beyondallreason.dev/find?category=map&springname=${encodeURIComponent(springName)}`);

    if (response.data.length === 0) {
        return false;
    }

    const mapUrl = response.data[0].mirrors[0];

    const { data: mapData } = await axios.get<Readable>(mapUrl, { responseType: 'stream' });
    const mapFile = await fs.open(destination, 'w');
    try {
        await stream.pipeline(mapData, mapFile.createWriteStream());
    } finally {
        await mapFile.close();
    }
    return true;
}

app.get('/parse-map/:springName', async (req, res) => {
    const springName = req.params.springName;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `parse-map-`));
    try {
        const baseBucketPath = `${springName}/cache-${CACHE_VERSION}`;
        const baseOkRes = {
            bucket: bucketName,
            path: baseBucketPath,
            baseUrl: `${publicUrlBase}/${encodeURI(baseBucketPath)}`,
        };

        // Check if the cache exists and has the same version
        const [alreadyCached] = await storage.bucket(bucketName).file(`${baseBucketPath}/metadata.json`).exists();
        if (alreadyCached) {
            res.status(200).json({
                message: 'Cache found.',
                ...baseOkRes
            });
            return;
        }

        // Download map file
        const mapPath = path.join(tempDir, 'map.sd7');
        if (! await donwloadMap(springName, mapPath)) {
            res.status(404).json({ message: 'Map not found.' });
            return;
        }

        const isSolid = await isArchiveSolid(mapPath);

        // Parse map
        const parser = new MapParser({ verbose: false, mipmapSize: 4, skipSmt: false, parseSpecular: true });
        const map = await parser.parseMap(mapPath);

        const fileNames = [
            'texture.png',
            'height.png',
            'metal.png',
            'type.png',
            'mini.png',
            // 'specular.png', // There is currently some bug in extracing specular, so ignore for now.
        ];

        const writePromises = fileNames.map((fileName) => {
            const filePath = path.join(tempDir, fileName);
            switch (fileName) {
                case 'texture.png':
                    return map.textureMap!.writeAsync(filePath);
                case 'height.png':
                    return map.heightMap!.writeAsync(filePath);
                case 'metal.png':
                    return map.metalMap!.writeAsync(filePath);
                case 'type.png':
                    return map.typeMap!.writeAsync(filePath);
                case 'mini.png':
                    return map.miniMap!.writeAsync(filePath);
                case 'specular.png':
                    return map.specularMap!.writeAsync(filePath);
            }
        });

        await Promise.all(writePromises);

        const uploadPromises = fileNames.map(fileName => {
            const filePath = path.join(tempDir, fileName);
            return storage.bucket(bucketName).upload(filePath, { destination: `${baseBucketPath}/${fileName}` });
        });

        await Promise.all(uploadPromises);

        // Save metadata as JSON
        const metadata = {
            mapInfo: map.mapInfo,
            minHeight: map.minHeight,
            maxHeight: map.maxHeight,
            fileName: map.fileNameWithExt,
            springName: springName,
            isSolid,
            cacheVersion: CACHE_VERSION
        };

        const metadataPath = path.join(tempDir, 'metadata.json');
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        await storage.bucket(bucketName).upload(metadataPath, { destination: `${baseBucketPath}/metadata.json` });

        res.status(200).json({
            message: 'Cache generated.',
            ...baseOkRes
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error.' });
    } finally {
        // Cleanup local temp files
        await fs.rm(tempDir, { recursive: true });
    }
});

app.listen(port, () => {
    console.log(`Server running at ${port}`);
});
