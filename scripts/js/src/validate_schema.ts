// Script that validates a JSON file against a JSON Schema.

import AjvModule from "ajv/dist/2020.js";
const Ajv = AjvModule.default;
import stringify from "json-stable-stringify";
import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';


const prog = program
    .argument('<schema-file>', 'File with schema')
    .argument('<data-file>', 'File with data matching schema')
    .argument('<output-file>', 'Output file after schema matching')
    .parse();
const [schemaFilePath, dataFilePath, outputFilePath] = prog.processedArgs;

const schema = await fs.readFile(schemaFilePath, { encoding: 'utf8' });
const jsonData = await fs.readFile(dataFilePath, { encoding: 'utf8' });

const ajv = new Ajv({
    allErrors: true,
    useDefaults: true,
});
const validate = ajv.compile(JSON.parse(schema));

const data = JSON.parse(jsonData);
if (!validate(data)) {
    for (const error of validate.errors!) {
        console.error(error);
    }
    console.error("Validation failed");
    process.exit(1);
}

await fs.writeFile(outputFilePath, stringify(data, { space: "    " }));
