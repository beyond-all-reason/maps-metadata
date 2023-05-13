// Quick and hacky batch ccript to upload map photos from BYAR-Chobby repo to Rowy
// Not realy used for anything currently, it's here as reference.

import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';
import path from 'node:path';

const prog = program
    .argument('<byar-chobby-repo>', 'Path to BYAR-Chobby repo.')
    .parse();
const [byarChobbyRepoPath] = prog.processedArgs;

const firestore = new Firestore();
const mapsDocs = firestore.collection('maps');

const docRefs = await mapsDocs.listDocuments();
const docs = await firestore.getAll(...docRefs);

const ID_CHARACTERS =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Generate an ID compatible with Firestore
 * @param length - The length of the ID to generate
 * @returns - Generated ID
 */
export const generateId = (length: number = 20) => {
    let result = "";
    const charactersLength = ID_CHARACTERS.length;
    for (var i = 0; i < length; i++)
        result += ID_CHARACTERS.charAt(
            Math.floor(Math.random() * charactersLength)
        );

    return result;
};

const maps: Map<string, any> = new Map(docs
    .map(d => [d.data()!['springName'], {
        ref: d.ref,
        photo: d.data()!['photo'],
        uploadPrefix: `${d.ref.path}/photo/${generateId()}-`,
    }]));

function isEquivalent(s1: string, s2: string): boolean {
    return s1.replace(/_/g, ' ').toLowerCase() === s2.replace(/_/g, ' ').toLowerCase();
}

function createMapping(mapNames: string[], fileNames: string[]): { [key: string]: string } {
    const mapping: { [key: string]: string } = {};

    for (const mapName of mapNames) {
        const matches: string[] = [];

        for (const fileName of fileNames) {
            if (isEquivalent(mapName, fileName.slice(0, -4))) { // Exclude '.jpg' extension
                matches.push(fileName);
            }
        }

        if (matches.length > 1) {
            throw new Error(`Ambiguity found for map name: ${mapName}. Potential matches are: ${matches}`);
        } else if (matches.length === 1) {
            mapping[mapName] = matches[0];
        } else {
            throw new Error(`No matches found for map name: ${mapName}`);
        }
    }

    return mapping;
}

const filesPath = path.join(byarChobbyRepoPath, 'LuaMenu/configs/gameConfig/byar/minimapOverride');
const mapFiles = await fs.readdir(filesPath);
const mapToFile = createMapping(Array.from(maps.keys()), mapFiles);

const storage = new Storage();
const bucket = storage.bucket('rowy-1f075.appspot.com');

// Example photo: 
// [
//   {
//     "ref": "maps/0jMFtrg8MuFKGgxmk6Nn/photo/RxP6l8iDzf64UjquGzLd-thermal_shock_v1.1.jpg",
//     "downloadURL": "https://firebasestorage.googleapis.com/v0/b/rowy-1f075.appspot.com/o/maps%2F0jMFtrg8MuFKGgxmk6Nn%2Fphoto%2FRxP6l8iDzf64UjquGzLd-thermal_shock_v1.1.jpg?alt=media&token=bfb2d5f0-d810-4aae-8521-df13846f5297",
//     "name": "thermal_shock_v1.1.jpg",
//     "type": "image/jpeg",
//     "lastModifiedTS": 1682776299679
//   }
// ]

for (const [mapName, map] of maps) {
    const fileName = mapToFile[mapName];
    if (map.photo && map.photo.length > 0) {
        console.log(`Skipping ${mapName} because it already has a photo`);
        continue;
    }

    const destination = map.uploadPrefix + fileName;
    await bucket.upload(path.join(filesPath, fileName), {
        destination: destination,
        metadata: {
            contentType: 'image/jpeg',
            cacheControl: 'public, max-age=31536000',
        }
    });
    const photoObj = {
        downloadURL: `https://storage.googleapis.com/${bucket.name}/${map.uploadPrefix}${fileName}`,
        name: fileName,
        type: 'image/jpeg',
        lastModifiedTS: Date.now(),
        ref: destination,
    };
    //console.log(photoObj);
    await map.ref.update({ photo: [photoObj] });
    console.log(`Uploaded photo for ${mapName}`);
}
