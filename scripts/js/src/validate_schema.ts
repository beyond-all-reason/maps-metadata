// Script that validates a JSON file against a JSON Schema.

import AjvModule from "ajv/dist/2020.js";
const Ajv = AjvModule.default;
import AjcVormats from "ajv-formats";
const addFormats = AjcVormats.default;
import stringify from "json-stable-stringify";
import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';
import path from 'node:path';


const prog = program
    .argument('<schema-file>', 'File with schema')
    .argument('<data-file>', 'File with data matching schema')
    .argument('<output-file>', 'Output file after schema matching')
    .parse();
const [schemaFilePath, dataFilePath, outputFilePath] = prog.processedArgs;

const schema = JSON.parse(await fs.readFile(schemaFilePath, { encoding: 'utf8' }));
const schemaId = new URL(schema['$id']);

// Load schema from local filesystem based on relative path from current schema file.
async function loadSchema(uri: string) {
    const newSchameId = new URL(uri, schemaId);
    if (newSchameId.origin != schemaId.origin) {
        throw new Error(`Origins don't match: ${schemaId.href} vs ${newSchameId.href}`);
    }
    const schemaPath = path.join(
        path.dirname(schemaFilePath),
        path.relative(path.dirname(schemaId.pathname), newSchameId.pathname));
    return JSON.parse(await fs.readFile(schemaPath, { encoding: 'utf8' }));
}

const ajv = new Ajv({
    allErrors: true,
    useDefaults: true,
    loadSchema,
});
addFormats(ajv);
ajv.addKeyword({
    keyword: "collection",
    schemaType: "boolean",
});
const validate = await ajv.compileAsync(schema);

const data = JSON.parse(await fs.readFile(dataFilePath, { encoding: 'utf8' }));
if (!validate(data)) {
    for (const error of validate.errors!) {
        console.error(error);
    }
    console.error("Validation failed");
    process.exit(1);
}

await fs.writeFile(outputFilePath, stringify(data, { space: "    " }));
