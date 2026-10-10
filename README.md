# LOL — Lot of Love · AI Dating & Relationship Platform

Monorepo for the platform specified in the BRD and Technical Requirements documents.

- `apps/api` — NestJS API (REST + WebSocket), SQL migrations, seed, tests
- `apps/admin` — Next.js admin console *(Phase 3)*
- `apps/mobile` — React Native app *(Phase 2)*
- `packages/shared` — contracts shared by all apps (zod schemas, error codes, permissions, analytics events)
- `docs/` — [architecture](docs/architecture.md), [decision log](docs/decisions.md),
  [traceability matrix](docs/traceability-matrix.md), [progress](docs/progress.md)

See [docs/progress.md](docs/progress.md#running-locally) to run it.
