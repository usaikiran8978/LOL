import { z } from 'zod';
import { countryCode, locale, uuid } from './common';

export const TAXONOMY_KINDS = [
  'gender', 'orientation', 'dating_intent', 'relationship_goal', 'relationship_status',
  'lifestyle_drinking', 'lifestyle_smoking', 'lifestyle_cannabis', 'lifestyle_exercise', 'lifestyle_diet',
  'lifestyle_sleep', 'lifestyle_social', 'pets', 'children_have', 'children_want', 'family_plans',
  'religion', 'religion_importance', 'politics', 'education_level', 'communication_style',
  'love_language', 'travel_style', 'zodiac', 'event_category', 'report_reason', 'date_stage', 'budget_tier',
] as const;
export const taxonomyKind = z.enum(TAXONOMY_KINDS);
export type TaxonomyKind = z.infer<typeof taxonomyKind>;

/** Attribute kinds a user may set on their own profile (single-select unless listed in MULTI_ATTRIBUTE_KINDS). */
export const PROFILE_ATTRIBUTE_KINDS = [
  'lifestyle_drinking', 'lifestyle_smoking', 'lifestyle_cannabis', 'lifestyle_exercise', 'lifestyle_diet',
  'lifestyle_sleep', 'lifestyle_social', 'pets', 'children_have', 'children_want', 'family_plans',
  'religion', 'religion_importance', 'politics', 'communication_style', 'love_language', 'travel_style', 'zodiac',
] as const;
export const MULTI_ATTRIBUTE_KINDS: readonly string[] = ['pets', 'love_language', 'travel_style'];

const nullableTrimmed = (max: number) => z.string().trim().max(max).nullable().optional();

export const profileUpdate = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  bio: nullableTrimmed(1000),
  genderId: uuid.nullable().optional(),
  orientationId: uuid.nullable().optional(),
  datingIntentId: uuid.nullable().optional(),
  relationshipGoalId: uuid.nullable().optional(),
  relationshipStatusId: uuid.nullable().optional(),
  profession: nullableTrimmed(100),
  employer: nullableTrimmed(100),
  educationLevelId: uuid.nullable().optional(),
  school: nullableTrimmed(120),
  heightCm: z.number().int().min(90).max(250).nullable().optional(),
  cityId: uuid.nullable().optional(),
  homeCountryCode: countryCode.nullable().optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdate>;

export const attributesUpdate = z.object({
  /** Full replacement per kind present in the payload; kinds absent are untouched. Empty array clears. */
  attributes: z.partialRecord(z.enum(PROFILE_ATTRIBUTE_KINDS), z.array(uuid).max(10)),
});

export const interestsUpdate = z.object({ interestIds: z.array(uuid).min(0).max(20) });

export const languagesUpdate = z.object({
  languages: z.array(z.object({ code: locale, proficiency: z.enum(['native', 'fluent', 'conversational', 'learning']) })).max(10),
});

export const promptsUpdate = z.object({
  prompts: z.array(z.object({ promptId: uuid, answer: z.string().trim().min(1).max(300) })).max(3),
});

export const privacyUpdate = z.object({
  showAge: z.boolean().optional(),
  showDistance: z.boolean().optional(),
  showCity: z.boolean().optional(),
  showOnlineStatus: z.boolean().optional(),
  showReadReceipts: z.boolean().optional(),
  showOrientation: z.boolean().optional(),
  showReligion: z.boolean().optional(),
  showVerification: z.boolean().optional(),
  allowAiProfileAnalysis: z.boolean().optional(),
  allowAiMessageAnalysis: z.boolean().optional(),
  allowTranslation: z.boolean().optional(),
  discoverableBy: z.enum(['everyone', 'liked_only', 'nobody']).optional(),
  incognito: z.boolean().optional(),
  snoozedUntil: z.iso.datetime().nullable().optional(),
});

