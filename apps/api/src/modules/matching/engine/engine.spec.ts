import { compatibility, questionScore, type EngineConfig, type QuestionDef, type UserFeatures } from './compatibility';
import { behaviorScore, rank, type CandidateSignals, type RankingConfig } from './ranking';

const cats = [
  { id: 'c-intent', key: 'relationship_intent', weight: 0.25, attributeKinds: [], usesIntent: true, usesInterests: false, usesLocation: false, inOverall: true },
  { id: 'c-values', key: 'values', weight: 0.2, attributeKinds: ['religion_importance'], usesIntent: false, usesInterests: false, usesLocation: false, inOverall: true },
  { id: 'c-lifestyle', key: 'lifestyle', weight: 0.15, attributeKinds: ['lifestyle_drinking'], usesIntent: false, usesInterests: false, usesLocation: false, inOverall: true },
  { id: 'c-interests', key: 'interests', weight: 0.1, attributeKinds: [], usesIntent: false, usesInterests: true, usesLocation: false, inOverall: true },
  { id: 'c-location', key: 'location', weight: 0.05, attributeKinds: [], usesIntent: false, usesInterests: false, usesLocation: true, inOverall: true },
];
const kids: QuestionDef = { questionId: 'q-kids', key: 'wants_children', versionId: 'v2', categoryId: 'c-values', weight: 2, isScored: true, optionValues: { want: null, dont_want: null, open: null } };
const sleep: QuestionDef = { questionId: 'q-sleep', key: 'sleep', versionId: 'v1', categoryId: 'c-lifestyle', weight: 1, isScored: true, optionValues: {} };

function cfg(over: Partial<EngineConfig> = {}): EngineConfig {
  return {
    categories: cats, questions: [kids, sleep], rules: [], intentMatrix: new Map([['casual|long', { score: 0.1, hard: false }], ['long|casual', { score: 0.1, hard: false }]]),
    intentDefaultScore: 0.5, importanceMultipliers: [0, 1, 2, 4], defaultImportance: 1, missingAnswerPolicy: 'neutral', topFactorCount: 3, differenceThreshold: 0.5, ...over,
  };
}

function user(id: string, over: Partial<UserFeatures> = {}, prefs: Partial<UserFeatures['prefs']> = {}): UserFeatures {
  return {
    userId: id, age: 30, genderTermId: 'g-w', intentTermId: 'long', goalTermId: 'committed', verified: true,
    attributes: new Map([['religion_importance', ['ri-some']], ['lifestyle_drinking', ['d-social']]]),
    interests: new Set(['hiking', 'coffee', 'jazz']), location: { lat: 17.385, lon: 78.4867 },
    answers: new Map([['q-kids', { versionId: 'v2', normalized: { t: 'choice', keys: ['want'], acceptable: ['want', 'open'] }, importance: 3, isDealbreaker: false }],
      ['q-sleep', { versionId: 'v1', normalized: { t: 'scale', value: 2, ratio: 0.25 }, importance: null, isDealbreaker: false }]]),
    prefs: { ageMin: 25, ageMax: 40, ageStrict: true, maxDistanceKm: 50, distanceStrict: false, globalMode: false, verifiedOnly: false, genderTermIds: [], intentTermIds: [], dealbreakerTerms: new Map(), ...prefs },
    ...over,
  };
}

