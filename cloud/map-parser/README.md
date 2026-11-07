map-parser
==========

Cloud Run service to parse assets from maps into GCS Bucket.

Local dev
---------

Requires 7-Zip `7za` on `PATH` (or set `PATH_7ZA` to the binary). Use a
current 7-Zip (e.g. Debian/Ubuntu `7zip` package), not the unmaintained p7zip.

To run the application locally, and write files to local disk and not GCS Bucket:

```
$ npm install
$ export BUCKET=local
$ npm run start
```

Then call like:

```
$ curl 'http://localhost:8080/parse-map/Neurope_Remake%204.2'
{"message":"Cache generated.","bucket":"local","path":"/tmp/parse-map-OMW6tw","baseUrl":"https://storage.googleapis.com/local/Aberdeen3v3v3/cache-v3"}
```

and in `path` property (`/tmp/parse-map-OMW6tw` in example) you will have result of parsing.

Deployment
----------

```
docker build -t europe-west1-docker.pkg.dev/rowy-1f075/main/map-parser .
docker push europe-west1-docker.pkg.dev/rowy-1f075/main/map-parser
gcloud run deploy --project=rowy-1f075 map-parser \
  --image=europe-west1-docker.pkg.dev/rowy-1f075/main/map-parser:latest \
  --region=europe-west1 \
  --service-account=rowy-functions@rowy-1f075.iam.gserviceaccount.com \
  --memory=8Gi --cpu=2 --concurrency=2 --allow-unauthenticated \
  --set-env-vars=BUCKET=maps-cache-8512
```
