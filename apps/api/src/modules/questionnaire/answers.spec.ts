import { conditionsMet, hasDependencyCycle, normalizeAnswer, AnswerValidationError, type VersionDef } from './answers';

const opt = (key: string, numericValue: number | null = null, isExclusive = false) => ({ id: `id-${key}`, key, numericValue, isExclusive });
const base: Omit<VersionDef, 'answerType' | 'options'> = {
  id: 'v', questionId: 'q', minSelections: null, maxSelections: null, scaleMin: null, scaleMax: null, scaleStep: null,
  numericMin: null, numericMax: null, textMaxLength: null, allowImportance: true, allowDealbreaker: true, allowSkip: true, isRequired: false,
};
const reason = (fn: () => unknown) => {
  try { fn(); } catch (e) { return (e as AnswerValidationError).reason; }
  return 'no error';
};

describe('normalizeAnswer', () => {
  const single: VersionDef = { ...base, answerType: 'single_choice', options: [opt('want'), opt('dont_want'), opt('open')] };

  it('normalizes single choice with acceptable partner answers', () => {
    const r = normalizeAnswer(single, { optionKey: 'want' }, ['want', 'open']);
    expect(r.normalized).toEqual({ t: 'choice', keys: ['want'], acceptable: ['open', 'want'] });
    expect(r.selected).toEqual([{ optionId: 'id-want', rank: null }]);
    expect(r.acceptable).toEqual(['id-want', 'id-open']);
  });

  it('rejects unknown options and wrong shapes', () => {
    expect(reason(() => normalizeAnswer(single, { optionKey: 'maybe' }))).toBe('unknown_option:maybe');
    expect(reason(() => normalizeAnswer(single, { value: 3 }))).toBe('expected_optionKey');
  });

  it('enforces selection counts and exclusive options', () => {
    const multi: VersionDef = { ...base, answerType: 'multiple_choice', maxSelections: 2, options: [opt('a'), opt('b'), opt('c'), opt('none', null, true)] };
    expect(normalizeAnswer(multi, { optionKeys: ['b', 'a'] }).normalized).toEqual({ t: 'choice', keys: ['a', 'b'] });
    expect(reason(() => normalizeAnswer(multi, { optionKeys: ['a', 'b', 'c'] }))).toBe('selection_count');
    expect(reason(() => normalizeAnswer(multi, { optionKeys: ['a', 'none'] }))).toBe('exclusive_option_combined');
  });

  it('normalizes scales to a 0..1 ratio and validates steps', () => {
    const scale: VersionDef = { ...base, answerType: 'scale', scaleMin: 1, scaleMax: 5, scaleStep: 1, options: [] };
    expect(normalizeAnswer(scale, { value: 4 }).normalized).toEqual({ t: 'scale', value: 4, ratio: 0.75 });
    expect(reason(() => normalizeAnswer(scale, { value: 6 }))).toBe('scale_out_of_range');
  });

  it('validates numeric ranges, rankings, structured preferences and text', () => {
    const range: VersionDef = { ...base, answerType: 'numeric_range', numericMin: 0, numericMax: 10, options: [] };
    expect(reason(() => normalizeAnswer(range, { min: 5, max: 2 }))).toBe('range_inverted');
    const rank: VersionDef = { ...base, answerType: 'ranking', options: [opt('x'), opt('y'), opt('z')] };
    expect(normalizeAnswer(rank, { rankedOptionKeys: ['z', 'x', 'y'] }).selected.map((s) => s.rank)).toEqual([1, 2, 3]);
    expect(reason(() => normalizeAnswer(rank, { rankedOptionKeys: ['z'] }))).toBe('ranking_count');
    const sp: VersionDef = { ...base, answerType: 'structured_preference', options: [opt('a'), opt('b')] };
    expect(normalizeAnswer(sp, { optionKeys: ['a'], acceptableOptionKeys: ['a', 'b'] }).normalized).toEqual({ t: 'choice', keys: ['a'], acceptable: ['a', 'b'] });
    const text: VersionDef = { ...base, answerType: 'text', textMaxLength: 5, options: [] };
    expect(reason(() => normalizeAnswer(text, { text: 'too long text' }))).toBe('text_too_long');
  });
});

describe('conditionsMet', () => {
  const answers = new Map([['q1', { t: 'choice' as const, keys: ['yes'] }], ['q2', { t: 'scale' as const, value: 4, ratio: 0.75 }]]);
  it('ANDs within a group and ORs across groups', () => {
    expect(conditionsMet([{ groupNo: 0, dependsOnQuestionId: 'q1', operator: 'includes_any', optionKeys: ['yes'], numberA: null, numberB: null }, { groupNo: 0, dependsOnQuestionId: 'q2', operator: 'gte', optionKeys: null, numberA: 5, numberB: null }], answers)).toBe(false);
    expect(conditionsMet([
      { groupNo: 0, dependsOnQuestionId: 'q2', operator: 'gte', optionKeys: null, numberA: 5, numberB: null },
      { groupNo: 1, dependsOnQuestionId: 'q3', operator: 'not_answered', optionKeys: null, numberA: null, numberB: null },
    ], answers)).toBe(true);
  });
});

describe('hasDependencyCycle', () => {
  it('detects cycles', () => {
    expect(hasDependencyCycle([['a', 'b'], ['b', 'c']])).toBe(false);
    expect(hasDependencyCycle([['a', 'b'], ['b', 'c'], ['c', 'a']])).toBe(true);
  });
});

describe('answerValue contract', () => {
  it('keeps acceptableOptionKeys for structured_preference answers (union order)', async () => {
    const { answerValue } = await import('@amora/shared');
    expect(answerValue.parse({ optionKeys: ['a'], acceptableOptionKeys: ['b', 'c'] })).toEqual({ optionKeys: ['a'], acceptableOptionKeys: ['b', 'c'] });
    expect(answerValue.parse({ optionKeys: ['a'] })).toEqual({ optionKeys: ['a'] });
  });
});
