FROM docker.io/library/debian:trixie-slim AS sevenzip-env

RUN apt-get update \
 && apt-get install -y --no-install-recommends 7zip \
 && rm -rf /var/lib/apt/lists/*

FROM docker.io/library/node:26 AS package-env

WORKDIR /package
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && cd node_modules \
 && rm -rf 7zip-bin/linux 7zip-bin/mac 7zip-bin/win \
 && find . -regex '^./.*/test/.*$' -delete \
 && rm -rf tga/testFiles

FROM gcr.io/distroless/nodejs26-debian13

WORKDIR /app
# Standalone binary; /usr/bin/7za in the Debian package is a shell wrapper.
COPY --from=sevenzip-env /usr/lib/7zip/7za /usr/bin/7za
COPY src src
COPY --from=package-env /package/node_modules node_modules/
CMD ["src/index.ts"]
