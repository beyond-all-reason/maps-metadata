// Script to generate redirects for the Spring Launcher Discord
// Presence implementation.
//
// The launcher would like to quickly generate URLs to map from spring
// name to the image URL. The generated URLs will be like:
//
//   https://maps-metadata.beyondallreason.dev/latest/discordPresenceThumb/redir.{encodeURIComponent(spring_name)}.1024.jpg
//
// and will trigger 301 to the actual image stored under the /i/.

import { program } from '@commander-js/extra-typings';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readMapList } from './maps_metadata.js';

const prog = program
    .argument('<outputPath>', 'Discord presence thumbs output directory.')
    .parse();
const [outputPath] = prog.processedArgs;

const imagorUrlBase = 'https://maps-metadata.beyondallreason.dev/i/';
const rowyBucket = 'rowy-1f075.appspot.com';
// The same as used for Chobby mipmap overrides
const imageParams = `fit-in/1024x1024/filters:format(jpeg):quality(90)`;

const maps = await readMapList();

await fs.rm(outputPath, { force: true, recursive: true });
await fs.mkdir(outputPath, {recursive: true});

for (const map of Object.values(maps)) {
    const url = `${imagorUrlBase}${imageParams}/${rowyBucket}/${encodeURI(map.photo[0].ref)}`;
    await fs.writeFile(path.join(outputPath, `redir.${encodeURIComponent(map.springName)}.1024.jpg`), url);
}
