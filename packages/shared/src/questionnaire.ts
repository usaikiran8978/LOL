import { z } from 'zod';
import { locale, queryBool, uuid } from './common';
import { predicate } from './segments';

export const ANSWER_TYPES = ['single_choice', 'multiple_choice', 'yes_no', 'scale', 'numeric_range', 'ranking', 'text', 'structured_preference'] as const;
export const answerType = z.enum(ANSWER_TYPES);
export type AnswerType = z.infer<typeof answerType>;

const optionKey = z.string().regex(/^[a-z0-9_]{1,50}$/);
const qkey = z.string().regex(/^[a-z0-9_]{2,64}$/);

// ------------------------------------------------------------------ user answers

/** Raw answer payloads per answer type. The server validates against the exact question version. */
// z.union returns the first member that parses and objects strip unknown keys, so the more specific
// structured_preference shape must come before multiple_choice or acceptableOptionKeys would be dropped.
export const answerValue = z.union([
  z.object({ optionKey }),                                                     // single_choice, yes_no
  z.object({ optionKeys: z.array(optionKey).min(1).max(30), acceptableOptionKeys: z.array(optionKey).min(1).max(30) }), // structured_preference
  z.object({ optionKeys: z.array(optionKey).min(1).max(30) }),                 // multiple_choice
  z.object({ value: z.number() }),                                             // scale
  z.object({ min: z.number(), max: z.number() }),                              // numeric_range
  z.object({ rankedOptionKeys: z.array(optionKey).min(1).max(30) }),           // ranking
  z.object({ text: z.string().trim().min(1).max(2000) }),                      // text
]);
export type AnswerValue = z.infer<typeof answerValue>;

export const submitAnswer = z
  .object({
    questionId: uuid,
    versionId: uuid,
    skip: z.boolean().default(false),
    value: answerValue.optional(),
    importance: z.number().int().min(0).max(3).optional(),
    isDealbreaker: z.boolean().default(false),
    /** For choice questions: which partner answers are acceptable (optional "what do you want from a match"). */
    acceptableOptionKeys: z.array(optionKey).max(30).optional(),
  })
  .refine((a) => a.skip || a.value !== undefined, { message: 'value is required unless skipping', path: ['value'] });
export type SubmitAnswer = z.infer<typeof submitAnswer>;

export const submitAnswersBatch = z.object({ answers: z.array(submitAnswer).min(1).max(50) });

// ------------------------------------------------------------------ admin builder

const versionTranslations = z
  .record(locale, z.object({ text: z.string().min(1).max(500), helpText: z.string().max(1000).optional(), scaleMinLabel: z.string().max(80).optional(), scaleMaxLabel: z.string().max(80).optional() }))
  .refine((r) => 'en' in r, 'an "en" translation is required');

export const adminOptionInput = z.object({
  key: optionKey,
  numericValue: z.number().optional(),
  isExclusive: z.boolean().default(false),
  translations: z.record(locale, z.object({ label: z.string().min(1).max(200) })).refine((r) => 'en' in r, 'an "en" translation is required'),
});

export const adminConditionInput = z.object({
  groupNo: z.number().int().min(0).max(20).default(0),
  dependsOnQuestionId: uuid,
  operator: z.enum(['answered', 'not_answered', 'includes_any', 'includes_all', 'excludes', 'eq', 'gte', 'lte', 'between']),
  optionKeys: z.array(optionKey).max(30).optional(),
  numberA: z.number().optional(),
  numberB: z.number().optional(),
});

export const adminRuleInput = z.object({
  sourceOptionKey: optionKey.nullable().default(null),
  targetQuestionId: uuid,
  targetOptionKey: optionKey.nullable().default(null),
  ruleType: z.enum(['positive', 'negative', 'dealbreaker', 'similarity', 'distance']),
  scoreDelta: z.number().min(-1).max(1).default(0),
  isExclusion: z.boolean().default(false),
  isBidirectional: z.boolean().default(true),
  description: z.string().max(500).optional(),
});

