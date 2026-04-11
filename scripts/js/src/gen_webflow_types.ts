// Generates the webflow_types.ts based on the collection information returned via API.

import { WebflowClient, Webflow } from 'webflow-api';
import { compile } from 'json-schema-to-typescript';
import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';
import util from 'util';


const prog = program
    .argument('<output-file>', 'Path to output TS file to generate.')
    .parse();
const [outputFile] = prog.processedArgs;

if (!process.env.WEBFLOW_COLLECTION_ID || !process.env.WEBFLOW_API_TOKEN) {
    console.error('Missing WEBFLOW_COLLECTION_ID or WEBFLOW_API_TOKEN');
    process.exit(1);
}
const webflow = new WebflowClient({ accessToken: process.env.WEBFLOW_API_TOKEN });
const rootCollectionId = process.env.WEBFLOW_COLLECTION_ID;

async function generateTypes(collectionId: string, baseTypeNames: { [k: string]: string }): Promise<object> {
    const collection = await webflow.collections.get(collectionId);
    if (!collection.slug) {
        throw new Error(`Webflow API: slug was not present for collection ${collection.id}`);
    }
    if (!(collection.slug in baseTypeNames)) {
        console.warn(`No base type name for collection ${collection.slug}, ignoring`);
        return {};
    }
    const baseTypeName = baseTypeNames[collection.slug];

    console.log(util.inspect(collection, { showHidden: false, depth: null, colors: true }));

    const schemaRead = {
        title: `Webflow${baseTypeName}FieldsRead`,
        type: 'object',
        properties: {} as any,
        required: [] as string[],
        additionalProperties: false,
    };
    const schemaWrite = {
        title: `Webflow${baseTypeName}FieldsWrite`,
        type: 'object',
        properties: {} as any,
        required: [] as string[],
        additionalProperties: false,
    };
    let res: any = {};
    res[schemaRead.title] = schemaRead;
    res[schemaWrite.title] = schemaWrite;

    for (const field of collection.fields) {
        const desc: any = {};
        if (!field.slug) {
            throw new Error(`Webflow API: slug was not present for field ${field.displayName}`);
        }
        if ('helpText' in field) {
            desc.description = field.helpText;
        }
        let propsRead: any;
        let propsWrite: any;
        switch (field.type) {
            case Webflow.FieldType.PlainText:
            case Webflow.FieldType.Link:
            case Webflow.FieldType.Color:
            case Webflow.FieldType.Email:
            case Webflow.FieldType.Phone:
            case Webflow.FieldType.VideoLink:
                propsRead = { type: 'string', ...desc };
                propsWrite = { type: field.isRequired ? 'string' : ['string', 'null'], ...desc };
                break;
            case Webflow.FieldType.RichText:
                // RichText is returned as HTML string
                propsRead = { type: 'string', ...desc };
                propsWrite = { type: field.isRequired ? 'string' : ['string', 'null'], ...desc };
                break;
            case Webflow.FieldType.DateTime:
                // DateTime is returned as ISO 8601 string
                propsRead = { type: 'string', format: 'date-time', ...desc };
                propsWrite = { type: field.isRequired ? 'string' : ['string', 'null'], format: 'date-time', ...desc };
                break;
            case Webflow.FieldType.Switch:
                propsRead = { type: 'boolean', ...desc };
                propsWrite = { type: field.isRequired ? 'boolean' : ['boolean', 'null'], ...desc };
                break;
            case Webflow.FieldType.Image:
                propsRead = { '$ref': '#/$defs/fileRef' };
                propsWrite = { type: field.isRequired ? 'string' : ['string', 'null'], ...desc };
                break;
            case Webflow.FieldType.File:
                // File fields return an object ref {fileId, url, alt?}, same structure as Image.
                // For writes, pass a URL (to upload a new file) or a fileId (to reuse an existing one).
                propsRead = { '$ref': '#/$defs/fileRef' };
                propsWrite = { type: field.isRequired ? 'string' : ['string', 'null'], ...desc };
                break;
            case Webflow.FieldType.Option: {
                const validations = field.validations as any;
                const values = validations?.options?.map((o: any) => o.name) || [];
                propsRead = { type: 'string', ...desc };
                propsWrite = { type: field.isRequired ? 'string' : ['string', 'null'], enum: values, ...desc };
                break;
            }
            case Webflow.FieldType.Number:
                propsRead = { type: 'number', ...desc }
                propsWrite = { type: field.isRequired ? 'number' : ['number', 'null'], ...desc };
                break;
            case Webflow.FieldType.MultiImage:
                propsRead = { type: 'array', items: { '$ref': '#/$defs/fileRef' }, ...desc };
                propsWrite = {
                    type: field.isRequired ? 'array' : ['array', 'null'],
                    items: { type: 'string', minItems: field.isRequired ? 1 : 0 },
                    ...desc
                };
                break;
            case Webflow.FieldType.MultiReference:
                propsRead = { type: 'array', items: { type: 'string' }, ...desc };
                propsWrite = {
                    type: field.isRequired ? 'array' : ['array', 'null'],
                    items: { type: 'string', minItems: field.isRequired ? 1 : 0 },
                    ...desc
                };

                const subType = await generateTypes((field.validations as any)?.collectionId, baseTypeNames);
                // It might be not optimal if the same collection is referenced multiple times,
                // but it's not a problem for now.
                res = { ...res, ...subType };
                break;
            case Webflow.FieldType.Reference:
                // Single reference (not array)
                propsRead = { type: 'string', ...desc };
                propsWrite = { type: field.isRequired ? 'string' : ['string', 'null'], ...desc };

                // Recursively generate types for referenced collection
                const refSubType = await generateTypes((field.validations as any)?.collectionId, baseTypeNames);
                res = { ...res, ...refSubType };
                break;
            default:
                throw new Error(`Unknown field type: ${field.type}`);
        }

        schemaRead.properties[field.slug] = propsRead;
        if (field.isRequired) {
            schemaRead.required.push(field.slug);
        }
        schemaWrite.properties[field.slug] = propsWrite;
        if (field.isRequired) {
            schemaWrite.required.push(field.slug);
        }
    }
    return res;
}

const types = await generateTypes(rootCollectionId, {
    'map': 'Map',
    'map-tags-v2': 'MapTag',
    'map-terrain-types': 'MapTerrain',
});

const schema: any = {
    '$schema': 'https://json-schema.org/draft/2020-12/schema',
    '$defs': {
        fileRef: {
            title: 'WebflowFileRef',
            type: 'object',
            properties: {
                fileId: { type: 'string' },
                url: { type: 'string' },
                alt: { type: 'string' },
            },
            required: ['fileId', 'url'],
            additionalProperties: false,
        },
        ...types,
    }
};

const ts = await compile(schema, '', {
    unreachableDefinitions: true,
    bannerComment: `/* eslint-disable */
/**
 * This file was automatically generated by gen_webflow_types.ts.
 * DO NOT MODIFY IT BY HAND. Instead, run make refresh_webflow_types
 */
`
});
await fs.writeFile(outputFile, ts);
