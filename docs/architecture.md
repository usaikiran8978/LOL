# Architecture

Source documents: `Global_AI_Dating_Platform_BRD` (BRD) and `Global_AI_Dating_Platform_Technical_Document` (TECH).
Working codename: **amora** (the documents do not name the product; see DEC-001).

## 1. Repository layout (monorepo, npm workspaces)

```
apps/
  api/            NestJS modular monolith (REST + WebSocket) — TECH §1–3, §14
    migrations/   Ordered, hand-written SQL migrations (source of truth for the schema)
    src/
      common/     cross-cutting: config, db, errors, http, crypto, audit, analytics, outbox, jobs, realtime,
                  storage, messaging, geo, i18n, redis (rate-limit store), observability (metrics, access logs)
      modules/    one folder per bounded context (see §3); background jobs live with their module
    scripts/      migrate, seed (+ seed-data), rotate-field-encryption
    test/         integration/e2e tests against a real Postgres
    Dockerfile    targets: api (runtime), migrate (one-shot job)
  admin/          Next.js admin console (TECH §12); Dockerfile (standalone server)
  mobile/         React Native + TypeScript (Expo, bare-capable)
deploy/           reference Kubernetes manifests (kustomize overlays) + rollout script (DEC-034)
loadtest/k6/      smoke + core-journey load tests
.github/workflows CI (tests, audit, images, DAST), CodeQL, deploy (staging → production with approvals)
packages/
  shared/         zod contracts shared by api/admin/mobile: request/response schemas,
                  error codes, enums, analytics event names, i18n message keys
docs/             architecture, decisions, traceability matrix, API & data docs, progress
```

## 2. Why a modular monolith first

TECH §1 asks for *independent services*; TECH appendix says "Kubernetes only when justified".
We satisfy both by building **one deployable with hard module boundaries**:

- Every TECH §3 component is a NestJS module with its own folder, its own tables
  (prefix-free but owned — see `apps/api/migrations`), and a public service interface.
- Modules talk to each other only through exported services or domain events on the
  internal event bus (`EventBus` → outbox table → queue). No module reads another module's tables.
- Each module can be extracted into its own service later by swapping the in-process call for HTTP/queue
  without changing its callers' contracts.

## 3. Component → module mapping (TECH §3)

| TECH component | Module | Notes |
|---|---|---|
| API Gateway | `bootstrap.ts` + `common/http` | helmet, CORS, request-id, rate limit (Redis-backed), versioned prefix `/v1`, OpenAPI (non-prod) |
| Identity/Auth | `modules/auth` | password + OTP + social (Google/Apple OIDC, Facebook), JWT access + rotating refresh, sessions/devices |
| User/Profile/Preference | `modules/users`, `modules/profiles` | profiles, media, preferences, location (+ crossed paths), onboarding, profile state |
| Questionnaire | `modules/questionnaire` | versioned questions, answers pinned to versions, carry-over, scheduled publish |
| Matching / Recommendation / Discovery | `modules/matching` | engine (pure), features, config versions, precomputed recommendations, swipes, search (OpenSearch or Postgres), adaptive affinities |
| Chat/Realtime | `modules/chat` + `common/realtime` | WebSocket gateway (`/v1/ws`), Redis pub/sub fan-out + presence |
| Media | `modules/profiles/media.service` + `common/storage` | signed upload/download URLs, processing with sharp, moderation hand-off |
| AI Orchestration | `modules/ai` | provider gateway, versioned prompts, schema-validated output, budgets, PII redaction |
| Safety/Moderation/Verification | `modules/safety` | reports, cases, actions, appeals, rules, image moderation, verification providers, risk scores |
| Event | `modules/events` | events, RSVP/waitlist, check-in |
| Date Planner / Calls | `modules/dates`, `modules/calls` | experiences, plans, date safety, trusted contacts; LiveKit tokens, couple features |
| Notification | `modules/notifications` | templates, preferences, quiet hours, push (FCM/APNs), email, SMS |
| Subscription/Billing | `modules/billing` | Stripe, App Store, Google Play adapters; webhooks inbox; entitlements |
| Analytics / Experiments | `modules/analytics` | ingestion, daily KPIs, partitions, experiments |
| Privacy | `modules/privacy` | data export, account deletion + purge, retention, DSAR queue |
| Admin | `modules/admin/*` + admin controllers in each module | RBAC + country ABAC, MFA, invites, audit logs |
| Config/Feature Flag/Catalog/CMS | `modules/platform`, `modules/catalog`, `modules/content`, `modules/legal` | flags, segments, settings, experiments config, taxonomy, CMS, legal docs |

