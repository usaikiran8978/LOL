import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database } from '../../common/db/database';

export type ModerationScope = 'message' | 'profile_text' | 'ai_output' | 'event';
export type ModerationAction = 'allow' | 'warn' | 'hide';

interface RuleConfig {
  terms?: string[];       // keyword rules: case-insensitive whole-phrase match
  pattern?: string;       // regex rules
  flags?: string;
  action: 'warn' | 'hide';
  score: number;          // 0..1 contribution
  signal: 'spam' | 'scam' | 'harassment' | 'off_platform_payment' | 'hate' | 'violence' | 'self_harm';
}

export interface ScanResult {
  action: ModerationAction;
  score: number;
  signals: string[];
  matchedRules: string[];
}

const CACHE_MS = 30_000;

/** Pure evaluation (unit-tested): highest action wins, scores combine as 1 - Π(1 - s). */
export function scanText(text: string, rules: Array<{ key: string; config: RuleConfig }>): ScanResult {
  const normalized = text.normalize('NFKC').toLowerCase();
  let keep = 1;
  let action: ModerationAction = 'allow';
  const signals = new Set<string>();
  const matched: string[] = [];
  for (const r of rules) {
    const c = r.config;
    let hit = false;
    if (c.terms?.length) hit = c.terms.some((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(normalized));
    if (!hit && c.pattern) {
      try {
        hit = new RegExp(c.pattern, c.flags ?? 'iu').test(text);
      } catch {
        hit = false; // invalid admin regex never blocks messages
      }
    }
    if (!hit) continue;
    matched.push(r.key);
    signals.add(c.signal);
    keep *= 1 - Math.max(0, Math.min(1, c.score));
    if (c.action === 'hide') action = 'hide';
    else if (action === 'allow') action = 'warn';
  }
  return { action, score: Math.round((1 - keep) * 1000) / 1000, signals: [...signals], matchedRules: matched };
}

/** Loads admin-managed `moderation_rules` (keyword/regex) and scans text for a scope. */
@Injectable()
export class TextModerationService {
  private cache: { at: number; rules: Map<string, Array<{ key: string; config: RuleConfig }>> } | null = null;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  invalidate(): void {
    this.cache = null;
  }

  async scan(scope: ModerationScope, text: string): Promise<ScanResult> {
    if (!this.cache || Date.now() - this.cache.at > CACHE_MS) {
      const rows = await this.db.selectFrom('moderation_rules').select(['key', 'scope', 'config']).where('is_active', '=', true).where('rule_type', 'in', ['keyword', 'regex']).execute();
      const rules = new Map<string, Array<{ key: string; config: RuleConfig }>>();
      for (const r of rows) rules.set(r.scope, [...(rules.get(r.scope) ?? []), { key: r.key, config: r.config as unknown as RuleConfig }]);
      this.cache = { at: Date.now(), rules };
    }
    return scanText(text, this.cache.rules.get(scope) ?? []);
  }
}
