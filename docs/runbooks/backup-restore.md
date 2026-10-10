# Backup, restore & disaster recovery

| Target | Proposed objective |
|---|---|
| RPO (data loss) | ≤ 5 minutes |
| RTO (time to restore service) | ≤ 1 hour (same region), ≤ 4 hours (region loss) |

These are proposals for the operations owner to confirm; the BRD sets no numbers.

## What is backed up
| Store | Mechanism | Retention |
|---|---|---|
| PostgreSQL (source of truth) | Managed PITR (continuous WAL archiving) + daily snapshot; cross-region snapshot copy | PITR 14 days; daily 35 days; monthly 12 months |
| Object storage (media, verification evidence, exports) | Bucket versioning + cross-region replication; lifecycle deletes `exports/` after 7 days | Versions 30 days |
| Redis | **Not backed up** — it holds only rate-limit counters, presence and pub/sub (rebuildable) | — |
| OpenSearch | **Not backed up** — rebuilt from Postgres by the reindex job | — |
| Secrets | Secret manager with version history | Per provider |

Backups must be encrypted at rest with a key separate from production credentials, and deletions of backups require a
second approver (protects against ransomware / compromised admin).

## Privacy interaction
Deleted accounts are purged from the live database (`PrivacyService.purge`), but they remain in backups until those
backups expire (≤ 35 days daily / 12 months monthly). The privacy policy must state this. **After any restore**, re-run
the purge for accounts deleted after the backup point:
```sql
-- users whose deletion completed after the restore point must be purged again
SELECT user_id FROM data_privacy_requests WHERE kind = 'delete' AND status = 'completed' AND completed_at > '<restore point>';
```
The list comes from the **current** (pre-restore) database or the audit export, so keep a copy before you restore.

## Restore procedure (Postgres)
1. Declare an incident (SEV1). Put the API in maintenance: scale `amora-api` to 0 (mobile apps show the
   connectivity/error state).
2. Restore to a **new** instance at the chosen point in time (never overwrite the damaged one; it is evidence).
3. Verify: `SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1;` matches the deployed release; row counts on
   `users`, `matches`, `messages` are plausible; `SELECT max(created_at) FROM audit_logs;` is near the restore point.
4. Point `DATABASE_URL` in `amora-api-env` to the new instance; scale the API back up; run the k6 smoke test.
5. Re-run privacy purges (above). Reconcile payments: replay provider webhooks for the gap window (Stripe dashboard
   → Events → resend; Apple/Google: subscription status is re-fetched on next app launch).
6. Trigger an OpenSearch reindex if search is enabled.

## Drills
Run a restore drill **quarterly** into an isolated environment, timing each step against the RTO, and record results
here. A backup that has never been restored doesn't count as a backup.

| Date | Type | Restore point | Duration | Issues |
|---|---|---|---|---|
| _not yet run_ | | | | |
