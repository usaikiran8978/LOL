import { adminMatchingConfigInput, type AdminMatchingConfigInput, type Predicate } from '@amora/shared';
import type { z } from 'zod';
import { t } from '@/i18n';
import type { MatchingConfigDetail } from '@/lib/api/modules/matching';
import type { FieldErrors } from '@/lib/forms/validate';
import type { Conversion } from '@/lib/predicate';

/*
 * Editor state for a matching config version ↔ the shared `adminMatchingConfigInput` contract.
 * Every enum and numeric bound comes from the shared zod schema so the console never drifts from the API.
 */

const shape = adminMatchingConfigInput.shape;

export type ConfigInput = z.input<typeof adminMatchingConfigInput>;
export const DIVERSITY_DIMENSIONS = shape.diversityDimensions.element.options;
export type DiversityDimension = (typeof DIVERSITY_DIMENSIONS)[number];
export const MISSING_ANSWER_POLICIES = shape.missingAnswerPolicy.options;
export type MissingAnswerPolicy = (typeof MISSING_ANSWER_POLICIES)[number];
export const RANKING_RULE_TYPES = shape.rankingRules.element.shape.ruleType.options;
export type RankingRuleType = (typeof RANKING_RULE_TYPES)[number];
/** Answer importance levels 0..3 (index into importanceMultipliers). */
export const IMPORTANCE_LEVELS = [0, 1, 2, 3] as const;

/** Plain numeric fields of the contract, grouped by editor section. */
export const SCALAR_FIELDS = [
  'minCompatibility', 'minConfidence', 'candidatePoolLimit', 'recommendationBatchSize', 'dailyCuratedCount', 'recommendationTtlHours', 'repeatSuppressionDays',
  'intentDefaultScore', 'behavioralWeight', 'diversityMaxShare', 'safetyExcludeThreshold', 'safetyDownrankThreshold', 'safetyDownrankFactor',
  'topFactorCount', 'differenceThreshold',
] as const;
export type ScalarField = (typeof SCALAR_FIELDS)[number];

export const SECTIONS: Record<'pool' | 'scoring' | 'diversity' | 'safety' | 'explanations', ScalarField[]> = {
  pool: ['minCompatibility', 'minConfidence', 'candidatePoolLimit', 'recommendationBatchSize', 'dailyCuratedCount', 'recommendationTtlHours', 'repeatSuppressionDays'],
  scoring: ['intentDefaultScore', 'behavioralWeight'],
  diversity: ['diversityMaxShare'],
  safety: ['safetyExcludeThreshold', 'safetyDownrankThreshold', 'safetyDownrankFactor'],
  explanations: ['topFactorCount', 'differenceThreshold'],
};

/** min/max/step for a numeric field, read from the shared schema. */
export function bounds(fieldName: ScalarField): { min?: number; max?: number; step: number | 'any' } {
  const s = shape[fieldName];
  return { min: s.minValue ?? undefined, max: s.maxValue ?? undefined, step: s.isInt ? 1 : 'any' };
}

export interface RuleForm {
  id: string;
  key: string;
  ruleType: RankingRuleType;
  value: number | undefined;
  isActive: boolean;
  /** Condition the builder was opened with; `condition` is the builder's latest conversion (null until it reports). */
  initialCondition: Predicate | null;
  condition: Conversion | null;
}

export interface IntentCell {
  score: number | undefined;
  hardExclusion: boolean;
}

export interface ConfigForm {
  scalars: Record<ScalarField, number | undefined>;
  diversityDimensions: DiversityDimension[];
  missingAnswerPolicy: MissingAnswerPolicy;
  importanceMultipliers: [number | undefined, number | undefined, number | undefined, number | undefined];
  defaultImportance: number | undefined;
  notes: string;
  /** compatibility category key → weight (undefined = not weighted in this version). */
  weights: Record<string, number | undefined>;
  rankingRules: RuleForm[];
  /** Matrix axis: intent keys (from the config content, the taxonomy when readable, or added by the admin). */
  intents: string[];
  /** Canonical pair key (see pairKey) → cell; missing = intent default score applies. */
  intentCells: Record<string, IntentCell>;
}

let ruleSeq = 0;
export const newRule = (r?: Partial<Omit<RuleForm, 'id'>>): RuleForm => ({
  id: `rule${++ruleSeq}`, key: '', ruleType: 'boost', value: 0, isActive: true, initialCondition: null, condition: null, ...r,
});

/** Order-independent key for a symmetric intent pair. */
export function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

const num = (v: number | string | null | undefined): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};

/** Server detail → contract input (mirrors MatchingAdminService.toInput); used for diffs and the JSON view. */
export function detailToInput(d: MatchingConfigDetail): AdminMatchingConfigInput {
  const mult = d.importance_multipliers.map(Number);
  return {
    minCompatibility: Number(d.min_compatibility), candidatePoolLimit: d.candidate_pool_limit, recommendationBatchSize: d.recommendation_batch_size,
    dailyCuratedCount: d.daily_curated_count, behavioralWeight: Number(d.behavioral_weight), diversityMaxShare: Number(d.diversity_max_share),
    diversityDimensions: d.diversity_dimensions as AdminMatchingConfigInput['diversityDimensions'], repeatSuppressionDays: d.repeat_suppression_days,
    safetyExcludeThreshold: Number(d.safety_exclude_threshold), safetyDownrankThreshold: Number(d.safety_downrank_threshold), safetyDownrankFactor: Number(d.safety_downrank_factor),
    missingAnswerPolicy: d.missing_answer_policy as MissingAnswerPolicy, importanceMultipliers: [mult[0] ?? 0, mult[1] ?? 0, mult[2] ?? 0, mult[3] ?? 0],
    defaultImportance: d.default_importance, intentDefaultScore: Number(d.intent_default_score), minConfidence: Number(d.min_confidence),
    topFactorCount: d.top_factor_count, differenceThreshold: Number(d.difference_threshold), recommendationTtlHours: d.recommendation_ttl_hours,
    ...(d.notes ? { notes: d.notes } : {}),
    weights: d.weights,
    rankingRules: d.rankingRules.map((r) => ({ key: r.key, ruleType: r.ruleType, condition: r.condition, value: Number(r.value), isActive: r.isActive })),
    intentMatrix: dedupeMatrix(d.intentMatrix),
  };
}

