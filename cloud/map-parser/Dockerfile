FROM docker.io/library/node:24 AS package-env

WORKDIR /package
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && cd node_modules \
 && find . -regex '^./7zip-bin/\(linux/[^x]\|win\|mac\).*$' -delete  \
 && find . -regex '^./.*/test/.*$' -delete \
 && rm -rf tga/testFiles

FROM gcr.io/distroless/nodejs24-debian13

WORKDIR /app
COPY src src
COPY --from=package-env /package/node_modules node_modules/
CMD ["src/index.ts"]