describe('compatibility engine', () => {
  it('is deterministic and symmetric for identical profiles', () => {
    const a = user('a'), b = user('b');
    const r1 = compatibility(cfg(), a, b);
    const r2 = compatibility(cfg(), b, a);
    expect(r1).toEqual(compatibility(cfg(), a, b));
    if (r1.excluded || r2.excluded) throw new Error('unexpected exclusion');
    expect(r1.compatibility).toBe(100);
    expect(r1.compatibility).toBe(r2.compatibility);
    expect(r1.topFactors.map((f) => f.categoryKey)).toEqual(['relationship_intent', 'values', 'lifestyle']);
    expect(r1.confidence).toBe(1);
  });

  it('uses admin weights — changing a weight changes the result, nothing is hard-coded', () => {
    const a = user('a');
    const b = user('b', { intentTermId: 'casual', goalTermId: 'casual' });
    const base = compatibility(cfg(), a, b);
    const heavyIntent = compatibility(cfg({ categories: cats.map((c) => (c.key === 'relationship_intent' ? { ...c, weight: 0.9 } : c)) }), a, b);
    if (base.excluded || heavyIntent.excluded) throw new Error('unexpected exclusion');
    expect(heavyIntent.compatibility).toBeLessThan(base.compatibility);
    expect(base.differences[0]!.categoryKey).toBe('relationship_intent');
  });

  it('applies hard filters both ways', () => {
    expect(compatibility(cfg(), user('a', {}, { genderTermIds: ['g-m'] }), user('b'))).toMatchObject({ excluded: true, reason: 'gender_preference' });
    expect(compatibility(cfg(), user('a'), user('b', { age: 50 }))).toMatchObject({ excluded: true, reason: 'age_preference' });
    expect(compatibility(cfg(), user('a', {}, { distanceStrict: true, maxDistanceKm: 10 }), user('b', { location: { lat: 12.97, lon: 77.59 } }))).toMatchObject({ excluded: true, reason: 'distance_preference' });
    expect(compatibility(cfg(), user('a', {}, { dealbreakerTerms: new Map([['lifestyle_drinking', ['d-never']]]) }), user('b'))).toMatchObject({ excluded: true, reason: 'attribute_dealbreaker' });
  });

  it('enforces question deal-breakers and admin exclusion rules', () => {
    const a = user('a');
    a.answers.set('q-kids', { versionId: 'v2', normalized: { t: 'choice', keys: ['want'], acceptable: ['want'] }, importance: 3, isDealbreaker: true });
    const b = user('b');
    b.answers.set('q-kids', { versionId: 'v2', normalized: { t: 'choice', keys: ['dont_want'] }, importance: 3, isDealbreaker: false });
    expect(compatibility(cfg(), a, b)).toMatchObject({ excluded: true, reason: 'question_dealbreaker' });

    const rule = { sourceQuestionId: 'q-kids', sourceOptionKey: 'want', targetQuestionId: 'q-kids', targetOptionKey: 'dont_want', ruleType: 'negative' as const, scoreDelta: 0, isExclusion: true, isBidirectional: true };
    const c = user('c');
    expect(compatibility(cfg({ rules: [rule] }), b, c)).toMatchObject({ excluded: true, reason: 'exclusion_rule' });
  });

  it('ignores answers given to a superseded question version (never reinterprets history)', () => {
    const a = user('a');
    const b = user('b');
    b.answers.set('q-kids', { versionId: 'v1', normalized: { t: 'choice', keys: ['dont_want'] }, importance: 3, isDealbreaker: false });
    const r = compatibility(cfg(), a, b);
    if (r.excluded) throw new Error('unexpected');
    expect(r.confidence).toBeLessThan(1);
  });

  it('positive and negative rules shift the question score', () => {
    const a = user('a'), b = user('b');
    b.answers.set('q-sleep', { versionId: 'v1', normalized: { t: 'scale', value: 4, ratio: 0.75 }, importance: null, isDealbreaker: false });
    const plain = compatibility(cfg(), a, b);
    const boosted = compatibility(cfg({ rules: [{ sourceQuestionId: 'q-sleep', sourceOptionKey: null, targetQuestionId: 'q-sleep', targetOptionKey: null, ruleType: 'positive', scoreDelta: 0.3, isExclusion: false, isBidirectional: false }] }), a, b);
    if (plain.excluded || boosted.excluded) throw new Error('unexpected');
    expect(boosted.categoryScores.lifestyle!).toBeGreaterThan(plain.categoryScores.lifestyle!);
  });

  it('scores mutual acceptability and ordinal similarity', () => {
    const q: QuestionDef = { ...kids, optionValues: { low: 1, mid: 2, high: 3 } };
    expect(questionScore(q, { versionId: 'v2', normalized: { t: 'choice', keys: ['low'] }, importance: 1, isDealbreaker: false }, { versionId: 'v2', normalized: { t: 'choice', keys: ['high'] }, importance: 1, isDealbreaker: false })).toBe(0);
    expect(questionScore(q, { versionId: 'v2', normalized: { t: 'choice', keys: ['low'] }, importance: 1, isDealbreaker: false }, { versionId: 'v2', normalized: { t: 'choice', keys: ['mid'] }, importance: 1, isDealbreaker: false })).toBe(0.5);
    expect(questionScore(kids, { versionId: 'v2', normalized: { t: 'choice', keys: ['want'], acceptable: ['want'] }, importance: 1, isDealbreaker: false }, { versionId: 'v2', normalized: { t: 'choice', keys: ['open'], acceptable: ['want'] }, importance: 1, isDealbreaker: false })).toBe(0.5);
  });
});

describe('ranking', () => {
  const base: RankingConfig = { minCompatibility: 50, minConfidence: 0, behavioralWeight: 0.2, safetyExcludeThreshold: 0.9, safetyDownrankThreshold: 0.6, safetyDownrankFactor: 0.5, rules: [], diversityMaxShare: 1, diversityDimensions: [], limit: 10 };
  const cand = (id: string, compat: number, over: Partial<CandidateSignals> = {}): CandidateSignals => ({
    candidateId: id, compatibility: compat, confidence: 1, riskScore: 0, behavior: { replyRate: null, positiveFeedbackRate: null, recommendationAcceptRate: null, activeWithinDays: null }, facts: {}, diversityBuckets: {}, ...over,
  });

  it('gives new users a neutral behavior score', () => {
    expect(behaviorScore({ replyRate: null, positiveFeedbackRate: null, recommendationAcceptRate: null, activeWithinDays: null })).toBe(0.5);
  });

  it('drops below-threshold and risky candidates, down-ranks medium risk, applies rules', () => {
    const r = rank([
      cand('a', 90), cand('b', 40), cand('c', 95, { riskScore: 0.95 }), cand('d', 95, { riskScore: 0.7 }), cand('e', 80, { facts: { verified: true } }),
    ], { ...base, rules: [{ key: 'boost_verified', ruleType: 'boost', condition: { field: 'verified', op: 'eq', value: true }, value: 0.3 }] });
    expect(r.dropped).toEqual([{ candidateId: 'b', reason: 'below_min_compatibility' }, { candidateId: 'c', reason: 'safety_excluded' }]);
    expect(r.ranked.map((x) => x.candidateId)).toEqual(['e', 'a', 'd']);
    expect(r.ranked.find((x) => x.candidateId === 'd')!.appliedRules).toContain('safety_downrank');
  });

  it('enforces diversity caps without losing candidates when the pool is narrow', () => {
    const pool = ['a', 'b', 'c', 'd'].map((id, i) => cand(id, 90 - i, { diversityBuckets: { age_band: id === 'd' ? '35-39' : '25-29' } }));
    const r = rank(pool, { ...base, limit: 4, diversityMaxShare: 0.5, diversityDimensions: ['age_band'] });
    expect(r.ranked.map((x) => x.candidateId)).toEqual(['a', 'b', 'd', 'c']);
  });
});
