// Generates the webflow_types.ts based on the collection information returned via API.

import { WebflowClient } from 'webflow-api';
import type { Field, FieldType } from 'webflow-api/api/types';
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

    // We have to do this because WebFlow OpenAPI Spec is incomplete
    // https://github.com/webflow/openapi-spec/issues/3
    interface RealField extends Omit<Field, 'type'> {
        validations: any;
        type: FieldType | 'Option' | 'MultiReference';
    }

    for (const field of collection.fields as RealField[]) {
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
            case 'PlainText':
            case 'Link':
            case 'Color':
                propsRead = { type: 'string', ...desc };
                propsWrite = { type: field.isRequired ? 'string' : ['string', 'null'], ...desc };
                break;
            case 'Switch':
                propsRead = { type: 'boolean', ...desc };
                propsWrite = { type: field.isRequired ? 'boolean' : ['boolean', 'null'], ...desc };
                break;
            case 'Image':
                propsRead = { '$ref': '#/$defs/imageRef' };
                propsWrite = { type: field.isRequired ? 'string' : ['string', 'null'], ...desc };
                break;
            case 'Option': {
                const values = field.validations.options.map((o: any) => o.name);
                propsRead = { type: 'string', ...desc };
                propsWrite = { type: field.isRequired ? 'string' : ['string', 'null'], enum: values, ...desc };
                break;
            }
            case 'Number':
                propsRead = { type: 'number', ...desc }
                propsWrite = { type: field.isRequired ? 'number' : ['number', 'null'], ...desc };
                break;
            case 'MultiImage':
                propsRead = { type: 'array', items: { '$ref': '#/$defs/imageRef' }, ...desc };
                propsWrite = {
                    type: field.isRequired ? 'array' : ['array', 'null'],
                    items: { type: 'string', minItems: field.isRequired ? 1 : 0 },
                    ...desc
                };
                break;
            case 'MultiReference':
                propsRead = { type: 'array', items: { type: 'string' }, ...desc };
                propsWrite = {
                    type: field.isRequired ? 'array' : ['array', 'null'],
                    items: { type: 'string', minItems: field.isRequired ? 1 : 0 },
                    ...desc
                };

                const subType = await generateTypes(field.validations.collectionId, baseTypeNames);
                // It might be not optimal if the same collection is referenced multiple times,
                // but it's not a problem for now.
                res = { ...res, ...subType };
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
