import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type Tx } from '../db/database';
import type { ClientContext } from '../http/request-context';

export interface AuditEntry {
  actorType: 'user' | 'admin' | 'system';
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  client?: ClientContext;
}

// Driver results (e.g. Kysely update counts) can contain BigInt; serialize them as strings instead of throwing.
const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

/** Writes append-only audit records. Pass the caller's transaction so the audit row commits atomically. */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(entry: AuditEntry, trx: Tx | Database = this.db): Promise<void> {
    await trx
      .insertInto('audit_logs')
      .values({
        actor_type: entry.actorType,
        actor_id: entry.actorId ?? null,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        before_state: entry.before === undefined ? null : toJson(entry.before),
        after_state: entry.after === undefined ? null : toJson(entry.after),
        reason: entry.reason ?? null,
        ip: entry.client?.ip ?? null,
        user_agent: entry.client?.userAgent ?? null,
        request_id: entry.client?.requestId ?? null,
      })
      .execute();
  }
}
