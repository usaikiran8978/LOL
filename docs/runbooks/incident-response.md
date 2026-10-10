# Incident response runbook

## Severity
| Sev | Examples | Response |
|---|---|---|
| SEV1 | API down; data breach suspected; safety feature failure (SOS, reporting, blocking); payments double-charging | Page on-call immediately, incident channel, status page within 15 min |
| SEV2 | Chat/matching degraded; push or email delivery stopped; moderation queue not draining | On-call within 30 min |
| SEV3 | Single non-critical feature broken; elevated error rate on one route | Next business day |

Safety-related failures are always at least SEV2, because people may depend on them during a date.

## First 15 minutes
1. Acknowledge the page; open an incident channel; name an incident commander (IC) and a scribe.
2. Check: `GET /health/ready` (database + Redis), the dashboard (5xx by route: `http_server_errors_total`, latency:
   `http_request_duration_seconds`), `outbox_pending_events{state="stuck"}`, `moderation_open_cases`.
3. Find the change: recent deploys (GitHub Actions → Deploy), recent admin config publishes (Admin → Audit logs:
   filter `matching.config_published`, `questionnaire.published`, `flags.updated`, `ai.prompt_published`).
4. Mitigate before root-causing: roll back the deploy (see deployment runbook), disable the feature flag, roll back the
   config version, or disable the AI feature (Admin → AI → feature off; the app falls back to non-AI behaviour).

## Common playbooks
- **Database saturation**: check slow queries (`pg_stat_statements`), connection count vs. `DATABASE_POOL_MAX × pods`.
  Scale API down if connections are exhausted. Analytics aggregation can be paused via `WORKERS_ENABLED=false` on a
  dedicated worker deployment.
- **Redis outage**: the API keeps serving. Rate limits fall back to per-instance memory (logged as
  `rate-limit store degraded`), realtime fan-out only reaches sockets on the same pod, and readiness fails if Redis was
  configured, so pods leave the load balancer. Restore Redis first.
- **Outbox backlog / stuck events**: `SELECT topic, count(*), max(last_error) FROM outbox_events WHERE dispatched_at IS NULL GROUP BY 1;`
  Fix the handler, then reset attempts: `UPDATE outbox_events SET attempts = 0, available_at = now() WHERE dispatched_at IS NULL AND topic = '…';`
- **Provider outage** (SMS, email, push, payments, AI): providers are behind adapters. Notifications retry and then
  dead-letter; payments webhooks are idempotent and can be replayed from the provider dashboard once healthy.
- **Abuse wave / spam**: tighten text-moderation rules and auto-action thresholds in Admin → Safety; ban-evasion
  fingerprints link new accounts; use segment-targeted feature flags to pause sign-ups in a country.

## Security incident / suspected breach
1. Treat as SEV1. Preserve evidence: do not delete logs, audit rows or pods (cordon and snapshot instead).
2. Contain: rotate the affected secrets (`JWT_ACCESS_SECRET` rotation signs out everyone; `SIGNING_SECRET`
   invalidates upload tokens and check-in codes; all admin sessions can be revoked with `UPDATE admin_sessions SET revoked_at = now() WHERE revoked_at IS NULL;`).
   To rotate `FIELD_ENCRYPTION_KEY`: deploy a new key with a bumped `FIELD_ENCRYPTION_KEY_VERSION`, list the old key in
   `FIELD_ENCRYPTION_RETIRED_KEYS` (`<version>:<base64>`), run `npm run db:rotate-encryption` until it
   reports 0, then remove the retired key (DEC-033).
3. Review `audit_logs` and `admin_data_access_logs` for the window.
4. Legal and privacy: GDPR requires notifying the supervisory authority within 72 hours of becoming aware of a
   personal-data breach. Other regimes (`country_configs.privacy_regime`) have their own deadlines. The DPO owns this.

## After the incident
Blameless post-mortem within 5 business days: timeline, impact (users, countries, money), root cause, what detection
missed, and actions with owners. Add a regression test or alert for every root cause.
