import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database } from '../../common/db/database';

const CACHE_MS = 30_000;

/** Typed access to admin-managed `system_settings`. Keys prefixed `public.` are exposed to clients via /v1/config. */
@Injectable()
export class SettingsService {
  private cache: { at: number; values: Map<string, unknown> } | null = null;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  invalidate(): void {
    this.cache = null;
  }

  private async all(): Promise<Map<string, unknown>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.values;
    const rows = await this.db.selectFrom('system_settings').select(['key', 'value']).where('is_secret', '=', false).execute();
    this.cache = { at: Date.now(), values: new Map(rows.map((r) => [r.key, r.value])) };
    return this.cache.values;
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    const v = (await this.all()).get(key);
    return v === undefined ? fallback : (v as T);
  }

  async publicSettings(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of await this.all()) if (k.startsWith('public.')) out[k.slice(7)] = v;
    // Limits the app needs to explain requirements up front (values stay admin-managed).
    for (const k of ['onboarding.min_photos', 'onboarding.min_interests', 'profile.min_approved_photos']) {
      const v = (await this.all()).get(k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
}
