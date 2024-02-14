#!/bin/bash

set -euo pipefail

if [ $# -ne 2 ]; then
    echo "Usage: $0 <commit> <set-latest>"
    exit 1
fi

if [[ ! -d gen ]]; then
    echo "gen directory doesn't exist"
    exit 1
fi

COMMIT="$1"
SET_LATEST="$2"

echo "Deploying commit: $COMMIT, set latest: $SET_LATEST"

for var in CLOUDFLARE_ACCESS_KEY_ID CLOUDFLARE_SECRET_ACCESS_KEY CLOUDFLARE_ACCOUNT_ID R2_BUCKET_NAME; do
    if [[ -z "${!var}" ]]; then
        echo "$var is not set"
        exit 1
    fi
done

TMP_FILE="$(mktemp /tmp/rclone-XXXXXX.conf)"

cat << EOF > $TMP_FILE
[r2]
type = s3
provider = Cloudflare
access_key_id = $CLOUDFLARE_ACCESS_KEY_ID
secret_access_key = $CLOUDFLARE_SECRET_ACCESS_KEY
endpoint = https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com
acl = private
chunk_size = 20M
upload_concurrency = 2
EOF

trap "rm -f $TMP_FILE" EXIT

rclone --config $TMP_FILE copy --exclude "redir.*" gen "r2:$R2_BUCKET_NAME/$COMMIT"
rclone --config $TMP_FILE copy --include "redir.*" --header-upload "Content-Type: text/plain" gen "r2:$R2_BUCKET_NAME/$COMMIT"

if [ "$SET_LATEST" = "true" ]; then
    printf "$COMMIT" | rclone --config $TMP_FILE --header-upload "Content-Type: text/plain" rcat "r2:$R2_BUCKET_NAME/HEAD"
fi

echo "Done"
