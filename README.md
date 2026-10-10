# LOL — Lot of Love · Backend API

NestJS (REST + WebSocket) API for the LOL dating & relationship platform, backed by PostgreSQL 16 (pgvector),
Redis and S3-compatible object storage.

Sibling repositories:
- **Admin web console** — https://github.com/usaikiran8978/LOL-Admin-Web
- **Mobile app (Expo / React Native)** — https://github.com/usaikiran8978/LOL-Mobile

## Layout
- `src/` — application code (modules, common infrastructure)
- `migrations/` — forward-only SQL migrations (`npm run db:migrate`)
- `scripts/` — migrate, seed, demo seed, encryption-key rotation
- `test/` — end-to-end tests against a real Postgres
- `packages/shared/` — API contracts (zod schemas, error codes, permissions) **shared with the admin and mobile
  repos**. It is a copy in each repo: when you change a contract here, copy `packages/shared/src` to the other two
  repositories in the same release.
- `deploy/`, `docs/runbooks/` — Kubernetes manifests and operations runbooks

## Run locally
```bash
npm install                                 # also compiles packages/shared
docker compose up -d postgres redis         # or a local Postgres 16 with pgvector
cp .env.example .env                        # fill in the secrets
node --env-file=.env -r @swc-node/register scripts/migrate.ts
node --env-file=.env -r @swc-node/register scripts/seed.ts
node --env-file=.env -r @swc-node/register src/main.ts   # http://localhost:3000/docs
npm test                                    # unit + e2e (needs TEST_DATABASE_URL or local Postgres)
```

## Deploy
Build the Docker image **from the repository root** (no extra settings needed):
- API: `docker build --target api -t lol-api .` — listens on `PORT` (3000), health check `/health/ready`
- Migrations (run before each release): `docker build --target migrate -t lol-migrate .`

Production configuration is validated at boot; the API refuses to start with development settings. See
`.env.example` and `docs/runbooks/deployment.md`. Never commit `.env`.
