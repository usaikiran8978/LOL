// Test-only fixtures (imported by *.test.tsx only). Shapes mirror the API responses, numerics as node-postgres strings.
import type { CompatibilityCategoryRow, DealBreakerRow, MatchingConfigDetail, MatchingConfigSummary, MatchTestResult } from '@/lib/api/modules/matching';

export const DRAFT_ID = '11111111-1111-4111-8111-111111111111';
export const PUB_ID = '22222222-2222-4222-8222-222222222222';
export const OLD_ID = '33333333-3333-4333-8333-333333333333';
export const USER_A = '44444444-4444-4444-8444-444444444444';
export const USER_B = '55555555-5555-4555-8555-555555555555';

export const summaries: MatchingConfigSummary[] = [
  { id: DRAFT_ID, version: 3, status: 'draft', notes: 'tune values', created_at: '2026-03-01T00:00:00Z', published_at: null, published_by: null, created_by: 'a1' },
  { id: PUB_ID, version: 2, status: 'published', notes: null, created_at: '2026-02-01T00:00:00Z', published_at: '2026-02-02T00:00:00Z', published_by: 'a1', created_by: 'a1' },
  { id: OLD_ID, version: 1, status: 'archived', notes: null, created_at: '2026-01-01T00:00:00Z', published_at: '2026-01-02T00:00:00Z', published_by: 'a1', created_by: 'a1' },
];

export function detail(over: Partial<MatchingConfigDetail> = {}): MatchingConfigDetail {
  return {
    ...summaries[0]!,
    min_compatibility: '40.00', candidate_pool_limit: 2000, recommendation_batch_size: 50, daily_curated_count: 10,
    behavioral_weight: '0.1000', diversity_max_share: '0.5000', diversity_dimensions: ['age_band'], repeat_suppression_days: 30,
    safety_exclude_threshold: '0.9000', safety_downrank_threshold: '0.6000', safety_downrank_factor: '0.5000',
    missing_answer_policy: 'neutral', importance_multipliers: ['0.000', '1.000', '2.000', '4.000'], default_importance: 1,
    intent_default_score: '0.500', min_confidence: '0.000', top_factor_count: 3, difference_threshold: '0.500', recommendation_ttl_hours: 24,
    weights: { values: 0.6, lifestyle: 0.4 },
    rankingRules: [{ key: 'verified_boost', ruleType: 'boost', condition: { field: 'verified', op: 'eq', value: true }, value: 0.2, isActive: true }],
    intentMatrix: [
      { a: 'casual', b: 'long_term', score: 0.2, hardExclusion: false },
      { a: 'long_term', b: 'casual', score: 0.2, hardExclusion: false },
      { a: 'long_term', b: 'long_term', score: 1, hardExclusion: false },
    ],
    ...over,
  };
}

export const categories: CompatibilityCategoryRow[] = [
  {
    id: 'c-values', key: 'values', source: 'questionnaire', is_active: true, position: 0, created_at: '2026-01-01T00:00:00Z',
    attribute_kinds: [], uses_intent: false, uses_interests: false, uses_location: false, in_overall: true,
    translations: { en: { label: 'Values', description: null } },
  },
  {
    id: 'c-life', key: 'lifestyle', source: 'profile_attributes', is_active: true, position: 1, created_at: '2026-01-01T00:00:00Z',
    attribute_kinds: ['lifestyle_drinking'], uses_intent: false, uses_interests: false, uses_location: false, in_overall: true,
    translations: { en: { label: 'Lifestyle', description: 'Habits' } },
  },
  {
    id: 'c-goals', key: 'relationship_intent', source: 'mixed', is_active: true, position: 2, created_at: '2026-01-01T00:00:00Z',
    attribute_kinds: [], uses_intent: true, uses_interests: false, uses_location: false, in_overall: true,
    translations: { en: { label: 'Relationship goals', description: null } },
  },
];

export const dealBreakers: DealBreakerRow[] = [
  { id: 'd1', key: 'smoking', subject_type: 'attribute', question_id: null, attribute_kind: 'lifestyle_smoking', mode: 'user_optional', requires_entitlement: null, is_active: true, created_at: '2026-01-01T00:00:00Z' },
];

export function testResult(over: Partial<MatchTestResult> = {}): MatchTestResult {
  return {
    configVersion: 2, configVersionId: PUB_ID, eligible: true, exclusion: null,
    result: {
      excluded: false, compatibility: 72.5, confidence: 0.8, categoryScores: { values: 80, lifestyle: 60 },
      topFactors: [{ categoryKey: 'values', score: 80, reasonKey: 'match.reason.values', params: {} }],
      differences: [{ categoryKey: 'lifestyle', score: 40, reasonKey: 'match.difference.lifestyle', params: {} }],
      sharedInterestIds: ['i1', 'i2'], distanceKm: 3.2,
    },
    questions: [{ questionKey: 'wants_children', categoryId: 'c-values', weight: 1, answeredA: true, answeredB: true, staleA: false, staleB: false, similarity: 1, score: 1, importanceA: 3, importanceB: 2, dealbreakerA: false, dealbreakerB: false }],
    positiveRules: [], negativeRules: [], dealBreakers: [],
    ranking: { finalScore: 0.7123, appliedRules: ['verified_boost'], dropped: [], behaviorScore: 0.5, riskScore: 0.1 },
    ...over,
  };
}