export const adminVersionInput = z.object({
  answerType,
  isRequired: z.boolean().default(false),
  weight: z.number().min(0).max(100).default(1),
  compatibilityCategoryId: uuid.nullable().default(null),
  isScored: z.boolean().default(true),
  visibility: z.enum(['private', 'matches_only', 'public_profile']).default('private'),
  allowImportance: z.boolean().default(true),
  allowDealbreaker: z.boolean().default(false),
  allowSkip: z.boolean().default(true),
  minSelections: z.number().int().min(1).max(30).nullable().default(null),
  maxSelections: z.number().int().min(1).max(30).nullable().default(null),
  scaleMin: z.number().int().nullable().default(null),
  scaleMax: z.number().int().nullable().default(null),
  scaleStep: z.number().int().min(1).nullable().default(null),
  numericMin: z.number().nullable().default(null),
  numericMax: z.number().nullable().default(null),
  numericUnit: z.string().max(20).nullable().default(null),
  textMaxLength: z.number().int().min(1).max(2000).nullable().default(null),
  targeting: predicate.nullable().default(null),
  answerCarryOver: z.enum(['none', 'same_options', 'mapped']).default('none'),
  /** Only for 'mapped': previous published option key → new option key(s). */
  optionMappings: z.array(z.object({ fromOptionKey: optionKey, toOptionKey: optionKey })).max(200).default([]),
  changeNote: z.string().max(1000).optional(),
  translations: versionTranslations,
  options: z.array(adminOptionInput).max(60).default([]),
  conditions: z.array(adminConditionInput).max(20).default([]),
  rules: z.array(adminRuleInput).max(200).default([]),
});
export type AdminVersionInput = z.infer<typeof adminVersionInput>;

export const adminQuestionCreate = z.object({
  key: qkey,
  categoryId: uuid,
  position: z.number().int().min(0).optional(),
  version: adminVersionInput,
});

export const adminQuestionMeta = z.object({ categoryId: uuid.optional(), position: z.number().int().min(0).optional() });
export const adminQuestionOrder = z.object({ categoryId: uuid, questionIds: z.array(uuid).min(1).max(500) });
export const adminPublishRequest = z.object({ effectiveAt: z.iso.datetime().optional(), acknowledgeImpact: z.boolean().default(false) });
export const adminPreviewRequest = z.object({ locale: locale.default('en'), facts: z.record(z.string(), z.unknown()).default({}) });

export const adminQuestionCategoryUpsert = z.object({
  key: qkey,
  compatibilityCategoryId: uuid.nullable().default(null),
  position: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  translations: z.record(locale, z.object({ label: z.string().min(1).max(120), description: z.string().max(500).optional() })).refine((r) => 'en' in r, 'an "en" translation is required'),
});

export const adminCompatibilityCategoryUpsert = z.object({
  key: qkey,
  source: z.enum(['questionnaire', 'profile_attributes', 'interests', 'location', 'behavioral', 'mixed']),
  position: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  translations: z.record(locale, z.object({ label: z.string().min(1).max(120), description: z.string().max(500).optional() })).refine((r) => 'en' in r, 'an "en" translation is required'),
});

export const adminDealBreakerUpsert = z.object({
  key: qkey,
  subjectType: z.enum(['question', 'attribute', 'age', 'distance', 'intent', 'verification']),
  questionId: uuid.nullable().default(null),
  attributeKind: z.string().max(50).nullable().default(null),
  mode: z.enum(['user_optional', 'always_on']),
  requiresEntitlement: z.string().max(50).nullable().default(null),
  isActive: z.boolean().default(true),
});

// ------------------------------------------------------------------ matching config (admin)

