// A script to generate map_list.yaml file from data export from Firebase database
// build using Rowy.

import { Firestore } from '@google-cloud/firestore';
import mapSchema from '../../../gen/map_list.schema.json' assert { type: "json" };
import YAML from 'yaml';
import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';


const mapEntryKeys = Object.keys(mapSchema.additionalProperties.properties);

const prog = program
    .argument('<data-file>', 'File with data.')
    .argument('<row-id>', 'The single row ID to modify or "all" for all documents')
    .parse();
const [dataFilePath, rowId] = prog.processedArgs;

const firestore = new Firestore();
const maps = firestore.collection('maps');

function filterKnownEntries(entry: any): any {
    return Object.fromEntries(mapEntryKeys.map(key => [key, entry[key]]));
}

async function saveDataFile(data: any) {
    await fs.writeFile(dataFilePath, YAML.stringify(data, { sortMapEntries: true }));
}

if (rowId === 'all') {
    const docRefs = await maps.listDocuments();
    const docs = await firestore.getAll(...docRefs);
    const data: { [name: string]: any } = {};
    for (const doc of docs) {
        const entry = doc.data();
        if (entry) {
            data[doc.id] = filterKnownEntries(entry);
        }
    }
    await saveDataFile(data);
} else {
    const dataFile = await fs.readFile(dataFilePath, { encoding: 'utf8' });
    const data = YAML.parse(dataFile);
    const doc = await maps.doc(rowId).get();
    const entry = doc.data();
    if (entry) {
        data[rowId] = filterKnownEntries(entry);
        await saveDataFile(data);
    } else {
        console.error("Not found document with requested id");
        process.exit(1);
    }
}
