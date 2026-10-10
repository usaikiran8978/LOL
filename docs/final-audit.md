# Final Audit — Amora (Global AI Dating Platform)

**Date:** 2026-10-09 · **Scope:** BRD, Technical Document and Master Development Prompt, phases P1–P12.
**Basis:** code-verified traceability matrix (`traceability-matrix.md`, 211 requirement rows) plus full typecheck, test
and build runs of all workspaces on this date. **This is not a claim of 100% completion.**

| Status | Rows | Meaning |
|---|---|---|
| DONE | 141 | API + DB + validation + authZ + tests, and UI where the requirement is user- or admin-facing |
| PARTIAL | 60 | Real but incomplete (named per row) |
| BE | 8 | Backend built and tested; no client screen |
| NOT DONE | 2 | Not implemented |

Verification run: API 219 tests / 35 suites, admin 425 / 53 files, mobile 151 / 17 suites, all passing; 0 type errors;
API and admin production builds succeed. The full stack was run locally (API, admin console, iOS simulator) on demo data.

---

## 1. IMPLEMENTED
- **Identity & access:**
  - Email/phone sign-up, password and SMS-code login, Google/Apple/Facebook (backend) sign-in.
  - Verification, password reset and account recovery.
  - Rotating refresh tokens with reuse detection, sessions and devices, lockout, age gate, consent records.
- **Profiles & onboarding:**
  - Admin-configurable onboarding flow, taxonomy-driven attributes, interests, prompts.
  - Photos with moderation, privacy settings, location coarsening, travel plans.
- **Questionnaire engine (admin-controlled):**
  - Versioned questions, immutable published versions, carry-over mappings, conditional logic.
  - Impact analysis, scheduling and rollback; admin builder UI; member questionnaire in the app.
- **Matching:**
  - Pure compatibility engine plus ranking.
  - Admin-versioned weights, intent matrix, ranking, diversity and safety rules, with no hard-coded weights.
  - Explainable scores, a test/explain tool, adaptive affinities.
- **Discovery:** smart, daily and search feeds; likes, passes, super-likes and rewind; likes received; matches and unmatch.
- **Chat:**
  - WebSocket realtime with Redis fan-out, idempotent sends, uploads via signed URLs.
  - Reactions, read receipts, icebreakers, moderation.
- **Safety:**
  - Reports, blocks, moderation cases, actions and reversal; appeals decided by a different reviewer.
  - Text and image moderation, risk scores, ban-evasion fingerprints, verification (human review).
  - Date-safety sessions with check-ins, escalation and SOS; trusted contacts.
  - Country-scoped admin access (ABAC) on every user-targeted endpoint.
- **Monetization (server side):**
  - Stripe, App Store and Google Play adapters, an idempotent webhook inbox, and entitlements rebuilt from subscriptions.
  - Coupons, consumables, refunds, grants, restore.
- **AI layer:**
  - Provider-agnostic gateway, versioned prompts with schema validation, fallback model.
  - PII redaction, injection containment, consent and plan gating (also on cache hits), budgets, metadata-only audit.
- **Events & dates:**
  - Events with RSVP, waitlist, organizer/admin check-in by code, edits with attendee notices, paid tickets via checkout.
  - Date planner, AI date ideas, admin date-idea catalog and date-safety settings.
- **Notifications:**
  - Versioned, localized templates (no user-facing literals in server code).
  - Preferences, quiet hours, push/email/SMS dispatch with retries and dead-lettering, draft preview.
- **Analytics:** daily KPIs, monthly partitions, CSV export, experiments with deterministic assignment and significance.
- **Privacy:**
  - Data export (DSAR) and account deletion with a 14-day grace period and a full purge.
  - Retention jobs, admin DSAR queue, field encryption with key rotation.
- **Admin console:** 12 modules covering every admin-controlled rule (questions, weights, prompts, templates, flags, settings, prices, etc.), RBAC + MFA + audit.
- **Hardening:**
  - Production config guards; Redis rate limiting that falls back to per-instance memory.
  - Prometheus metrics, JSON access logs, readiness checks.
  - Dockerfiles, CI (tests, audit, CodeQL, ZAP), Kubernetes manifests with approval-gated deploys, k6 scripts, runbooks.

