import type {
  adminPreviewRequest, adminPublishRequest, adminQuestionCategoryUpsert, adminQuestionCreate, adminQuestionMeta, adminQuestionOrder,
  adminVersionInput, AnswerType, Predicate,
} from '@amora/shared';
import type { z } from 'zod';
import type { ApiClient } from '../client';

/*
 * Response shapes mirror apps/api/src/modules/questionnaire/questionnaire-admin.{controller,service}.ts and
 * question-repo.ts (`FullVersion`); `@amora/shared` only defines the request contracts.
 */

type In<T extends z.ZodType> = z.input<T>;
const enc = encodeURIComponent;

export type QuestionListStatus = 'active' | 'inactive' | 'archived' | 'draft_only';
export type VersionStatus = 'draft' | 'scheduled' | 'published' | 'superseded' | 'archived';
export type ConditionOperator = z.infer<typeof adminVersionInput>['conditions'][number]['operator'];
export type RuleType = z.infer<typeof adminVersionInput>['rules'][number]['ruleType'];
export type Visibility = z.infer<typeof adminVersionInput>['visibility'];
export type CarryOver = z.infer<typeof adminVersionInput>['answerCarryOver'];
export type CompatibilitySource = 'questionnaire' | 'profile_attributes' | 'interests' | 'location' | 'behavioral' | 'mixed';

/** Row of GET /admin/questions (published version columns are null for never-published questions). */
export interface QuestionListRow {
  id: string;
  key: string;
  category_id: string;
  position: number;
  is_active: boolean;
  archived_at: string | null;
  published_version_id: string | null;
  published_version: number | null;
  answer_type: AnswerType | null;
  is_required: boolean | null;
  weight: number | null;
  draft_version: number | null;
  current_answers: number;
  /** English text of the published version. */
  text: string | null;
}

export interface QuestionOption {
  id: string;
  key: string;
  numericValue: number | null;
  isExclusive: boolean;
}

export interface QuestionCondition {
  id: string;
  groupNo: number;
  dependsOnQuestionId: string;
  operator: ConditionOperator;
  optionKeys: string[] | null;
  numberA: number | null;
  numberB: number | null;
}

export interface QuestionRule {
  id: string;
  sourceOptionId: string | null;
  sourceOptionKey: string | null;
  targetQuestionId: string;
  targetOptionKey: string | null;
  ruleType: RuleType;
  scoreDelta: number;
  isExclusion: boolean;
  isBidirectional: boolean;
  description: string | null;
}

export interface QuestionVersion {
  id: string;
  questionId: string;
  version: number;
  status: VersionStatus;
  answerType: AnswerType;
  isRequired: boolean;
  weight: number;
  compatibilityCategoryId: string | null;
  isScored: boolean;
  visibility: Visibility;
  allowImportance: boolean;
  allowDealbreaker: boolean;
  allowSkip: boolean;
  minSelections: number | null;
  maxSelections: number | null;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleStep: number | null;
  numericMin: number | null;
  numericMax: number | null;
  /** Not returned by the API today (FullVersion omits numeric_unit); kept optional so the editor tolerates it. */
  numericUnit?: string | null;
  textMaxLength: number | null;
  targeting: Predicate | null;
  answerCarryOver: CarryOver;
  effectiveAt: string | null;
  changeNote: string | null;
  createdAt: string;
  publishedAt: string | null;
  options: QuestionOption[];
  translations: Array<{ locale: string; text: string; helpText: string | null; scaleMinLabel: string | null; scaleMaxLabel: string | null }>;
  optionTranslations: Array<{ optionId: string; locale: string; label: string }>;
  conditions: QuestionCondition[];
  rules: QuestionRule[];
  optionMappings: Array<{ fromOptionKey: string; toOptionKey: string }>;
}

export type PublishAction = 'publish' | 'schedule' | 'rollback' | 'activate' | 'deactivate' | 'archive';

export interface PublishEvent {
  id: string;
  action: PublishAction | string;
  /** jsonb impact snapshot (ImpactReport) for publish/schedule/rollback, null otherwise. */
  impact_summary: Partial<ImpactReport> | string | null;
  performed_by: string | null;
  performed_at: string;
  version: number;
}

