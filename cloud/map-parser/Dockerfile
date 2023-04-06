FROM docker.io/library/node:18 AS compile-env

WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src src/
RUN npm run build

FROM docker.io/library/node:18 AS package-env

WORKDIR /package
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && cd node_modules \
 && rm -rf spring-map-parser/test typescript prettier @babel @typescript-eslint

FROM gcr.io/distroless/nodejs18-debian11

WORKDIR /app
COPY --from=compile-env /build/dist dist/
COPY --from=package-env /package/node_modules node_modules/
CMD ["--enable-source-maps", "dist/index.js"]
