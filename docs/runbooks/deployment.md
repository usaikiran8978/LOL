# Deployment runbook

Reference target: Kubernetes (DEC-023). Images are built once per commit and promoted unchanged staging → production.

## One-time setup
1. **Registry**: GHCR (`ghcr.io/<org>/amora-{api,migrate,admin}`), pushed by `.github/workflows/deploy.yml`.
2. **Namespaces**: `amora-staging`, `amora-production`.
3. **Secret `amora-api-env`** in each namespace, sourced from your secret manager (External Secrets / Sealed Secrets).
   Do not commit it. Required keys (validated at boot by `src/common/config/config.ts`, which **refuses to start**
   in production with dev adapters, insecure cookies, MFA off, rate limiting off, or no Redis/S3):
   `DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, OTP_PEPPER, SIGNING_SECRET, FIELD_ENCRYPTION_KEY, EMAIL_PROVIDER=smtp, SMTP_URL,
   SMS_PROVIDER=twilio, TWILIO_*, S3_BUCKET, S3_REGION, ADMIN_COOKIE_SECURE=true, ADMIN_REQUIRE_MFA=true, CORS_ORIGINS,
   METRICS_TOKEN`, plus the provider keys you enable (Stripe, Apple/Google billing, FCM/APNs, LiveKit, AI providers,
   Google/Apple/Facebook sign-in, Rekognition, OpenSearch). See `.env.example`.
4. **GitHub environments** `staging` and `production`: add required reviewers (production: at least two, from
   engineering + operations) and the secret `KUBE_CONFIG` (base64 kubeconfig for a namespace-scoped deploy account).
5. **Ingress/TLS** is cluster-specific and not included: terminate TLS at the ingress, route `api.<domain>` → `amora-api:80`
   and `admin.<domain>` → `amora-admin:80`. Restrict the admin host by IP allow-list/VPN or SSO proxy in addition to
   admin MFA. WebSockets (`/v1/ws`) need ingress upgrade support and a read timeout ≥ 75 s.
6. **Managed services**: PostgreSQL 16 with `pgvector`, `citext`, `pgcrypto`, `pg_trgm`, `btree_gist`; Redis 7;
   S3-compatible storage with lifecycle rules for `exports/` (7 days); optional OpenSearch.

## Normal release
Merge to `main` → `Deploy` workflow:
1. Builds `amora-api`, `amora-migrate`, `amora-admin` tagged with the commit SHA.
2. **staging** (approval): `deploy/rollout.sh` runs the migration Job to completion, then rolls API + admin and
   waits for readiness. Failure in migration aborts before any pod changes; failed rollout triggers `rollout undo`.
3. Run the smoke test: `k6 run -e BASE_URL=https://api.staging.<domain> loadtest/k6/smoke.js`.
4. **production** (approval): same steps.

## Migration rules (zero-downtime)
Migrations run before new pods start, so the previous release must keep working against the new schema:
- Add columns as nullable or with defaults; backfill in batches; enforce `NOT NULL` in a later release.
- Never rename/drop a column the running release reads — expand → migrate → contract over two releases.
- Create large indexes `CONCURRENTLY` in their own migration file (no transaction).
- Migrations are forward-only and checksum-verified; editing an applied file fails the job by design.

## Rollback
- **Code**: `kubectl -n amora-production rollout undo deploy/amora-api` (and `amora-admin`), or re-run the deploy
  workflow for an earlier SHA. Safe whenever migrations followed the expand/contract rules above.
- **Schema**: write a new forward migration; do not hand-edit `schema_migrations`.
- **Config**: feature flags, matching/questionnaire/prompt versions are rolled back from the admin panel (all versioned).
