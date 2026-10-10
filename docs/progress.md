# Delivery Progress

Phase order: MP §36 / TECH §24. Requirement-level status lives in `traceability-matrix.md` (audited 2026-10-09:
211 requirement rows — 141 DONE, 60 PARTIAL, 8 BE, 2 NOT DONE). The quality-gate report is `final-audit.md`.

| Phase | Scope | Status |
|---|---|---|
| P1 | Architecture, repository, database, authentication | Done |
| P2 | Profile + onboarding, media, taxonomy/geo, flags, CMS, outbox | Done (video/voice intros: no transcoding) |
| P3 | Admin questionnaire engine + admin console | Done |
| P4 | Matching engine (config versions, explainability) | Done (vector similarity not built — MAT-13) |
| P5 | Discovery / swipe / search | Done for smart/daily/search/likes; nearby, crossed-paths, interest, intent and travel feeds have API only |
| P6 | Chat (realtime) + notifications | Done (no GIFs, voice recorder or reply UI; push adapters untested against FCM/APNs) |
| P7 | Safety, verification, moderation, admin user management | Done (human-review verification; trusted-contact web pages missing — see final audit) |
| P8 | Subscriptions | Backend + paywall done; in-app purchase library not integrated; prices not seeded (DEC-023) |
| P9 | AI layer | Done, seeded disabled until a provider is configured (DEC-024) |
| P10 | Events, date planner, date safety, travel, calls | Done except calls (no native LiveKit SDK) and several member screens (see matrix BE rows) |
| P11 | Analytics, experiments, adaptive matching | Done |
| P12 | Performance, security, production hardening | Done in code; never exercised on real infrastructure (see below) |

## Verified on 2026-10-09
| Workspace | Typecheck | Tests | Build |
|---|---|---|---|
| API (`apps/api`) | 0 errors | 219 passed / 35 suites | ✓ |
| Admin (`apps/admin`) | 0 errors | 425 passed / 53 files | ✓ (`next build`, standalone) |
| Mobile (`apps/mobile`) | 0 errors | 151 passed / 17 suites | — (Expo Go run on iOS simulator) |

Database: 19 migrations, ~160 tables. The stack was run locally end to end (API + admin + iOS simulator) with demo data
(`npm run db:seed-demo -w @amora/api`).

## Not exercised yet (honest list)
- CI workflows (tests, audit, CodeQL, ZAP, image builds, deploy): the repository has no commits/remote, so they never ran.
- Docker images: written, never built on this machine (Docker Hub pulls fail locally); k6 load tests never executed; no
  restore drill; no cluster.
- External providers never called for real: Stripe, App Store, Google Play, FCM, APNs, Twilio, SMTP, LiveKit,
  Rekognition, OpenSearch, AI providers. Each is behind an adapter with signature/format tests where feasible.

## Running locally
```bash
npm install
# Postgres 16 with pgvector optional (DEC-020); Redis optional (single-instance mode without it)
cp apps/api/.env.example apps/api/.env            # fill secrets; S3_BUCKET=local for disk storage in development
cd apps/api && node --env-file=.env -r @swc-node/register scripts/migrate.ts && node --env-file=.env -r @swc-node/register scripts/seed.ts
node --env-file=.env -r @swc-node/register scripts/seed-demo.ts   # optional demo admins + members
node --env-file=.env -r @swc-node/register src/main.ts            # API  http://localhost:3000 (docs at /docs)
cd ../admin && API_URL=http://localhost:3000 npx next dev -p 3001 # Admin http://localhost:3001
cd ../mobile && npx expo start --ios                              # iOS simulator (Expo Go)
npm test                                                          # all workspaces; API tests recreate amora_test
```
pgAdmin: import `docs/local-dev/pgadmin-servers.json`.
