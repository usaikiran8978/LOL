import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { DATABASE, type Database, type Tx } from '../db/database';

export type OutboxHandler = (payload: Record<string, unknown>, meta: { id: string; aggregateId: string | null; attempts: number }) => Promise<void>;

export const OUTBOX_MAX_ATTEMPTS = 8;
const MAX_ATTEMPTS = OUTBOX_MAX_ATTEMPTS;

/**
 * Transactional outbox (architecture §5). Producers call `enqueue` inside their business transaction; the dispatcher
 * claims rows with FOR UPDATE SKIP LOCKED (safe with many API/worker instances), runs the registered handler and
 * retries with exponential backoff. Rows that exhaust retries stay undispatched with `last_error` (dead letters,
 * visible to ops) and are excluded by `available_at = 'infinity'`.
 */
@Injectable()
export class OutboxService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers = new Map<string, OutboxHandler[]>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  on(topic: string, handler: OutboxHandler): void {
    this.handlers.set(topic, [...(this.handlers.get(topic) ?? []), handler]);
  }

  async enqueue(trx: Tx | Database, topic: string, payload: Record<string, unknown>, opts: { aggregateId?: string; delaySeconds?: number } = {}): Promise<void> {
    await trx
      .insertInto('outbox_events')
      .values({
        topic,
        payload: JSON.stringify(payload),
        aggregate_id: opts.aggregateId ?? null,
        available_at: opts.delaySeconds ? new Date(Date.now() + opts.delaySeconds * 1000) : new Date(),
      })
      .execute();
  }

  onApplicationBootstrap(): void {
    if (!this.cfg.WORKERS_ENABLED) return;
    this.timer = setInterval(() => void this.tick(), this.cfg.OUTBOX_POLL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while ((await this.processPending(50)) > 0) { /* drain */ }
    } catch (err) {
      this.logger.error(`outbox tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Processes up to `limit` due events. Returns how many were claimed. Exposed for tests and manual drains. */
  async processPending(limit = 100): Promise<number> {
    const claimed = await this.db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom('outbox_events')
        .select(['id', 'topic', 'payload', 'aggregate_id', 'attempts'])
        .where('dispatched_at', 'is', null)
        .where('available_at', '<=', new Date())
        .orderBy('id')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute();
      for (const row of rows) {
        const handlers = this.handlers.get(row.topic) ?? [];
        try {
          for (const h of handlers) {
            await h(row.payload as Record<string, unknown>, { id: row.id, aggregateId: row.aggregate_id, attempts: row.attempts });
          }
          await trx.updateTable('outbox_events').set({ dispatched_at: new Date(), attempts: row.attempts + 1 }).where('id', '=', row.id).execute();
        } catch (err) {
          const attempts = row.attempts + 1;
          const message = (err as Error).message?.slice(0, 2000) ?? 'unknown';
          this.logger.warn(`outbox ${row.topic}#${row.id} attempt ${attempts} failed: ${message}`);
          await trx
            .updateTable('outbox_events')
            .set({
              attempts,
              last_error: message,
              available_at: attempts >= MAX_ATTEMPTS ? sql<Date>`'infinity'::timestamptz` : new Date(Date.now() + 2 ** attempts * 1000),
            })
            .where('id', '=', row.id)
            .execute();
        }
      }
      return rows.length;
    });
    return claimed;
  }
}
