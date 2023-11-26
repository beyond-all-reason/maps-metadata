// Synces the maps to Google Drive.

/**
 * For local testing you can use gcloud to log in with default credentials:
 * 
 *   gcloud auth application-default login --scopes 'openid,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/accounts.reauth,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/drive.file'
 *   gcloud auth application-default set-quota-project <project-id>
 * 
 * The project must have Google Drive API enabled.
 */

import { drive_v3, google } from 'googleapis';
import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { LiveMapEntry } from '../../../gen/types/live_maps.js';
import got from 'got';

const drive = google.drive({
    version: 'v3',
    auth: new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/drive']
    }),
});

const mapsFolderId = '16eBcMpkgMTV9mlKxYmNda64X_dmCFdkk';

async function readLiveMaps(): Promise<LiveMapEntry[]> {
    const contents = await fs.readFile('gen/live_maps.validated.json', { 'encoding': 'utf8' });
    return JSON.parse(contents) as LiveMapEntry[];
}

async function driveListDir(folderId: string) {
    const files = [];
    let nextPageToken = undefined;
    do {
        const response = await drive.files.list({
            q: `'${folderId}' in parents`,
            pageToken: nextPageToken,
            fields: 'nextPageToken,files(id,name,md5Checksum,owners)',
        });
        files.push(...(response.data.files || []));
        nextPageToken = (response.data.nextPageToken || undefined) as string | undefined;
    } while (nextPageToken);
    return files;
}

async function downloadFile(url: string, dest: string) {
    await pipeline(
        got.stream(url),
        createWriteStream(dest));
}

async function uploadFile(src: string, name: string, progess: (progress: number, total: number) => void) {
    const fileSize = (await fs.stat(src)).size;
    let lastUpdate = 0;
    await drive.files.create({
        requestBody: {
            name: name,
            parents: [mapsFolderId],
        },
        media: {
            body: createReadStream(src),
        },
    }, {
        onUploadProgress: (e) => {
            if (Date.now() - lastUpdate < 1000) {
                return;
            }
            progess(e.bytesRead, fileSize);
            lastUpdate = Date.now();
        },
    });
    progess(fileSize, fileSize);
}

async function deleteDriveFile(file: drive_v3.Schema$File) {
    if (file.owners![0].me) {
        await drive.files.delete({ fileId: file.id! });
    } else {
        // This only unlinks the file from the maps folder, it doesn't
        // delete it, as it's not owned by us.
        await drive.files.update({
            fileId: file.id!,
            removeParents: mapsFolderId,
            requestBody: {}
        });
    }
}

async function renameDriveFile(file: drive_v3.Schema$File, name: string) {
    await drive.files.update({
        fileId: file.id!,
        requestBody: {
            name: name,
        },
    });
}

async function syncFiles(tmpDir: string, dryRun: boolean) {
    const liveMaps = await readLiveMaps();
    const liveMapsByHash = new Map(liveMaps.map(m => [m.md5, m]));

    const driveFiles = await driveListDir(mapsFolderId);
    const driveFilesByHash: Map<string, drive_v3.Schema$File> = new Map();

    const duplicates = [];
    for (const file of driveFiles) {
        if (!file.md5Checksum && !file.name?.endsWith('.sd7')) {
            console.log(`Skipping ${file.name} as it's not a map file.`);
            continue;
        }

        // We want to drop duplicates, and prefer to drop the ones owned by us.
        const setFile = driveFilesByHash.get(file.md5Checksum!);
        if (!setFile) {
            driveFilesByHash.set(file.md5Checksum!, file);
        } else if (setFile && setFile.owners![0].me) {
            duplicates.push(setFile);
            driveFilesByHash.set(file.md5Checksum!, file);
        } else {
            duplicates.push(file);
        }
    }
    for (const file of duplicates) {
        console.log(`Dropping duplicate ${file.name} from drive.`);
        if (!dryRun) await deleteDriveFile(file);
    }

    for (const [hash, liveMap] of liveMapsByHash) {
        const driveFile = driveFilesByHash.get(hash);
        if (!driveFile) {
            console.log(`${liveMap.springName} missing, uploading...`);
            if (dryRun) return;

            const mapFile = path.join(tmpDir, liveMap.fileName);
            console.log(`  fetching map from ${liveMap.downloadURL}`);
            await downloadFile(liveMap.downloadURL, mapFile);
            await uploadFile(mapFile, liveMap.fileName, (bytes, total) => {
                console.log(`  uploading ${liveMap.springName}: ${Math.round(bytes / 1024)}KiB of ${Math.round(total / 1024)}KiB bytes.`);
            });
            await fs.rm(mapFile);
            console.log(`  done`);
        } else if (driveFile.name !== liveMap.fileName) {
            console.log(`${liveMap.springName} has wrong file name (${driveFile.name}), renaming.`);
            if (!dryRun) await renameDriveFile(driveFile, liveMap.fileName);
        }
    }

    for (const [hash, driveFile] of driveFilesByHash) {
        if (!liveMapsByHash.has(hash)) {
            console.log(`${driveFile.name} not in live maps, deleting.`);
            if (!dryRun) await deleteDriveFile(driveFile);
        }
    }
}

async function syncCommand(dryRun: boolean) {
    const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'gdrive-sync-'));
    try {
        await syncFiles(tmpDir, dryRun);
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}

async function copyFilesFromCommand(email: string, dryRun: boolean) {
    const driveFiles = await driveListDir(mapsFolderId);
    const filesToCopy = driveFiles.filter(f => f.owners![0].emailAddress === email);
    for (const file of filesToCopy) {
        console.log(`Copying ${file.name}`);
        if (!dryRun) await drive.files.copy({ fileId: file.id! });
    }
}

program.command('sync')
    .description('Syncs data to gdrive.')
    .option('-d, --dry-run', 'Only compute and print difference, don\'t sync.', false)
    .action(({ dryRun }) => syncCommand(dryRun));

program.command('copy_from')
    .description('Copies files owned by other user as ours. Useful for migrations due to storage quota.')
    .argument('<email>', 'Email of the user to copy from.')
    .option('-d, --dry-run', 'Only compute list of files.', false)
    .action(async (email, { dryRun }) => copyFilesFromCommand(email, dryRun));

program.parse();
