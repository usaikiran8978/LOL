import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';

export interface Allowance {
  unlimited: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  period: 'day' | 'week' | 'month' | null;
  resetsAt: string | null;
}

function periodStart(period: 'day' | 'week' | 'month', now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (period === 'month') d.setUTCDate(1);
  return d;
}
function periodEnd(period: 'day' | 'week' | 'month', start: Date): Date {
  const d = new Date(start);
  if (period === 'day') d.setUTCDate(d.getUTCDate() + 1);
  if (period === 'week') d.setUTCDate(d.getUTCDate() + 7);
  if (period === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/**
 * Server-side entitlement checks (MP §23 "never rely on client-side payment status"). Grants live in `entitlements`
 * (written only by billing webhooks/receipts, admin grants, promotions). Metered features fall back to
 * `free_tier_limits` and are counted in `usage_counters`.
 */
@Injectable()
export class EntitlementsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async active(userId: string): Promise<Array<{ key: string; limit: number | null; period: string | null; endsAt: string | null }>> {
    const rows = await this.db
      .selectFrom('entitlements')
      .select(['entitlement_key', 'limit_value', 'limit_period', 'ends_at'])
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .where('starts_at', '<=', new Date())
      .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', new Date())]))
      .execute();
    return rows.map((r) => ({ key: r.entitlement_key, limit: r.limit_value, period: r.limit_period, endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null }));
  }

  async has(userId: string, key: string): Promise<boolean> {
    return (await this.active(userId)).some((e) => e.key === key);
  }

  async require(userId: string, key: string): Promise<void> {
    if (!(await this.has(userId, key))) throw new AppError('ENTITLEMENT_REQUIRED', undefined, { entitlement: key });
  }

  /** Allowance for a metered key (e.g. 'likes'): paid grant (most generous wins) or the free-tier limit. */
  async allowance(userId: string, key: string, countryCode: string | null = null): Promise<Allowance> {
    const grants = (await this.active(userId)).filter((e) => e.key === key);
    let limit: number | null;
    let period: 'day' | 'week' | 'month' | null;
    if (grants.length) {
      if (grants.some((g) => g.limit === null)) return { unlimited: true, limit: null, used: 0, remaining: null, period: null, resetsAt: null };
      const best = grants.reduce((a, b) => ((b.limit ?? 0) > (a.limit ?? 0) ? b : a));
      limit = best.limit;
      period = (best.period as 'day' | 'week' | 'month' | null) ?? 'day';
    } else {
      const free = await this.db.selectFrom('free_tier_limits').selectAll().where('entitlement_key', '=', key).executeTakeFirst();
      if (!free) return { unlimited: false, limit: 0, used: 0, remaining: 0, period: null, resetsAt: null };
      const override = countryCode ? (free.country_overrides as Record<string, number | null>)[countryCode] : undefined;
      limit = override !== undefined ? override : free.limit_value;
      period = (free.limit_period as 'day' | 'week' | 'month' | null) ?? 'day';
      if (limit === null) return { unlimited: true, limit: null, used: 0, remaining: null, period: null, resetsAt: null };
    }
    const start = periodStart(period!);
    const used = await this.db.selectFrom('usage_counters').select('count').where('user_id', '=', userId).where('counter_key', '=', key).where('period_start', '=', start).executeTakeFirst();
    const u = used?.count ?? 0;
    return { unlimited: false, limit, used: u, remaining: Math.max(0, (limit ?? 0) - u), period, resetsAt: periodEnd(period!, start).toISOString() };
  }

  /** Atomically consumes one unit; throws LIMIT_REACHED when exhausted. Call inside the action's transaction. */
  async consume(trx: Tx, userId: string, key: string, countryCode: string | null = null): Promise<Allowance> {
    const a = await this.allowance(userId, key, countryCode);
    if (a.unlimited) return a;
    if (!a.period || (a.remaining ?? 0) <= 0) throw new AppError('LIMIT_REACHED', undefined, { key, resetsAt: a.resetsAt });
    const start = periodStart(a.period);
    const row = await trx
      .insertInto('usage_counters')
      .values({ user_id: userId, counter_key: key, period_start: start, count: 1 })
      .onConflict((oc) => oc.columns(['user_id', 'counter_key', 'period_start']).doUpdateSet({ count: sql`usage_counters.count + 1` }))
      .returning('count')
      .executeTakeFirstOrThrow();
    if (row.count > (a.limit ?? 0)) throw new AppError('LIMIT_REACHED', undefined, { key, resetsAt: a.resetsAt });
    return { ...a, used: row.count, remaining: Math.max(0, (a.limit ?? 0) - row.count) };
  }

  /** Reverses a consumption (e.g. rewind). */
  async refund(trx: Tx, userId: string, key: string, period: 'day' | 'week' | 'month' = 'day'): Promise<void> {
    await trx
      .updateTable('usage_counters')
      .set({ count: sql`GREATEST(count - 1, 0)` })
      .where('user_id', '=', userId)
      .where('counter_key', '=', key)
      .where('period_start', '=', periodStart(period))
      .execute();
  }
}
