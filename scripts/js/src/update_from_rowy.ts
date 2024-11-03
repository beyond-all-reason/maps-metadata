// A script to generate map_list.yaml file from data export from Firebase database
// build using Rowy.

import { Firestore } from '@google-cloud/firestore';
import mapSchema from '../../../gen/schemas/map_list.json';
import YAML from 'yaml';
import pLimit from 'p-limit';
import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';

const prog = program
    .argument('<data-file>', 'File with data.')
    .argument('<row-id>', 'The single row ID to modify or "all" for all documents')
    .parse();
const [dataFilePath, rowId] = prog.processedArgs;

async function saveDataFile(data: any) {
    await fs.writeFile(dataFilePath, YAML.stringify(data, { sortMapEntries: true, lineWidth: 120 }));
}

interface TableSchema {
    type: "object";
    collection: true;
    additionalProperties: {
        type: "object";
        properties: { [name: string]: object | TableSchema };
    }
}

function isTableSchema(schema: any): schema is TableSchema {
    return schema.type === "object" && schema.collection === true;
}

const fetchConcurrentlyLimit = pLimit(20);

async function fetchDocuments(collection: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>, schema: TableSchema): Promise<any> {
    const docRefs = await collection.listDocuments();
    if (docRefs.length === 0) {
        return undefined;
    }
    const docs = await firestore.getAll(...docRefs);
    const data: { [name: string]: any } = {};
    const entryKeys = Object
        .keys(schema.additionalProperties.properties)
        .filter(key => !isTableSchema(schema.additionalProperties.properties[key]));
    const subFetches = [];
    for (const doc of docs) {
        const entry = doc.data();
        if (!entry) {
            continue;
        }
        data[doc.id] = Object.fromEntries(entryKeys.filter(key => key in entry).map(key => [key, entry[key]]));
        for (const [key, prop] of Object.entries(schema.additionalProperties.properties)) {
            if (isTableSchema(prop)) {
                subFetches.push(fetchConcurrentlyLimit(async () => {
                    data[doc.id][key] = await fetchDocuments(doc.ref.collection(key), prop);
                }));
            }
        }
    }
    await Promise.all(subFetches);
    return data;
}

if (!isTableSchema(mapSchema)) {
    console.error("Map schema is not a table schema");
    process.exit(1);
}
const firestore = new Firestore();
const maps = firestore.collection('maps');
const rowyData = await fetchDocuments(maps, mapSchema);

if (rowId === 'all') {
    await saveDataFile(rowyData);
} else {
    const dataFile = await fs.readFile(dataFilePath, { encoding: 'utf8' });
    const data = YAML.parse(dataFile);
    if (rowId in rowyData) {
        data[rowId] = rowyData[rowId];
        await saveDataFile(data);
    } else {
        console.error("Not found document with requested id");
        process.exit(1);
    }
}
