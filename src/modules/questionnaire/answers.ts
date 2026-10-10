import type { AnswerType, AnswerValue } from '@amora/shared';

export interface OptionDef {
  id: string;
  key: string;
  numericValue: number | null;
  isExclusive: boolean;
}

export interface VersionDef {
  id: string;
  questionId: string;
  answerType: AnswerType;
  options: OptionDef[];
  minSelections: number | null;
  maxSelections: number | null;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleStep: number | null;
  numericMin: number | null;
  numericMax: number | null;
  textMaxLength: number | null;
  allowImportance: boolean;
  allowDealbreaker: boolean;
  allowSkip: boolean;
  isRequired: boolean;
}

/** Canonical answer representation used by conditions and the compatibility engine. */
export type Normalized =
  | { t: 'choice'; keys: string[]; acceptable?: string[] }
  | { t: 'scale'; value: number; ratio: number }
  | { t: 'range'; min: number; max: number }
  | { t: 'ranking'; keys: string[] }
  | { t: 'text' };

export class AnswerValidationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export interface NormalizedAnswer {
  normalized: Normalized;
  selected: Array<{ optionId: string; rank: number | null }>;
  acceptable: string[]; // option ids
}

const fail = (reason: string): never => {
  throw new AnswerValidationError(reason);
};

function keysToOptions(def: VersionDef, keys: string[]): OptionDef[] {
  if (new Set(keys).size !== keys.length) fail('duplicate_option');
  return keys.map((k) => def.options.find((o) => o.key === k) ?? fail(`unknown_option:${k}`));
}

/**
 * Validates a raw answer against the exact question version it was given for and returns its canonical form.
 * Pure — no I/O — so it is shared by the API, carry-over migration and tests.
 */
export function normalizeAnswer(def: VersionDef, value: AnswerValue, acceptableKeys?: string[]): NormalizedAnswer {
  const acceptable = acceptableKeys?.length ? keysToOptions(def, acceptableKeys) : [];
  const choiceTypes: AnswerType[] = ['single_choice', 'multiple_choice', 'yes_no', 'structured_preference'];
  if (acceptable.length && !choiceTypes.includes(def.answerType)) fail('acceptable_not_supported');

  switch (def.answerType) {
    case 'single_choice':
    case 'yes_no': {
      if (!('optionKey' in value)) return fail('expected_optionKey');
      const [o] = keysToOptions(def, [value.optionKey]);
      return { normalized: { t: 'choice', keys: [o!.key], ...(acceptable.length ? { acceptable: acceptable.map((a) => a.key).sort() } : {}) }, selected: [{ optionId: o!.id, rank: null }], acceptable: acceptable.map((a) => a.id) };
    }
    case 'multiple_choice':
    case 'structured_preference': {
      if (!('optionKeys' in value)) return fail('expected_optionKeys');
      const opts = keysToOptions(def, value.optionKeys);
      const min = def.minSelections ?? 1;
      const max = def.maxSelections ?? def.options.length;
      if (opts.length < min || opts.length > max) fail('selection_count');
      if (opts.length > 1 && opts.some((o) => o.isExclusive)) fail('exclusive_option_combined');
      let acc = acceptable;
      if (def.answerType === 'structured_preference') {
        if (!('acceptableOptionKeys' in value)) return fail('expected_acceptableOptionKeys');
        acc = keysToOptions(def, value.acceptableOptionKeys);
      }
      return {
        normalized: { t: 'choice', keys: opts.map((o) => o.key).sort(), ...(acc.length ? { acceptable: acc.map((a) => a.key).sort() } : {}) },
        selected: opts.map((o) => ({ optionId: o.id, rank: null })),
        acceptable: acc.map((a) => a.id),
      };
    }
    case 'scale': {
      if (!('value' in value)) return fail('expected_value');
      const min = def.scaleMin ?? fail('scale_not_configured');
      const max = def.scaleMax ?? fail('scale_not_configured');
      const step = def.scaleStep ?? 1;
      if (value.value < min || value.value > max || (value.value - min) % step !== 0) fail('scale_out_of_range');
      return { normalized: { t: 'scale', value: value.value, ratio: (value.value - min) / (max - min) }, selected: [], acceptable: [] };
    }
    case 'numeric_range': {
      if (!('min' in value)) return fail('expected_range');
      if (value.min > value.max) fail('range_inverted');
      if ((def.numericMin !== null && value.min < def.numericMin) || (def.numericMax !== null && value.max > def.numericMax)) fail('range_out_of_bounds');
      return { normalized: { t: 'range', min: value.min, max: value.max }, selected: [], acceptable: [] };
    }
    case 'ranking': {
      if (!('rankedOptionKeys' in value)) return fail('expected_rankedOptionKeys');
      const opts = keysToOptions(def, value.rankedOptionKeys);
      const need = def.maxSelections ?? def.options.length;
      if (opts.length < Math.min(def.minSelections ?? need, need) || opts.length > need) fail('ranking_count');
      return { normalized: { t: 'ranking', keys: opts.map((o) => o.key) }, selected: opts.map((o, i) => ({ optionId: o.id, rank: i + 1 })), acceptable: [] };
    }
    case 'text': {
      if (!('text' in value)) return fail('expected_text');
      if (def.textMaxLength && value.text.length > def.textMaxLength) fail('text_too_long');
      return { normalized: { t: 'text' }, selected: [], acceptable: [] };
    }
  }
}

