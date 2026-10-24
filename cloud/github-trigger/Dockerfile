FROM docker.io/library/node:26 AS package-env

WORKDIR /package
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM gcr.io/distroless/nodejs26-debian13

WORKDIR /app
COPY package.json .
COPY src src
COPY --from=package-env /package/node_modules node_modules/
CMD ["src/index.ts"]