export interface QuestionDetail {
  id: string;
  key: string;
  category_id: string;
  position: number;
  is_active: boolean;
  published_version_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  /** Newest first. */
  versions: QuestionVersion[];
  /** Newest first. */
  history: PublishEvent[];
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ImpactReport {
  versionId: string;
  previousVersionId: string | null;
  usersWithCurrentAnswer: number;
  answersCarriedOver: number;
  usersReasked: number;
  newlyRequiredForUsers: number;
  weightChange: number;
  rulesBefore: number;
  rulesAfter: number;
  sampledPairs: number;
  avgScoreDelta: number;
  avgAbsScoreDelta: number;
  issues: ValidationIssue[];
}

export interface RenderedQuestion {
  versionId: string;
  answerType: AnswerType;
  text: string;
  helpText: string | null;
  scaleMinLabel: string | null;
  scaleMaxLabel: string | null;
  isRequired: boolean;
  allowImportance: boolean;
  allowDealbreaker: boolean;
  allowSkip: boolean;
  constraints: {
    minSelections: number | null; maxSelections: number | null; scaleMin: number | null; scaleMax: number | null; scaleStep: number | null;
    numericMin: number | null; numericMax: number | null; textMaxLength: number | null;
  };
  options: Array<{ key: string; label: string; isExclusive: boolean }>;
}

export interface PreviewResult {
  rendered: RenderedQuestion;
  targetingMatches: boolean;
  conditions: QuestionCondition[];
  issues: ValidationIssue[];
}

export type PublishResult = { status: 'published'; impact: ImpactReport } | { status: 'scheduled'; effectiveAt: string; impact: ImpactReport };

export interface VersionAnalytics {
  versionId: string;
  version: number;
  status: VersionStatus;
  answered: number;
  skipped: number;
  dealbreakers: number;
  completionRate: number;
  distribution: Array<{ optionKey: string; count: number; share: number }>;
}

/** `eligibleUsers` is absent when the question has no non-draft versions. */
export interface QuestionAnalytics {
  eligibleUsers?: number;
  versions: VersionAnalytics[];
}

type CategoryTranslations = Record<string, { label: string; description: string | null }>;

export interface QuestionCategory {
  id: string;
  key: string;
  compatibility_category_id: string | null;
  position: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  translations: CategoryTranslations;
}

export interface CompatibilityCategory {
  id: string;
  key: string;
  source: CompatibilitySource;
  is_active: boolean;
  position: number;
  created_at: string;
  translations: CategoryTranslations;
}

/** Typed wrappers for the questionnaire admin endpoints. */
export function questionnaireApi(c: ApiClient) {
  return {
    list: (q: { categoryId?: string; status?: QuestionListStatus } = {}) => c.get<QuestionListRow[]>('/admin/questions', q),
    get: (id: string) => c.get<QuestionDetail>(`/admin/questions/${enc(id)}`),
    create: (body: In<typeof adminQuestionCreate>) => c.post<{ questionId: string; versionId: string }>('/admin/questions', body),
    updateMeta: (id: string, body: In<typeof adminQuestionMeta>) => c.put<unknown>(`/admin/questions/${enc(id)}`, body),
    reorder: (body: In<typeof adminQuestionOrder>) => c.put<void>(`/admin/questions/order/${enc(body.categoryId)}`, body),
    /** Omit `body` to copy the latest version. */
    createDraft: (id: string, body?: In<typeof adminVersionInput>) => c.post<{ questionId: string; versionId: string }>(`/admin/questions/${enc(id)}/drafts`, body ?? {}),
    updateDraft: (versionId: string, body: In<typeof adminVersionInput>) => c.put<{ questionId: string; versionId: string }>(`/admin/questions/versions/${enc(versionId)}`, body),
    deleteDraft: (versionId: string) => c.del<void>(`/admin/questions/versions/${enc(versionId)}`),
    validate: (versionId: string) => c.get<{ issues: ValidationIssue[] }>(`/admin/questions/versions/${enc(versionId)}/validate`),
    preview: (versionId: string, body: In<typeof adminPreviewRequest>) => c.post<PreviewResult>(`/admin/questions/versions/${enc(versionId)}/preview`, body),
    impact: (versionId: string) => c.get<ImpactReport>(`/admin/questions/versions/${enc(versionId)}/impact`),
    publish: (versionId: string, body: In<typeof adminPublishRequest>) => c.post<PublishResult>(`/admin/questions/versions/${enc(versionId)}/publish`, body),
    cancelSchedule: (versionId: string) => c.post<void>(`/admin/questions/versions/${enc(versionId)}/cancel-schedule`),
    rollback: (id: string, versionId: string) => c.post<{ versionId: string }>(`/admin/questions/${enc(id)}/rollback/${enc(versionId)}`),
    activate: (id: string) => c.post<void>(`/admin/questions/${enc(id)}/activate`),
    deactivate: (id: string) => c.post<void>(`/admin/questions/${enc(id)}/deactivate`),
    archive: (id: string) => c.post<void>(`/admin/questions/${enc(id)}/archive`),
    analytics: (id: string) => c.get<QuestionAnalytics>(`/admin/questions/${enc(id)}/analytics`),
    categories: () => c.get<QuestionCategory[]>('/admin/questionnaire/categories'),
    upsertCategory: (body: In<typeof adminQuestionCategoryUpsert>) => c.put<unknown>(`/admin/questionnaire/categories/${enc(body.key)}`, body),
    /** Read-only (owned by the Matching module); requires matching.view. Used for category selects. */
    compatibilityCategories: () => c.get<CompatibilityCategory[]>('/admin/questionnaire/compatibility-categories'),
  };
}
