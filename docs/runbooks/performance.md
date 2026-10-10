# Performance & capacity

## Proposed SLOs (the BRD sets no numeric targets; confirm with product/ops)
| Surface | Target |
|---|---|
| Read endpoints (feed, conversations, profile) | p95 < 300 ms, p99 < 800 ms |
| Write endpoints (swipe, send message) | p95 < 500 ms, p99 < 1.2 s |
| Recommendations feed | p95 < 400 ms |
| Availability | 99.9 % monthly (API), excluding planned maintenance |
| Error rate | < 1 % 5xx |

## Load tests (k6)
- `loadtest/k6/smoke.js`: post-deploy smoke, unauthenticated.
- `loadtest/k6/core-journeys.js`: sign-in → feed → swipes → conversations → send message, ramping to `PEAK_VUS`.
  Needs onboarded test accounts in staging (`USERS_FILE`). **Never run against production.**

Status: scripts written, **not yet executed** (no staging environment exists yet). Record runs here:

| Date | Env | Peak VUs | p95 read | p95 write | Errors | Notes |
|---|---|---|---|---|---|---|
| _pending_ | | | | | | |

## Monitoring
- Prometheus scrapes `GET /metrics` (bearer `METRICS_TOKEN`): `http_request_duration_seconds{route}`,
  `http_server_errors_total`, `outbox_pending_events{state}`, `moderation_open_cases{severity}`, Node.js runtime metrics.
- Structured JSON access logs (`LOG_FORMAT=json`) carry `requestId`, also returned as `X-Request-Id`.
- Suggested alerts: 5xx rate > 1 % for 5 min; p95 > SLO for 10 min; `outbox_pending_events{state="stuck"} > 0`;
  `moderation_open_cases{severity="critical"} > 0` for 15 min (safety SLA); readiness failures.

## Known scaling levers
- API pods are stateless (HPA on CPU). Realtime fan-out and rate limits are shared through Redis.
- Recommendations are precomputed into `match_candidates` and served from there; OpenSearch takes over search when
  configured (DEC-019).
- `analytics_events` is partitioned monthly; old partitions can be detached and archived.