## 2. PARTIALLY IMPLEMENTED (most material; all 60 rows are listed in the matrix summary)
- **In-app purchases (MON-02/03/04/06):** paywall, entitlements and restore exist; no StoreKit/Play Billing library, so purchase buttons are disabled with an explanation. Prices are not seeded (DEC-023).
- **Calls (COM-03):** SFU token issuance and call signalling work; no native LiveKit SDK, so no audio/video UI.
- **Video/voice profile intros (ONB-09, PRF-01, NFR-06):** no transcoding and no mobile capture.
- **Discovery variants (DSC-03…07):** nearby, crossed-paths, interest, intent and travel feeds exist in the API, with no dedicated mobile screens and partly untested.
- **AI member features (COM-07/08, AIC-01…15):** built and gated; seeded disabled until a provider is configured. Several (conversation coach, match explanation, reflection, scam check) have no UI and/or no test.
- **Member screens missing for built backends (BE rows):**
  - event creation, event feedback, date feedback;
  - journey and couple space;
  - account status and appeals;
  - mute/restrict, message replies, calendar export;
  - the Facebook button.
- **Safety:** verification is human-review only (no automated liveness, DEC-026). Moderation rule types `velocity`, `classifier_threshold` and `sla` are stored but never evaluated.
- **Provider adapters never exercised against real services:** FCM, APNs, SMTP, Twilio, Apple JWS (no test at all), Google Play.
- **Legal copy (AUTH-11):** placeholder text. **Launch blocker.**
- **Operations:**
  - CI never ran (no commits or remote); Docker images never built; k6 never executed; no restore drill.
  - No OpenTelemetry tracing; OpenAPI lists routes without schemas.
  - `data_region` stored but not enforced.

## 3. NOT IMPLEMENTED
- **MAT-13 vector similarity:** `user_embeddings` exists but no `VectorStore`/embedding pipeline uses it.
- **SAF-06 AI-generated/deceptive media detection:** no detector; `ai_generated_score` is never written.

## 4. RISKS
1. **Trusted-contact web pages don't exist (safety-critical).**
   - Confirmation and live date-safety links point to `PUBLIC_WEB_URL/trusted-contact/confirm` and `/safety/:token`, but nothing serves them.
   - A contact cannot confirm, or follow a date during an alert. The APIs behind them (`/v1/public/safety/*`) are built and tested.
2. **Monetization can't earn on mobile** until a store-purchase library is integrated and real prices and product IDs are configured.
3. **Unproven infrastructure:** none of the deployment path (images, CI, cluster, backups, alerts) has run, and performance targets (DEC-035) are unmeasured.
4. **Provider integrations unproven** against live sandboxes (payments, push, SMS, email, AI, image moderation).
5. **Legal and compliance:** placeholder legal text, unenforced data residency, and the privacy policy must disclose backup retention after deletion (backup runbook).
6. **Dependency advisories:** high-severity advisories remain in the Expo/Metro/Jest toolchains (dev/build time). CI gates only on critical (DEC-036).
7. **Concurrency hot spots not load-tested:** per-request session lookup in Postgres, recommendation precompute and the outbox at scale.

## 5. RECOMMENDATIONS (in priority order)
1. Build the public trusted-contact pages, localized, on a small web app or the API, before any beta.
2. Commit the repository, push to a remote and let CI run. Fix whatever the first ZAP, CodeQL and image builds report.
3. Integrate StoreKit 2 / Play Billing (e.g. `react-native-iap` in a development build); configure real prices and product IDs; test Apple JWS against sandbox notifications.
4. Stand up staging (managed Postgres, Redis, S3), run `loadtest/k6/*` against the proposed SLOs, and do a restore drill.
5. Replace the placeholder legal copy (counsel) and decide data-residency enforcement per `country_configs.data_region`.
6. Do a native development build to integrate LiveKit and push (FCM/APNs) and test on devices.
7. Finish the member screens for the 8 BE rows and the discovery variants. Add admin control for icebreaker templates.
8. Implement or remove the unevaluated moderation rule types. Decide on vector similarity (MAT-13) and AI-media detection (SAF-06) as Phase-2 items.
9. Add OpenTelemetry tracing and generate OpenAPI schemas from the zod contracts.
10. Configure an AI provider in Admin → AI and enable features gradually behind flags, with budgets.