export const adminMatchingConfigInput = z.object({
  minCompatibility: z.number().min(0).max(100),
  candidatePoolLimit: z.number().int().min(10).max(20000),
  recommendationBatchSize: z.number().int().min(1).max(500),
  dailyCuratedCount: z.number().int().min(0).max(100),
  behavioralWeight: z.number().min(0).max(1),
  diversityMaxShare: z.number().min(0.05).max(1),
  diversityDimensions: z.array(z.enum(['age_band', 'intent', 'city', 'gender'])).max(4),
  repeatSuppressionDays: z.number().int().min(0).max(365),
  safetyExcludeThreshold: z.number().min(0).max(1),
  safetyDownrankThreshold: z.number().min(0).max(1),
  safetyDownrankFactor: z.number().min(0).max(1),
  missingAnswerPolicy: z.enum(['neutral', 'penalize', 'ignore']),
  importanceMultipliers: z.tuple([z.number().min(0).max(20), z.number().min(0).max(20), z.number().min(0).max(20), z.number().min(0).max(20)]),
  defaultImportance: z.number().int().min(0).max(3),
  intentDefaultScore: z.number().min(0).max(1),
  minConfidence: z.number().min(0).max(1),
  topFactorCount: z.number().int().min(1).max(10),
  differenceThreshold: z.number().min(0).max(1),
  recommendationTtlHours: z.number().int().min(1).max(720),
  notes: z.string().max(2000).optional(),
  /** compatibility category key → weight; must sum to 1 at publish. */
  weights: z.record(z.string(), z.number().min(0).max(1)),
  rankingRules: z.array(z.object({
    key: z.string().regex(/^[a-z0-9_]{2,64}$/),
    ruleType: z.enum(['boost', 'penalty', 'exclude']),
    condition: predicate,
    value: z.number().min(0).max(1),
    isActive: z.boolean().default(true),
  })).max(50),
  /** intent key pairs; symmetric entries are generated automatically. */
  intentMatrix: z.array(z.object({ a: z.string(), b: z.string(), score: z.number().min(0).max(1), hardExclusion: z.boolean().default(false) })).max(400),
});
export type AdminMatchingConfigInput = z.infer<typeof adminMatchingConfigInput>;

export const adminCategorySignalsInput = z.object({
  attributeKinds: z.array(z.string().max(50)).max(20),
  usesIntent: z.boolean(),
  usesInterests: z.boolean(),
  usesLocation: z.boolean(),
  inOverall: z.boolean(),
});

export const adminMatchTestRequest = z.object({ userA: uuid, userB: uuid, configVersionId: uuid.optional() });

// ------------------------------------------------------------------ discovery (user)

export const SURFACES = ['swipe', 'smart', 'daily', 'nearby', 'travel', 'event', 'interest', 'intent', 'crossed_paths', 'search'] as const;
export const recommendationsQuery = z.object({
  surface: z.enum(SURFACES).default('swipe'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  interestId: uuid.optional(),
  intentId: uuid.optional(),
  travelPlanId: uuid.optional(),
  eventId: uuid.optional(),
});

export const likeRequest = z.object({
  targetId: uuid,
  action: z.enum(['like', 'pass', 'super_like']),
  surface: z.enum(SURFACES).default('swipe'),
  candidateRowId: uuid.optional(),
  comment: z.string().trim().max(300).optional(),
  likedItem: z.object({ type: z.enum(['photo', 'prompt', 'answer']), id: uuid }).optional(),
});

export const recommendationFeedbackRequest = z.object({
  candidateId: uuid,
  outcome: z.enum(['accepted', 'rejected', 'hidden']),
  reasonKey: z.string().regex(/^[a-z_]{2,50}$/).optional(),
});

export const searchQuery = z.object({
  ageMin: z.coerce.number().int().min(18).max(120).optional(),
  ageMax: z.coerce.number().int().min(18).max(120).optional(),
  maxDistanceKm: z.coerce.number().int().min(1).max(20000).optional(),
  genderIds: z.string().optional(),
  intentIds: z.string().optional(),
  interestIds: z.string().optional(),
  languageCodes: z.string().optional(),
  verifiedOnly: queryBool.optional(),
  heightMinCm: z.coerce.number().int().optional(),
  heightMaxCm: z.coerce.number().int().optional(),
  attributeIds: z.string().optional(),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const travelPlanCreate = z.object({
  cityId: uuid,
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  visibleToLocals: z.boolean().default(true),
});
