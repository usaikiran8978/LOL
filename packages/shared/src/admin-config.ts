import { z } from 'zod';
import { countryCode, locale } from './common';
import { taxonomyKind } from './profile';
import { predicate } from './segments';

const key = z.string().regex(/^[a-z0-9_]{2,64}$/);
const translations = <T extends z.ZodRawShape>(shape: T) => z.record(locale, z.object(shape)).refine((r) => Object.keys(r).length > 0 && 'en' in r, 'an "en" translation is required');

export const adminTermUpsert = z.object({
  kind: taxonomyKind,
  key,
  parentId: z.uuid().nullable().optional(),
  position: z.number().int().min(0).default(0),
  isSensitive: z.boolean().default(false),
  isActive: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).default({}),
  translations: translations({ label: z.string().min(1).max(120), description: z.string().max(500).optional() }),
});

export const adminInterestCategoryUpsert = z.object({
  key, icon: z.string().max(50).optional(), position: z.number().int().min(0).default(0), isActive: z.boolean().default(true),
  translations: translations({ label: z.string().min(1).max(80) }),
});

export const adminInterestUpsert = z.object({
  key, categoryId: z.uuid(), icon: z.string().max(50).optional(), position: z.number().int().min(0).default(0), isActive: z.boolean().default(true),
  translations: translations({ label: z.string().min(1).max(80) }),
});

export const adminPromptUpsert = z.object({
  key, category: z.string().max(50).default('general'), position: z.number().int().min(0).default(0), isActive: z.boolean().default(true),
  translations: translations({ text: z.string().min(1).max(200) }),
});

export const adminCountryUpsert = z.object({
  code: countryCode,
  name: z.string().min(1).max(100),
  defaultLocale: locale,
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/),
  measurement: z.enum(['metric', 'imperial']),
  isActive: z.boolean(),
  config: z.object({
    minAge: z.number().int().min(18).max(25),
    emergencyNumber: z.string().max(20).nullable(),
    crossedPathsAllowed: z.boolean(),
    identityVerificationAvailable: z.boolean(),
    religionFieldEnabled: z.boolean(),
    dataRegion: z.string().trim().min(2).max(20),
    privacyRegime: z.string().max(20).nullable(),
    dataRetentionDays: z.number().int().min(30).max(3650),
  }),
});

export const adminCityUpsert = z.object({
  countryCode, name: z.string().min(1).max(120), adminRegion: z.string().max(120).optional(),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), timezone: z.string().max(64),
  population: z.number().int().min(0).optional(), isActive: z.boolean().default(true),
});

export const adminLanguageUpsert = z.object({
  code: locale, name: z.string().max(80), nativeName: z.string().max(80), isRtl: z.boolean(), isAppLocale: z.boolean(), isActive: z.boolean(),
});

export const adminFlagUpsert = z.object({
  key: z.string().regex(/^[a-z0-9_.]{2,64}$/),
  description: z.string().max(500).optional(),
  enabled: z.boolean(),
  defaultValue: z.boolean(),
  rules: z
    .array(
      z.object({
        ruleType: z.enum(['country', 'percentage', 'segment', 'user', 'platform', 'app_version']),
        countryCodes: z.array(countryCode).optional(),
        percentage: z.number().int().min(0).max(100).optional(),
        segmentKey: key.optional(),
        userIds: z.array(z.uuid()).max(1000).optional(),
        platforms: z.array(z.enum(['ios', 'android', 'web'])).optional(),
        minAppVersion: z.string().regex(/^\d+(\.\d+){0,2}$/).optional(),
        value: z.boolean(),
      }),
    )
    .max(50)
    .default([]),
});

export const adminSegmentUpsert = z.object({ key, description: z.string().max(500).optional(), definition: predicate });

export const adminSettingUpsert = z.object({
  /** Omit to keep the current value (lets admins edit a secret's description without re-entering it). */
  value: z.unknown().optional(),
  isSecret: z.boolean().optional(),
  /** duration values are seconds. */
  valueType: z.enum(['string', 'number', 'boolean', 'json', 'duration']),
  description: z.string().max(500).optional(),
});

export const adminCmsUpsert = z.object({
  key: z.string().regex(/^[a-z0-9_.-]{1,100}$/),
  kind: z.enum(['faq', 'help_article', 'safety_tip', 'safety_guide', 'announcement', 'page', 'onboarding_tip', 'paywall_copy']),
  category: z.string().max(50).optional(),
  position: z.number().int().min(0).default(0),
  countryCodes: z.array(countryCode).nullable().default(null),
  status: z.enum(['draft', 'published', 'archived']),
  publishAt: z.iso.datetime().nullable().optional(),
  unpublishAt: z.iso.datetime().nullable().optional(),
  translations: translations({ title: z.string().min(1).max(200), bodyMarkdown: z.string().min(1).max(50000) }),
}).refine((v) => !v.publishAt || !v.unpublishAt || v.unpublishAt > v.publishAt, { message: 'unpublishAt must be after publishAt', path: ['unpublishAt'] });

export const adminLegalCreate = z.object({
  docType: z.enum(['terms', 'privacy', 'community_guidelines', 'safety', 'cookie', 'ai_terms']),
  locale,
  countryCode: countryCode.nullable().default(null),
  title: z.string().min(1).max(200),
  bodyMarkdown: z.string().min(1).max(200000),
  requiresReacceptance: z.boolean().default(false),
});
export const adminLegalPublish = z.object({ effectiveAt: z.iso.datetime().optional() });

export const adminOnboardingFlowCreate = z.object({
  steps: z.array(z.object({ key: z.string().regex(/^[a-z_]{2,50}$/), required: z.boolean(), condition: predicate.optional() })).min(1).max(40),
});

export const adminAuditQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  actorType: z.enum(['user', 'admin', 'system']).optional(),
  actorId: z.uuid().optional(),
  action: z.string().max(100).optional(),
  targetType: z.string().max(50).optional(),
  targetId: z.string().max(100).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export const adminUserInvite = z.object({
  email: z.email().max(254),
  displayName: z.string().trim().min(1).max(80),
  roleKeys: z.array(z.string().regex(/^[a-z0-9_]{2,64}$/)).min(1),
  countryScope: z.array(z.string().regex(/^[A-Z]{2}$/)).nullable().default(null),
});
export const adminUserRolesUpdate = z.object({ roleKeys: z.array(z.string().regex(/^[a-z0-9_]{2,64}$/)).min(0), countryScope: z.array(z.string().regex(/^[A-Z]{2}$/)).nullable().default(null) });
export const adminRoleUpsert = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(300).optional(), permissions: z.array(z.string()).max(200) });
export const adminAcceptInvite = z.object({ token: z.string().min(20).max(200), password: z.string().min(14).max(128) });
export const adminMfaConfirm = z.object({ code: z.string().regex(/^\d{6}$/) });
export const adminLegalDraftUpdate = z.object({ title: z.string().min(1).max(200), bodyMarkdown: z.string().min(1).max(200000), requiresReacceptance: z.boolean().default(false) });