export interface ConditionDef {
  groupNo: number;
  dependsOnQuestionId: string;
  operator: 'answered' | 'not_answered' | 'includes_any' | 'includes_all' | 'excludes' | 'eq' | 'gte' | 'lte' | 'between';
  optionKeys: string[] | null;
  numberA: number | null;
  numberB: number | null;
}

function numberOf(n: Normalized | undefined): number | null {
  if (!n) return null;
  if (n.t === 'scale') return n.value;
  if (n.t === 'range') return n.min;
  return null;
}

/** Conditions within a group are ANDed; groups are ORed. No conditions = always shown. */
export function conditionsMet(conditions: ConditionDef[], answers: Map<string, Normalized>): boolean {
  if (conditions.length === 0) return true;
  const groups = new Map<number, ConditionDef[]>();
  for (const c of conditions) groups.set(c.groupNo, [...(groups.get(c.groupNo) ?? []), c]);
  return [...groups.values()].some((group) =>
    group.every((c) => {
      const a = answers.get(c.dependsOnQuestionId);
      const keys = a && (a.t === 'choice' || a.t === 'ranking') ? a.keys : [];
      const want = c.optionKeys ?? [];
      const n = numberOf(a);
      switch (c.operator) {
        case 'answered': return !!a;
        case 'not_answered': return !a;
        case 'includes_any': return want.some((k) => keys.includes(k));
        case 'includes_all': return want.every((k) => keys.includes(k));
        case 'excludes': return !!a && !want.some((k) => keys.includes(k));
        case 'eq': return n !== null && n === c.numberA;
        case 'gte': return n !== null && c.numberA !== null && n >= c.numberA;
        case 'lte': return n !== null && c.numberA !== null && n <= c.numberA;
        case 'between': return n !== null && c.numberA !== null && c.numberB !== null && n >= c.numberA && n <= c.numberB;
      }
    }),
  );
}

/** Detects cycles in "question A depends on question B" edges. */
export function hasDependencyCycle(edges: Array<[from: string, to: string]>): boolean {
  const graph = new Map<string, string[]>();
  for (const [a, b] of edges) graph.set(a, [...(graph.get(a) ?? []), b]);
  const state = new Map<string, 1 | 2>();
  const visit = (n: string): boolean => {
    if (state.get(n) === 1) return true;
    if (state.get(n) === 2) return false;
    state.set(n, 1);
    for (const m of graph.get(n) ?? []) if (visit(m)) return true;
    state.set(n, 2);
    return false;
  };
  return [...graph.keys()].some(visit);
}
