import { z } from 'zod';
import { t } from '@/i18n';
import { RULE_KEY_RE, ruleUpsertSchema, type ModerationRule, type RuleScope, type RuleType } from '@/lib/api/modules/safety';
import { parseJsonText, validate, type FieldErrors, type ValidationResult } from '@/lib/forms/validate';

/** Signals a text rule may emit (RuleConfig in apps/api/src/modules/safety/text-moderation.ts). */
export const TEXT_SIGNALS = ['spam', 'scam', 'harassment', 'off_platform_payment', 'hate', 'violence', 'self_harm'] as const;
/** Scopes TextModerationService actually scans (`ModerationScope`). */
export const TEXT_SCOPES = ['message', 'profile_text', 'ai_output', 'event'] as const satisfies readonly RuleScope[];
/** Rule types edited on the rules page; auto-actions live on the thresholds page. */
export const EDITABLE_TYPES = ['keyword', 'regex', 'classifier_threshold', 'velocity', 'sla'] as const satisfies readonly RuleType[];
/** Rule types some service evaluates today; the others are stored but not read by any job. */
export const EVALUATED_TYPES: readonly RuleType[] = ['keyword', 'regex', 'auto_action'];

// Mirrors RuleConfig (text-moderation.ts) — not exported from @amora/shared.
const textBase = { action: z.enum(['warn', 'hide']), score: z.number().min(0).max(1), signal: z.enum(TEXT_SIGNALS) };
export const keywordConfig = z.object({ ...textBase, terms: z.array(z.string().trim().min(1).max(200)).min(1).max(1000) });
export const regexConfig = z.object({ ...textBase, pattern: z.string().min(1).max(1000), flags: z.string().regex(/^[dgimsuvy]*$/).max(8).optional() });

export interface RuleForm {
  key: string;
  ruleType: string;
  scope: string;
  locale: string;
  isActive: boolean;
  // keyword / regex
  terms: string;
  pattern: string;
  flags: string;
  action: string;
  score: number | undefined;
  signal: string;
  // other types
  configJson: string;
}

export const EMPTY_RULE: RuleForm = {
  key: '', ruleType: 'keyword', scope: 'message', locale: '', isActive: true, terms: '', pattern: '', flags: 'iu', action: 'warn', score: 0.5, signal: 'spam', configJson: '{}',
};

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

export function ruleToForm(r: ModerationRule): RuleForm {
  const c = r.config ?? {};
  return {
    key: r.key,
    ruleType: r.rule_type,
    scope: r.scope,
    locale: r.locale ?? '',
    isActive: r.is_active,
    terms: Array.isArray(c.terms) ? (c.terms as unknown[]).map(String).join('\n') : '',
    pattern: str(c.pattern),
    flags: str(c.flags, 'iu'),
    action: str(c.action, 'warn'),
    score: typeof c.score === 'number' ? c.score : undefined,
    signal: str(c.signal, 'spam'),
    configJson: JSON.stringify(c, null, 2),
  };
}

export type RuleBody = z.output<typeof ruleUpsertSchema>;

/** Validates the form into a rule key + `PUT rules/:key` body. Config errors are keyed `config.<field>`. */
export function validateRuleForm(f: RuleForm, isNew: boolean): ValidationResult<{ key: string; body: RuleBody }> {
  const errors: FieldErrors = {};
  if (isNew && !RULE_KEY_RE.test(f.key)) errors.key = t('safety.rules.keyInvalid');

  let config: unknown;
  if (f.ruleType === 'keyword' || f.ruleType === 'regex') {
    const raw = {
      action: f.action, score: f.score, signal: f.signal,
      ...(f.ruleType === 'keyword' ? { terms: f.terms.split('\n').map((x) => x.trim()).filter(Boolean) } : { pattern: f.pattern, flags: f.flags || undefined }),
    };
    const v = validate(f.ruleType === 'keyword' ? keywordConfig : regexConfig, raw);
    if (!v.ok) for (const [k, msg] of Object.entries(v.errors)) errors[`config.${k.split('.')[0]}`] ??= msg;
    else config = v.data;
    if (v.ok && f.ruleType === 'regex') {
      try {
        new RegExp(f.pattern, f.flags || 'iu');
      } catch {
        errors['config.pattern'] = t('safety.rules.regexInvalid');
      }
    }
  } else {
    const parsed = parseJsonText(f.configJson);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) errors.config = t('safety.rules.configObject');
    else config = parsed.value;
  }

  const v = validate(ruleUpsertSchema, { ruleType: f.ruleType, scope: f.scope, config: config ?? {}, locale: f.locale.trim() || null, isActive: f.isActive });
  if (!v.ok) for (const [k, msg] of Object.entries(v.errors)) errors[k] ??= msg;
  if (!v.ok || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: { key: f.key, body: v.data } };
}
