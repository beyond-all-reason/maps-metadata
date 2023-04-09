import express from 'express';
import bodyParser from 'body-parser';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

const app = express();
app.use(bodyParser.json());

const appId = process.env.APP_ID;
const installationId = process.env.INSTALLATION_ID;
const privateKey = process.env.PRIVATE_KEY;
const repo = process.env.REPO;

if (!appId || !installationId || !privateKey || !repo) {
    console.error('Missing required environment variables APP_ID, INSTALLATION_ID, PRIVATE_KEY, REPO')
    process.exit(1);
}

const [repoOwner, repoName] = repo.split('/', 2);

app.post('/trigger', async (req, res) => {
    const { eventType, clientPayload } = req.body;

    if (!eventType || !clientPayload) {
        return res.status(400).json({
            error: 'Missing required parameters (eventType, clientPayload).',
        });
    }

    try {
        const octokit = new Octokit({
            authStrategy: createAppAuth,
            auth: {
                appId: appId,
                privateKey: privateKey,
                installationId: installationId,
            },
        });

        await octokit.repos.createDispatchEvent({
            owner: repoOwner,
            repo: repoName,
            event_type: eventType,
            client_payload: clientPayload
        });

        res.status(200).json({
            message: 'Repository dispatch event triggered successfully.',
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'An error occurred while triggering the repository_dispatch event.' });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
