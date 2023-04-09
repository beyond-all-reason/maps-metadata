github-trigger
==============

Cloud Run service to a trigger [`repository_dispatch`] event for a configured GitHub repository.

Local dev
---------

You need to configure GitHub App on your own fork of the maps-metadata
repository. Follow [GitHub's documentation](https://docs.github.com/en/apps/creating-github-apps/creating-github-apps/creating-a-github-app)
to do that. The app needs permissions as documented by docs of [`repository_dispatch`]: `metadata:read` and `contents:read&write`. Once you've done that, install the App on your fork, and set following environment variables:

```
export APP_ID={appId}
export INSTALLATION_ID={installationId}
export PRIVATE_KEY=$(cat ga.private-key.pem)
export REPO={username}/maps-metadata
```

Then just

```
npm install
npm run dev
```

and call like:

```
$ curl -X POST -H "Content-Type: application/json" -d '{"eventType": "test", "clientPayload": {"a": "b"}}' 'http://localhost:8080/trigger'
{"message":"Repository dispatch event triggered successfully."}
```

You should see workflow being triggered in your GitHub repository.

Deployment
----------

Assumes that env variables and resource constraints are already set properly in
a previous deployment:

```
docker build -t europe-west1-docker.pkg.dev/rowy-1f075/main/github-trigger .
docker push europe-west1-docker.pkg.dev/rowy-1f075/main/github-trigger
gcloud run deploy --project=rowy-1f075 github-trigger \
  --image=europe-west1-docker.pkg.dev/rowy-1f075/main/github-trigger:latest \
  --region=europe-west1 \
  --service-account=rowy-functions@rowy-1f075.iam.gserviceaccount.com \
  --no-allow-unauthenticated
```

[`repository_dispatch`]: https://docs.github.com/rest/reference/repos#create-a-repository-dispatch-event