## 4. Cross-cutting rules

- **Contracts first.** Request schemas live in `packages/shared` (zod). The API validates with them and the clients
  type against them. OpenAPI (`/docs`, non-production) currently lists routes only — request/response schemas are not
  yet generated from the zod contracts (NFR-22).
- **Errors.** One envelope everywhere: `{ error: { code, message, details?, requestId } }`. Codes in `@amora/shared/errors`.
- **Pagination.** Cursor-based (opaque base64 of the sort key) for every list; no offset pagination on feeds/messages.
- **AuthZ.** Users: ownership + relationship checks (e.g. conversation membership, match existence, block state).
  Admins: permission strings (`questions.publish`, `users.ban`, …) granted via roles; never a boolean flag.
- **Audit.** Every privileged admin write and every security-relevant user action writes `audit_logs` in the same transaction.
- **Analytics.** Domain events are emitted to `analytics_events` with the canonical names from TECH §19.
- **i18n.** No user-facing string is hard-coded on the server: server returns message *keys* + params; content
  managed by admin is stored per locale (`*_translations` tables).
- **Privacy.** Exact coordinates stored only in `user_locations` (restricted access); every read path to other users
  goes through a coarsening function (geohash precision 5 ≈ 5 km, distances bucketed).
- **Time.** All timestamps `timestamptz`, UTC.

## 5. Async processing

Transactional outbox (`outbox_events`), written in the same transaction as the state change, is drained by
`OutboxService` with `FOR UPDATE SKIP LOCKED` (safe with many API replicas), retries with exponential backoff, and dead-letters after
8 attempts (`outbox_pending_events{state="stuck"}` metric). Periodic work runs through `JobScheduler`, which takes a
Postgres advisory lock per job so exactly one replica runs each tick (recommendation precompute, notification dispatch,
moderation/verification expiry, risk scores, billing renewals, event/date reminders, date-safety overdue sweep,
analytics aggregation + partitions, privacy purge + retention). `WORKERS_ENABLED=false` turns both off for web-only replicas.
A broker (SQS/Kafka) is not needed at current scale; handlers are idempotent so one can be introduced behind the outbox.

## 6. Matching pipeline (TECH §6)

`eligibility → deal-breakers → candidate retrieval → feature scoring → compatibility scoring → behavioral ranking → safety filter → diversity → final`.
Every stage is a pure function over typed inputs, so the deterministic tests TECH §20 asks for can run without a database.
Weights, thresholds, limits and rules come from the **published matching config version**; each stored recommendation
records the config version and the top contributing factors (explainability).

## 7. Security baseline (TECH §15)

argon2id password hashing; short-lived JWT access tokens (15 min) + opaque rotating refresh tokens with reuse detection
(whole token family revoked); per-route rate limits + login brute-force lockout; helmet secure headers; zod input
validation; parameterized SQL only (Kysely); signed media URLs; secrets from env/secrets manager; device/session management.
Admin: cookie session + CSRF token + TOTP MFA, fail-closed permission guard, country-scoped ABAC, full audit trail.
Sensitive columns use AES-256-GCM with versioned keys (DEC-033). Production config refuses to boot with dev adapters,
insecure cookies, MFA or rate limiting off, or without Redis/S3. CI runs CodeQL, dependency audit and an OWASP ZAP API scan.

## 8. Environments & infrastructure

`docker-compose.yml` runs Postgres+pgvector, Redis, OpenSearch, MinIO (S3), Mailpit locally.
Production: managed Postgres (pgvector), managed Redis, optional managed OpenSearch, S3, containers (DEC-034);
separate dev/staging/prod; CI/CD with prod approvals; migrations run as a release step before pods roll (TECH §21).
Operations: `docs/runbooks/` (deployment, incident response, backup/restore & DR, performance/SLOs).

## 9. Observability

- `GET /metrics` (Prometheus, bearer `METRICS_TOKEN`): request latency by route template, 5xx counter, outbox backlog,
  open moderation cases by severity, Node.js runtime metrics.
- `LOG_FORMAT=json`: one structured access-log line per request with `requestId` (echoed as `X-Request-Id`), method,
  route template, status, duration. No bodies, query strings or tokens are logged.
- `/health/live` (process) and `/health/ready` (Postgres + Redis when configured) drive orchestrator probes.
- Not yet: distributed tracing (OpenTelemetry). The request id is the correlation key until then.
