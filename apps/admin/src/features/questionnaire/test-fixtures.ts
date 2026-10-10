/* Test-only fixtures shaped like the API responses (see apps/api questionnaire-admin.service.ts). */
import type {
  CompatibilityCategory, QuestionCategory, QuestionDetail, QuestionListRow, QuestionVersion,
} from '@/lib/api/modules/questionnaire';

export const CAT_ID = '11111111-1111-4111-8111-111111111111';
export const CAT2_ID = '11111111-1111-4111-8111-222222222222';
export const COMPAT_ID = '22222222-2222-4222-8222-222222222222';
export const Q_ID = '33333333-3333-4333-8333-333333333333';
export const Q2_ID = '33333333-3333-4333-8333-444444444444';
export const V1_ID = '44444444-4444-4444-8444-444444444441';
export const V2_ID = '44444444-4444-4444-8444-444444444442';

export const categories: QuestionCategory[] = [
  { id: CAT_ID, key: 'lifestyle', compatibility_category_id: COMPAT_ID, position: 0, is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', translations: { en: { label: 'Lifestyle', description: null }, fr: { label: 'Mode de vie', description: null } } },
  { id: CAT2_ID, key: 'family', compatibility_category_id: null, position: 1, is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', translations: { en: { label: 'Family', description: 'Kids and family' } } },
];

export const compat: CompatibilityCategory[] = [
  { id: COMPAT_ID, key: 'lifestyle', source: 'questionnaire', is_active: true, position: 0, created_at: '2026-01-01T00:00:00Z', translations: { en: { label: 'Lifestyle fit', description: null } } },
];

export const listRows: QuestionListRow[] = [
  { id: Q_ID, key: 'coffee', category_id: CAT_ID, position: 0, is_active: true, archived_at: null, published_version_id: V1_ID, published_version: 1, answer_type: 'single_choice', is_required: false, weight: 2, draft_version: 2, current_answers: 42, text: 'Coffee or tea?' },
  { id: Q2_ID, key: 'pets', category_id: CAT2_ID, position: 0, is_active: false, archived_at: null, published_version_id: null, published_version: null, answer_type: null, is_required: null, weight: null, draft_version: 1, current_answers: 0, text: null },
];

function version(over: Partial<QuestionVersion>): QuestionVersion {
  return {
    id: V1_ID, questionId: Q_ID, version: 1, status: 'published', answerType: 'single_choice', isRequired: false, weight: 2, compatibilityCategoryId: null,
    isScored: true, visibility: 'private', allowImportance: true, allowDealbreaker: false, allowSkip: true, minSelections: null, maxSelections: null,
    scaleMin: null, scaleMax: null, scaleStep: null, numericMin: null, numericMax: null, textMaxLength: null, targeting: null, answerCarryOver: 'none',
    effectiveAt: null, changeNote: null, createdAt: '2026-01-01T00:00:00Z', publishedAt: '2026-01-02T00:00:00Z',
    options: [
      { id: 'o1', key: 'coffee', numericValue: 1, isExclusive: false },
      { id: 'o2', key: 'tea', numericValue: 2, isExclusive: false },
    ],
    translations: [{ locale: 'en', text: 'Coffee or tea?', helpText: null, scaleMinLabel: null, scaleMaxLabel: null }],
    optionTranslations: [
      { optionId: 'o1', locale: 'en', label: 'Coffee' },
      { optionId: 'o2', locale: 'en', label: 'Tea' },
    ],
    conditions: [], rules: [], optionMappings: [],
    ...over,
  };
}

export const v1 = version({});
export const v2Draft = version({
  id: V2_ID, version: 2, status: 'draft', publishedAt: null, createdAt: '2026-02-01T00:00:00Z', answerCarryOver: 'same_options', changeNote: 'Copy',
  options: [
    { id: 'o3', key: 'coffee', numericValue: 1, isExclusive: false },
    { id: 'o4', key: 'tea', numericValue: 2, isExclusive: false },
  ],
  optionTranslations: [
    { optionId: 'o3', locale: 'en', label: 'Coffee' },
    { optionId: 'o4', locale: 'en', label: 'Tea' },
  ],
});

export function detail(over: Partial<QuestionDetail> = {}): QuestionDetail {
  return {
    id: Q_ID, key: 'coffee', category_id: CAT_ID, position: 0, is_active: true, published_version_id: V1_ID, created_by: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', archived_at: null,
    versions: [v2Draft, v1],
    history: [{ id: 'e1', action: 'publish', impact_summary: { usersReasked: 3, answersCarriedOver: 5, usersWithCurrentAnswer: 8 }, performed_by: 'admin-1', performed_at: '2026-01-02T00:00:00Z', version: 1 }],
    ...over,
  };
}

export const impactReport = {
  versionId: V2_ID, previousVersionId: V1_ID, usersWithCurrentAnswer: 10, answersCarriedOver: 10, usersReasked: 0, newlyRequiredForUsers: 0,
  weightChange: 0, rulesBefore: 0, rulesAfter: 0, sampledPairs: 45, avgScoreDelta: 0, avgAbsScoreDelta: 0, issues: [],
};

export const analytics = {
  eligibleUsers: 100,
  versions: [{ versionId: V1_ID, version: 1, status: 'published', answered: 40, skipped: 2, dealbreakers: 1, completionRate: 0.4, distribution: [{ optionKey: 'tea', count: 10, share: 0.25 }, { optionKey: 'coffee', count: 30, share: 0.75 }] }],
};

/** Handlers every questionnaire screen needs (refs + the question). */
export function baseHandlers(q: QuestionDetail = detail()) {
  return {
    'GET /admin/questionnaire/categories': () => categories,
    'GET /admin/questionnaire/compatibility-categories': () => compat,
    'GET /admin/questions': () => listRows,
    [`GET /admin/questions/${q.id}`]: () => q,
    [`GET /admin/questions/${q.id}/analytics`]: () => analytics,
  };
}

/** Mutations made by the screen under test (excludes the sign-in POST from renderSignedIn). */
export function writes(calls: Array<{ method: string; path: string; body: unknown }>) {
  return calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/admin/auth/'));
}
