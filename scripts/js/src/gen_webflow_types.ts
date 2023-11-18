// Generates the webflow_types.ts based on the collection information returned via API.

import Webflow from 'webflow-api';
import { compile } from 'json-schema-to-typescript';
import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';
import assert from 'node:assert';
import util from 'util';


const prog = program
    .argument('<output-file>', 'Path to output TS file to generate.')
    .parse();
const [outputFile] = prog.processedArgs;

if (!process.env.WEBFLOW_COLLECTION_ID || !process.env.WEBFLOW_API_TOKEN) {
    console.error('Missing WEBFLOW_COLLECTION_ID or WEBFLOW_API_TOKEN');
    process.exit(1);
}
const webflow = new Webflow({ token: process.env.WEBFLOW_API_TOKEN });
const rootCollectionId = process.env.WEBFLOW_COLLECTION_ID;

async function generateTypes(collectionId: string, baseTypeNames: { [k: string]: string }): Promise<object> {
    const collection = await webflow.collection({ collectionId });

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
        if ('helpText' in field) {
            desc.description = field.helpText;
        }
        let propsRead: any;
        let propsWrite: any;
        switch (field.type) {
            case 'PlainText':
            case 'RichText':
            case 'Date':
            case 'Link':
            case 'Color':
            case 'User':
                propsRead = { type: 'string', ...desc };
                propsWrite = { type: field.required ? 'string' : ['string', 'null'], ...desc };
                break;
            case 'Bool':
                propsRead = { type: 'boolean', ...desc };
                propsWrite = { type: field.required ? 'boolean' : ['boolean', 'null'], ...desc };
                break;
            case 'ImageRef':
                propsRead = { '$ref': '#/$defs/imageRef' };
                propsWrite = { type: field.required ? 'string' : ['string', 'null'], ...desc };
                break;
            case 'Number':
                propsRead = { type: 'number', ...desc }
                propsWrite = { type: field.required ? 'number' : ['number', 'null'], ...desc };
                break;
            case 'Set':
                assert((field as any).innerType === 'ImageRef');
                propsRead = { type: 'array', items: { '$ref': '#/$defs/imageRef' }, ...desc };
                propsWrite = {
                    type: field.required ? 'array' : ['array', 'null'],
                    items: { type: 'string', minItems: field.required ? 1 : 0 },
                    ...desc
                };
                break;
            case 'ItemRefSet':
                propsRead = { type: 'array', items: { type: 'string' }, ...desc };
                propsWrite = {
                    type: field.required ? 'array' : ['array', 'null'],
                    items: { type: 'string', minItems: field.required ? 1 : 0 },
                    ...desc
                };

                const subType = await generateTypes(
                    (field.validations as any).collectionId, baseTypeNames);
                // It might be not optimal if the same collection is referenced multiple times,
                // but it's not a problem for now.
                res = { ...res, ...subType };
                break;
            default:
                throw new Error(`Unknown field type: ${field.type}`);
        }

        schemaRead.properties[field.slug] = propsRead;
        if (field.required) {
            schemaRead.required.push(field.slug);
        }

        const ignoreForWrite = [
            'created-on', 'updated-on', 'published-on',
            'created-by', 'updated-by', 'published-by'
        ];
        if (!ignoreForWrite.includes(field.slug)) {
            schemaWrite.properties[field.slug] = propsWrite;
            if (field.required) {
                schemaWrite.required.push(field.slug);
            }
        }
    }

    return res;
}

const types = await generateTypes(rootCollectionId, {
    'maps-v2': 'Map',
    'map-tags-v2': 'MapTag'
});

const schema: any = {
    '$schema': 'https://json-schema.org/draft/2020-12/schema',
    '$defs': {
        imageRef: {
            title: 'WebflowImageRef',
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
