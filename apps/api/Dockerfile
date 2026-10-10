# syntax=docker/dockerfile:1.7
# Build from the repository root:  docker build -f apps/api/Dockerfile --target api -t amora-api .
# Targets:
#   api      — production runtime (non-root, prod deps only, compiled JS)
#   migrate  — one-shot job: runs SQL migrations (and optionally seeds) before a rollout

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# All workspace manifests are needed so the lockfile resolves; only api + shared are installed.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/mobile/package.json apps/mobile/
RUN --mount=type=cache,target=/root/.npm npm ci -w @amora/shared -w @amora/api --include-workspace-root=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @amora/shared && npm run build -w @amora/api

# Migration/seed job: keeps dev deps (the scripts run through @swc-node/register).
FROM build AS migrate
WORKDIR /app/apps/api
USER node
CMD ["npm", "run", "db:migrate"]

FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/mobile/package.json apps/mobile/
RUN --mount=type=cache,target=/root/.npm npm ci -w @amora/shared -w @amora/api --include-workspace-root=false --omit=dev

FROM node:${NODE_VERSION} AS api
ENV NODE_ENV=production LOG_FORMAT=json PORT=3000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/apps/api/package.json apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