export const preferencesUpdate = z
  .object({
    ageMin: z.number().int().min(18).max(120).optional(),
    ageMax: z.number().int().min(18).max(120).optional(),
    maxDistanceKm: z.number().int().min(1).max(20000).optional(),
    distanceStrict: z.boolean().optional(),
    ageStrict: z.boolean().optional(),
    heightMinCm: z.number().int().min(90).max(250).nullable().optional(),
    heightMaxCm: z.number().int().min(90).max(250).nullable().optional(),
    globalMode: z.boolean().optional(),
    verifiedOnly: z.boolean().optional(),
    /** Which genders / intents / attributes the user wants to see. Full replacement per kind present. */
    terms: z.partialRecord(taxonomyKind, z.array(z.object({ termId: uuid, isDealbreaker: z.boolean().default(false) })).max(20)).optional(),
  })
  .refine((v) => v.ageMin === undefined || v.ageMax === undefined || v.ageMin <= v.ageMax, { message: 'ageMin must be <= ageMax', path: ['ageMin'] });

export const locationUpdate = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100000).optional(),
  source: z.enum(['gps', 'network', 'manual_city']),
});

export const mediaUploadRequest = z.object({
  kind: z.enum(['photo', 'video', 'voice']),
  mimeType: z.string().max(100),
  byteSize: z.number().int().positive(),
});
export const mediaConfirm = z.object({ caption: z.string().trim().max(200).optional() });
export const mediaReorder = z.object({ mediaIds: z.array(uuid).min(1).max(9) });

export const onboardingStepUpdate = z
  .object({
    step: z.string().min(1).max(50),
    draft: z.record(z.string(), z.unknown()).optional(),
    complete: z.boolean().default(true),
    /** Skip an optional step (rejected for required steps). */
    skip: z.boolean().default(false),
  })
  .refine((v) => !(v.skip && v.complete && v.draft), { message: 'skip cannot carry a draft', path: ['draft'] });

/** Onboarding step keys the server knows how to validate (admin flows may add acknowledgement-only keys). */
export const KNOWN_ONBOARDING_STEPS = [
  'profile_basics', 'location', 'gender', 'orientation', 'dating_intent', 'relationship_goal', 'preferences', 'interests', 'lifestyle', 'family',
  'values', 'communication_style', 'languages', 'photos', 'prompts', 'questionnaire', 'permissions', 'verification',
] as const;

/** Fields available to segment / targeting predicates (UserFacts on the server). */
export const PREDICATE_FIELDS = [
  { field: 'countryCode', type: 'string' }, { field: 'locale', type: 'string' }, { field: 'age', type: 'number' }, { field: 'gender', type: 'string' },
  { field: 'orientation', type: 'string' }, { field: 'datingIntent', type: 'string' }, { field: 'relationshipGoal', type: 'string' },
  { field: 'verificationLevel', type: 'string' }, { field: 'isVerified', type: 'boolean' }, { field: 'accountAgeDays', type: 'number' },
  { field: 'entitlements', type: 'string[]' }, { field: 'religionFieldEnabled', type: 'boolean' }, { field: 'platform', type: 'string' }, { field: 'appVersion', type: 'string' },
] as const;

export const clientAnalyticsBatch = z.object({
  events: z
    .array(
      z.object({
        name: z.string().max(64),
        occurredAt: z.iso.datetime(),
        properties: z.record(z.string().max(64), z.union([z.string().max(256), z.number(), z.boolean(), z.null()])).default({}),
      }),
    )
    .min(1)
    .max(50),
  platform: z.enum(['ios', 'android', 'web']),
  appVersion: z.string().max(50).optional(),
});

/** Distance shown to other users is bucketed (DEC-008). */
export const DISTANCE_BUCKETS = ['lt_2km', '2_5km', '5_10km', '10_25km', '25_50km', '50_100km', 'gt_100km'] as const;
export type DistanceBucket = (typeof DISTANCE_BUCKETS)[number];
