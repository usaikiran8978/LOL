# syntax=docker/dockerfile:1.7
# Build from the repository root:  docker build --target api -t lol-api .
# Targets:
#   api      — production runtime (non-root, prod deps only, compiled JS)  [default: last stage]
#   migrate  — one-shot job: runs SQL migrations before a rollout:  docker build --target migrate -t lol-migrate .

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY scripts/build-shared.cjs scripts/
COPY packages/shared packages/shared
# postinstall compiles packages/shared.
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.build.json .swcrc ./
COPY src src
COPY scripts scripts
COPY migrations migrations
RUN npx tsc -p tsconfig.build.json

# Migration/seed job: keeps dev deps (the scripts run through @swc-node/register).
FROM build AS migrate
USER node
CMD ["npm", "run", "db:migrate"]

FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

FROM node:${NODE_VERSION} AS api
ENV NODE_ENV=production LOG_FORMAT=json PORT=3000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/package.json package.json
COPY --from=build --chown=node:node /app/dist dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
