import type {
  adminCategorySignalsInput, adminCompatibilityCategoryUpsert, adminDealBreakerUpsert, adminMatchingConfigInput, adminMatchTestRequest, Predicate,
} from '@amora/shared';
import type { z } from 'zod';
import type { ApiClient } from '../client';

/*
 * Response shapes mirror apps/api/src/modules/matching/matching-admin.service.ts and the compatibility-category /
 * deal-breaker handlers in questionnaire-admin.controller.ts. `@amora/shared` only defines the request contracts.
 * Postgres `numeric` columns are returned by node-postgres as strings, so those fields are typed `number | string`
 * and must go through Number() before use.
 */

type In<T extends z.ZodType> = z.input<T>;
type Num = number | string;

export type MatchingConfigStatus = 'draft' | 'published' | 'archived';

export interface MatchingConfigSummary {
  id: string;
  version: number;
  status: MatchingConfigStatus;
  notes: string | null;
  created_at: string;
  published_at: string | null;
  published_by: string | null;
  created_by: string | null;
}

export interface MatchingRankingRule {
  key: string;
  ruleType: 'boost' | 'penalty' | 'exclude';
  condition: Predicate;
  value: number;
  isActive: boolean;
}

export interface MatchingIntentCell {
  a: string;
  b: string;
  score: number;
  hardExclusion: boolean;
}

/** GET /admin/matching/configs/:id — the version row (snake_case columns) plus weights, ranking rules and intent matrix. */
export interface MatchingConfigDetail extends MatchingConfigSummary {
  min_compatibility: Num;
  candidate_pool_limit: number;
  recommendation_batch_size: number;
  daily_curated_count: number;
  behavioral_weight: Num;
  diversity_max_share: Num;
  diversity_dimensions: string[];
  repeat_suppression_days: number;
  safety_exclude_threshold: Num;
  safety_downrank_threshold: Num;
  safety_downrank_factor: Num;
  missing_answer_policy: string;
  importance_multipliers: Num[];
  default_importance: number;
  intent_default_score: Num;
  min_confidence: Num;
  top_factor_count: number;
  difference_threshold: Num;
  recommendation_ttl_hours: number;
  weights: Record<string, number>;
  rankingRules: MatchingRankingRule[];
  intentMatrix: MatchingIntentCell[];
}

export interface MatchingValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type CompatibilitySource = z.infer<typeof adminCompatibilityCategoryUpsert>['source'];

export interface CompatibilityCategoryRow {
  id: string;
  key: string;
  source: CompatibilitySource;
  is_active: boolean;
  position: number;
  created_at: string;
  attribute_kinds: string[];
  uses_intent: boolean;
  uses_interests: boolean;
  uses_location: boolean;
  in_overall: boolean;
  translations: Record<string, { label: string | null; description: string | null }>;
}

export type DealBreakerSubject = z.infer<typeof adminDealBreakerUpsert>['subjectType'];
export type DealBreakerMode = z.infer<typeof adminDealBreakerUpsert>['mode'];

export interface DealBreakerRow {
  id: string;
  key: string;
  subject_type: DealBreakerSubject;
  question_id: string | null;
  attribute_kind: string | null;
  mode: DealBreakerMode;
  requires_entitlement: string | null;
  is_active: boolean;
  created_at: string;
}

// ------------------------------------------------------------------ "Test Matching Rules" response

export interface MatchExclusion {
  excluded: true;
  reason: string;
  detail?: Record<string, unknown>;
}

export interface MatchFactor {
  categoryKey: string;
  score: number;
  reasonKey: string;
  params: Record<string, string | number>;
}

export interface MatchCompatibility {
  excluded: false;
  compatibility: number;
  confidence: number;
  categoryScores: Record<string, number>;
  topFactors: MatchFactor[];
  differences: MatchFactor[];
  sharedInterestIds: string[];
  distanceKm: number | null;
}

export interface MatchQuestionTrace {
  questionKey: string;
  categoryId: string | null;
  weight: number;
  answeredA: boolean;
  answeredB: boolean;
  staleA: boolean;
  staleB: boolean;
  similarity: number | null;
  score: number | null;
  importanceA: number | null;
  importanceB: number | null;
  dealbreakerA: boolean;
  dealbreakerB: boolean;
}

export interface MatchRuleTrace {
  sourceQuestionId: string;
  sourceOptionKey: string | null;
  targetQuestionId: string;
  targetOptionKey: string | null;
  ruleType: 'positive' | 'negative' | 'dealbreaker' | 'similarity' | 'distance';
  scoreDelta: number;
  isExclusion: boolean;
  isBidirectional: boolean;
}

export interface MatchTestResult {
  configVersion: number;
  configVersionId: string;
  eligible: boolean;
  exclusion: MatchExclusion | null;
  result: MatchCompatibility | MatchExclusion;
  questions: MatchQuestionTrace[];
  positiveRules: MatchRuleTrace[];
  negativeRules: MatchRuleTrace[];
  dealBreakers: MatchRuleTrace[];
  ranking: {
    finalScore: number | null;
    appliedRules: string[];
    dropped: Array<{ candidateId: string; reason: string }>;
    behaviorScore: number;
    riskScore: number;
  } | null;
}

const enc = encodeURIComponent;

/** Typed wrappers for the matching admin endpoints (plus the matching-gated questionnaire category/deal-breaker routes). */
export function matchingApi(c: ApiClient) {
  return {
    configs: () => c.get<MatchingConfigSummary[]>('/admin/matching/configs'),
    config: (id: string) => c.get<MatchingConfigDetail>(`/admin/matching/configs/${enc(id)}`),
    /** No body = copy of the published version (server side); a body creates the draft from that content. */
    createDraft: (body?: In<typeof adminMatchingConfigInput>) => c.post<{ id: string; version: number }>('/admin/matching/configs', body ?? {}),
    updateDraft: (id: string, body: In<typeof adminMatchingConfigInput>) => c.put<MatchingConfigDetail>(`/admin/matching/configs/${enc(id)}`, body),
    deleteDraft: (id: string) => c.del<void>(`/admin/matching/configs/${enc(id)}`),
    validate: (id: string) => c.get<{ issues: MatchingValidationIssue[] }>(`/admin/matching/configs/${enc(id)}/validate`),
    publish: (id: string) => c.post<MatchingConfigDetail>(`/admin/matching/configs/${enc(id)}/publish`),
    updateSignals: (key: string, body: In<typeof adminCategorySignalsInput>) => c.put<void>(`/admin/matching/categories/${enc(key)}/signals`, body),
    test: (body: In<typeof adminMatchTestRequest>) => c.post<MatchTestResult>('/admin/matching/test', body),
    categories: () => c.get<CompatibilityCategoryRow[]>('/admin/questionnaire/compatibility-categories'),
    upsertCategory: (body: In<typeof adminCompatibilityCategoryUpsert>) => c.put<unknown>(`/admin/questionnaire/compatibility-categories/${enc(body.key)}`, body),
    dealBreakers: () => c.get<DealBreakerRow[]>('/admin/questionnaire/deal-breakers'),
    upsertDealBreaker: (body: In<typeof adminDealBreakerUpsert>) => c.put<unknown>(`/admin/questionnaire/deal-breakers/${enc(body.key)}`, body),
  };
}