/** The API stores both directions of every pair; keep one canonical entry per pair (sorted for stable diffs). */
export function dedupeMatrix(cells: ReadonlyArray<{ a: string; b: string; score: number | string; hardExclusion: boolean }>): AdminMatchingConfigInput['intentMatrix'] {
  const seen = new Map<string, { a: string; b: string; score: number; hardExclusion: boolean }>();
  for (const c of cells) {
    const [a, b] = c.a <= c.b ? [c.a, c.b] : [c.b, c.a];
    const k = pairKey(a, b);
    if (!seen.has(k)) seen.set(k, { a, b, score: Number(c.score), hardExclusion: c.hardExclusion });
  }
  return [...seen.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([, v]) => v);
}

/** Contract input (server detail, pasted JSON) → editor state. `extraIntents` extends the matrix axis. */
export function inputToForm(i: ConfigInput, extraIntents: readonly string[] = []): ConfigForm {
  const scalars = Object.fromEntries(SCALAR_FIELDS.map((f) => [f, num(i[f] as number | undefined)])) as Record<ScalarField, number | undefined>;
  const cells: Record<string, IntentCell> = {};
  const intents = new Set<string>(extraIntents);
  for (const m of i.intentMatrix) {
    intents.add(m.a);
    intents.add(m.b);
    cells[pairKey(m.a, m.b)] = { score: num(m.score), hardExclusion: m.hardExclusion ?? false };
  }
  const mult = i.importanceMultipliers;
  return {
    scalars,
    diversityDimensions: [...i.diversityDimensions],
    missingAnswerPolicy: i.missingAnswerPolicy,
    importanceMultipliers: [num(mult[0]), num(mult[1]), num(mult[2]), num(mult[3])],
    defaultImportance: num(i.defaultImportance),
    notes: i.notes ?? '',
    weights: { ...i.weights },
    rankingRules: i.rankingRules.map((r) => newRule({ key: r.key, ruleType: r.ruleType, value: num(r.value), isActive: r.isActive ?? true, initialCondition: r.condition as Predicate })),
    intents: [...intents].sort(),
    intentCells: cells,
  };
}

export const detailToForm = (d: MatchingConfigDetail, extraIntents: readonly string[] = []) => inputToForm(detailToInput(d), extraIntents);

/**
 * Editor state → payload for `submit(adminMatchingConfigInput, …)`. Returns extra field errors for things the
 * schema cannot see (invalid predicate builders, duplicate rule keys the API rejects).
 */
export function formToPayload(f: ConfigForm): { payload: Record<string, unknown>; errors: FieldErrors; matrixKeys: string[] } {
  const errors: FieldErrors = {};
  const seen = new Set<string>();
  const rankingRules = f.rankingRules.map((r, i) => {
    const conv = r.condition;
    let condition: unknown = r.initialCondition ?? undefined;
    if (conv) {
      if (conv.ok) condition = conv.value;
      else errors[`rankingRules.${i}.condition`] = t('matching.editor.rules.conditionInvalid');
    }
    const key = r.key.trim();
    if (key && seen.has(key)) errors[`rankingRules.${i}.key`] = t('validation.duplicate', { value: key });
    seen.add(key);
    return { key, ruleType: r.ruleType, condition, value: r.value, isActive: r.isActive };
  });
  const weights: Record<string, number> = {};
  for (const [k, v] of Object.entries(f.weights)) if (v !== undefined) weights[k] = v;
  const matrixKeys: string[] = [];
  const intentMatrix: Array<{ a: string; b: string; score: number | undefined; hardExclusion: boolean }> = [];
  for (const [k, cell] of Object.entries(f.intentCells).sort(([x], [y]) => x.localeCompare(y))) {
    const [a, b] = k.split('|') as [string, string];
    if (!f.intents.includes(a) || !f.intents.includes(b)) continue;
    // A pair with neither a score nor a hard exclusion is "not configured": the default score applies.
    if (cell.score === undefined && !cell.hardExclusion) continue;
    // A hard exclusion never matches, so its score is irrelevant to the engine; 0 keeps the contract satisfied.
    intentMatrix.push({ a, b, score: cell.score ?? (cell.hardExclusion ? 0 : undefined), hardExclusion: cell.hardExclusion });
    matrixKeys.push(k);
  }
  const notes = f.notes.trim();
  return {
    payload: {
      ...f.scalars,
      diversityDimensions: f.diversityDimensions,
      missingAnswerPolicy: f.missingAnswerPolicy,
      importanceMultipliers: f.importanceMultipliers,
      defaultImportance: f.defaultImportance,
      ...(notes ? { notes } : {}),
      weights,
      rankingRules,
      intentMatrix,
    },
    errors,
    matrixKeys,
  };
}

/** Sum of the configured category weights (the API requires 1 ± 0.001 at publish). */
export function weightSum(weights: Record<string, number | undefined>): number {
  return Object.values(weights).reduce<number>((s, w) => s + (w ?? 0), 0);
}

export const WEIGHT_TOLERANCE = 0.001;
