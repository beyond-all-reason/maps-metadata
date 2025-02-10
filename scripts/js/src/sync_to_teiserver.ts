import fs from 'node:fs/promises';
import { clientCredentialsGrant, discovery, fetchProtectedResource } from 'openid-client'

if (!process.env.TEISERVER_URL || !process.env.TEISERVER_CLIENT_ID || !process.env.TEISERVER_CLIENT_SECRET) {
    console.error('Missing TEISERVER_URL, TEISERVER_CLIENT_ID or TEISERVER_CLIENT_SECRET');
    process.exit(1);
}
const teiserverUrl = new URL(process.env.TEISERVER_URL);

// Read maps
const teiserverMaps = await fs.readFile('gen/teiserver_maps.validated.json', { encoding: 'utf8' });

// Get access token
const config = await discovery(
    teiserverUrl,
    process.env.TEISERVER_CLIENT_ID,
    process.env.TEISERVER_CLIENT_SECRET,
    undefined,
    { algorithm: 'oauth2' });
const token = await clientCredentialsGrant(config);

// Push update
const response = await fetchProtectedResource(
    config,
    token.access_token,
    new URL('teiserver/api/admin/assets/update_maps', teiserverUrl),
    'POST',
    teiserverMaps,
    new Headers({
        'Content-Type': 'application/json; charset=utf-8'
    }));
if (!response.ok) {
    console.error(response);
    process.exit(1);
} else {
    console.log('pushed maps to teiserver');
}
