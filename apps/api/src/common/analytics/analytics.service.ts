import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AnalyticsEventName } from '@amora/shared';
import { DATABASE, type Database, type Tx } from '../db/database';

export interface TrackOptions {
  userId?: string | null;
  platform?: 'ios' | 'android' | 'web' | 'admin' | 'server';
  appVersion?: string;
  countryCode?: string | null;
  properties?: Record<string, string | number | boolean | null>;
}

/**
 * Server-side analytics (TECH §19). Properties must never contain PII or sensitive attributes (DEC-007):
 * callers pass ids/enums/counts only.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async track(name: AnalyticsEventName, opts: TrackOptions = {}, trx?: Tx): Promise<void> {
    const write = (trx ?? this.db)
      .insertInto('analytics_events')
      .values({
        name,
        user_id: opts.userId ?? null,
        platform: opts.platform ?? 'server',
        app_version: opts.appVersion ?? null,
        country_code: opts.countryCode ?? null,
        properties: JSON.stringify(opts.properties ?? {}),
      })
      .execute();
    if (trx) {
      await write;
      return;
    }
    // Outside a transaction analytics is best-effort and must never fail the user request.
    await write.catch((err: Error) => this.logger.warn(`analytics write failed for ${name}: ${err.message}`));
  }
}
