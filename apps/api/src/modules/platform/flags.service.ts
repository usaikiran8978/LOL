import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { evaluatePredicate, predicate, type Facts } from '@amora/shared';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';

interface FlagRule {
  priority: number;
  rule_type: string;
  country_codes: string[] | null;
  percentage: number | null;
  segment_key: string | null;
  user_ids: string[] | null;
  platforms: string[] | null;
  min_app_version: string | null;
  value: boolean;
}
interface FlagDef {
  key: string;
  enabled: boolean;
  defaultValue: boolean;
  rules: FlagRule[];
}

const CACHE_MS = 30_000;

/** Stable 0..99 bucket per (flag, user) so percentage rollouts don't flicker between requests. */
export function rolloutBucket(flagKey: string, userId: string): number {
  return createHash('sha256').update(`${flagKey}:${userId}`).digest().readUInt32BE(0) % 100;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/**
 * Feature flags with global kill switch + ordered targeting rules (country / percentage / segment / user / platform /
 * app version). First matching rule wins, otherwise the flag's default. Definitions cached briefly per instance;
 * admin writes call `invalidate()`.
 */
@Injectable()
export class FlagsService {
  private cache: { at: number; flags: Map<string, FlagDef>; segments: Map<string, unknown> } | null = null;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  invalidate(): void {
    this.cache = null;
  }

  private async load() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    const [flags, rules, segments] = await Promise.all([
      this.db.selectFrom('feature_flags').select(['id', 'key', 'enabled', 'default_value']).execute(),
      this.db.selectFrom('feature_flag_rules').selectAll().orderBy('priority').execute(),
      this.db.selectFrom('user_segments').select(['key', 'definition']).execute(),
    ]);
    const map = new Map<string, FlagDef>();
    for (const f of flags) {
      map.set(f.key, { key: f.key, enabled: f.enabled, defaultValue: f.default_value, rules: rules.filter((r) => r.flag_id === f.id) as FlagRule[] });
    }
    this.cache = { at: Date.now(), flags: map, segments: new Map(segments.map((s) => [s.key, s.definition])) };
    return this.cache;
  }

  async isEnabled(key: string, facts: Facts & { userId?: string }): Promise<boolean> {
    const { flags, segments } = await this.load();
    const flag = flags.get(key);
    return flag ? this.evaluate(flag, facts, segments) : false;
  }

  async evaluateAll(facts: Facts & { userId?: string }): Promise<Record<string, boolean>> {
    const { flags, segments } = await this.load();
    return Object.fromEntries([...flags.values()].map((f) => [f.key, this.evaluate(f, facts, segments)]));
  }

  /** Throws FEATURE_DISABLED when off — use at the top of feature endpoints. */
  async assertEnabled(key: string, facts: Facts & { userId?: string }): Promise<void> {
    if (!(await this.isEnabled(key, facts))) throw new AppError('FEATURE_DISABLED', `Feature ${key} is not available`, { flag: key });
  }

  segmentMatches(definition: unknown, facts: Facts): boolean {
    const parsed = predicate.safeParse(definition);
    return parsed.success && evaluatePredicate(parsed.data, facts);
  }

  private evaluate(flag: FlagDef, facts: Facts & { userId?: string }, segments: Map<string, unknown>): boolean {
    if (!flag.enabled) return false;
    for (const r of flag.rules) {
      if (this.ruleMatches(flag.key, r, facts, segments)) return r.value;
    }
    return flag.defaultValue;
  }

  private ruleMatches(flagKey: string, r: FlagRule, facts: Facts & { userId?: string }, segments: Map<string, unknown>): boolean {
    switch (r.rule_type) {
      case 'country':
        return !!facts.countryCode && (r.country_codes ?? []).includes(String(facts.countryCode));
      case 'percentage':
        return !!facts.userId && r.percentage !== null && rolloutBucket(flagKey, facts.userId) < r.percentage;
      case 'segment': {
        const def = r.segment_key ? segments.get(r.segment_key) : undefined;
        return def !== undefined && this.segmentMatches(def, facts);
      }
      case 'user':
        return !!facts.userId && (r.user_ids ?? []).includes(facts.userId);
      case 'platform':
        return !!facts.platform && (r.platforms ?? []).includes(String(facts.platform));
      case 'app_version':
        return typeof facts.appVersion === 'string' && !!r.min_app_version && compareVersions(facts.appVersion, r.min_app_version) >= 0;
      default:
        return false;
    }
  }
}
