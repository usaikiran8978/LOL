import type {
  adminCityUpsert, adminCmsUpsert, adminCountryUpsert, adminFlagUpsert, adminInterestCategoryUpsert, adminInterestUpsert,
  adminLanguageUpsert, adminLegalCreate, adminLegalPublish, adminOnboardingFlowCreate, adminPromptUpsert, adminSegmentUpsert,
  adminSettingUpsert, adminTermUpsert, Page, Permission, Predicate, TaxonomyKind,
} from '@amora/shared';
import type { z } from 'zod';
import type { ApiClient } from './client';
import { dashboardApi } from './modules/dashboard';
import { analyticsApi } from './modules/analytics';
import { questionnaireApi } from './modules/questionnaire';
import { matchingApi } from './modules/matching';
import { usersApi } from './modules/users';
import { privacyApi } from './modules/privacy';
import { safetyApi } from './modules/safety';
import { billingApi } from './modules/billing';
import { aiApi } from './modules/ai';
import { notificationsApi } from './modules/notifications';
import { eventsApi } from './modules/events';
import { adminsApi } from './modules/admins';
import { datesApi } from './modules/dates';

/*
 * Response shapes. The admin config endpoints return database rows as-is (snake_case columns plus a
 * `translations` map); these types mirror apps/api/src/modules/admin/** because `@amora/shared` only
 * defines request contracts for them (reported as a contract gap).
 */

type In<T extends z.ZodType> = z.input<T>;

export interface AdminIdentity {
  id: string;
  email: string;
  displayName?: string | null;
  permissions: Permission[];
  countryScope: string[] | null;
  mfaEnabled?: boolean;
  /** True when the deployment requires MFA and this admin has not set it up; every other admin call fails with MFA_SETUP_REQUIRED. */
  mfaSetupRequired?: boolean;
  sessionExpiresAt?: string;
}

export interface LoginResponse {
  admin: { id: string; email: string; displayName: string | null; mfaEnabled: boolean; permissions: Permission[] };
  csrfToken: string;
  expiresAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorType: 'user' | 'admin' | 'system';
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface AuditQuery {
  actorType?: 'user' | 'admin' | 'system';
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  cursor?: string;
  limit?: number;
}

export type Translations<F extends string> = Record<string, Partial<Record<F, string | null>>>;

export interface TaxonomyTerm {
  id: string;
  kind: TaxonomyKind;
  key: string;
  parent_id: string | null;
  position: number;
  is_sensitive: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
  translations: Translations<'label' | 'description'>;
}

export interface InterestCategory {
  id: string;
  key: string;
  icon: string | null;
  position: number;
  is_active: boolean;
  translations: Translations<'label'>;
}

export interface Interest {
  id: string;
  key: string;
  category_id: string;
  icon: string | null;
  position: number;
  is_active: boolean;
  translations: Translations<'label'>;
}

export interface ProfilePrompt {
  id: string;
  key: string;
  category: string;
  position: number;
  is_active: boolean;
  translations: Translations<'text'>;
}

export interface CountryRow {
  code: string;
  name: string;
  default_locale: string | null;
  default_currency: string;
  measurement: 'metric' | 'imperial';
  is_active: boolean;
  // country_configs columns (null when no config row exists yet)
  min_age: number | null;
  emergency_number: string | null;
  crossed_paths_allowed: boolean | null;
  identity_verification_available: boolean | null;
  religion_field_enabled: boolean | null;
  data_region: string | null;
  privacy_regime: string | null;
  data_retention_days: number | null;
}

export interface CityRow {
  id: string;
  country_code: string;
  name: string;
  admin_region: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  population: number | null;
  is_active: boolean;
}

export interface LanguageRow {
  code: string;
  name: string;
  native_name: string;
  is_rtl: boolean;
  is_app_locale: boolean;
  is_active: boolean;
}

export type FlagRuleType = 'country' | 'percentage' | 'segment' | 'user' | 'platform' | 'app_version';

export interface FlagRuleRow {
  id: string;
  priority: number;
  rule_type: FlagRuleType;
  country_codes: string[] | null;
  percentage: number | null;
  segment_key: string | null;
  user_ids: string[] | null;
  platforms: Array<'ios' | 'android' | 'web'> | null;
  min_app_version: string | null;
  value: boolean;
}

export interface FlagRow {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  default_value: boolean;
  updated_at: string;
  rules: FlagRuleRow[];
}

export interface SegmentRow {
  id: string;
  key: string;
  description: string | null;
  definition: Predicate;
  updated_at: string;
}

export type SettingValueType = 'string' | 'number' | 'boolean' | 'json' | 'duration';

export interface SettingRow {
  key: string;
  value_type: SettingValueType;
  description: string | null;
  is_secret: boolean;
  updated_at: string;
  updated_by: string | null;
  /** Always null for secret settings. */
  value: unknown;
}

export interface OnboardingStep {
  key: string;
  required: boolean;
  condition?: Predicate;
}

export interface OnboardingFlowRow {
  version: number;
  status: 'draft' | 'published' | 'archived';
  steps: OnboardingStep[];
  created_at: string;
  published_at: string | null;
  published_by: string | null;
}

export type CmsKind = z.infer<typeof adminCmsUpsert>['kind'];

export interface CmsEntryRow {
  id: string;
  key: string;
  kind: CmsKind;
  category: string | null;
  position: number;
  country_codes: string[] | null;
  status: 'draft' | 'published' | 'archived';
  publish_at: string | null;
  unpublish_at: string | null;
  updated_at: string;
  translations: Translations<'title' | 'bodyMarkdown'>;
}

export type LegalDocType = z.infer<typeof adminLegalCreate>['docType'];

export interface LegalSummary {
  id: string;
  doc_type: LegalDocType;
  version: number;
  locale: string;
  country_code: string | null;
  title: string;
  status: 'draft' | 'published' | 'archived';
  effective_at: string | null;
  requires_reacceptance: boolean;
  created_at: string;
}

export interface LegalDocument extends LegalSummary {
  body_md: string;
}

const enc = encodeURIComponent;

/** Typed wrappers for every admin endpoint the console uses. Request bodies are the shared zod contracts. */
export function adminApi(c: ApiClient) {
  return {
    auth: {
      login: (body: { email: string; password: string; totp?: string }) =>
        c.post<LoginResponse>('/admin/auth/login', body, { skipCsrf: true, skipAuthRedirect: true }),
      me: () => c.request<AdminIdentity>('GET', '/admin/auth/me', { skipAuthRedirect: true }),
      logout: () => c.request<void>('POST', '/admin/auth/logout', { skipAuthRedirect: true }),
    },
    audit: {
      list: (q: AuditQuery) => c.get<Page<AuditLogEntry>>('/admin/audit-logs', { ...q }),
    },
    taxonomy: {
      terms: (kind: TaxonomyKind) => c.get<TaxonomyTerm[]>('/admin/taxonomy/terms', { kind }),
      createTerm: (body: In<typeof adminTermUpsert>) => c.post<TaxonomyTerm>('/admin/taxonomy/terms', body),
      updateTerm: (id: string, body: In<typeof adminTermUpsert>) => c.put<TaxonomyTerm>(`/admin/taxonomy/terms/${enc(id)}`, body),
      categories: () => c.get<InterestCategory[]>('/admin/taxonomy/interest-categories'),
      createCategory: (body: In<typeof adminInterestCategoryUpsert>) => c.post<InterestCategory>('/admin/taxonomy/interest-categories', body),
      updateCategory: (id: string, body: In<typeof adminInterestCategoryUpsert>) => c.put<InterestCategory>(`/admin/taxonomy/interest-categories/${enc(id)}`, body),
      interests: () => c.get<Interest[]>('/admin/taxonomy/interests'),
      createInterest: (body: In<typeof adminInterestUpsert>) => c.post<Interest>('/admin/taxonomy/interests', body),
      updateInterest: (id: string, body: In<typeof adminInterestUpsert>) => c.put<Interest>(`/admin/taxonomy/interests/${enc(id)}`, body),
      prompts: () => c.get<ProfilePrompt[]>('/admin/taxonomy/prompts'),
      createPrompt: (body: In<typeof adminPromptUpsert>) => c.post<ProfilePrompt>('/admin/taxonomy/prompts', body),
      updatePrompt: (id: string, body: In<typeof adminPromptUpsert>) => c.put<ProfilePrompt>(`/admin/taxonomy/prompts/${enc(id)}`, body),
    },
    geo: {
      countries: () => c.get<CountryRow[]>('/admin/geo/countries'),
      upsertCountry: (body: In<typeof adminCountryUpsert>) => c.put<unknown>(`/admin/geo/countries/${enc(body.code)}`, body),
      cities: (q: { country?: string; q?: string; cursor?: string; limit?: number }) => c.get<Page<CityRow>>('/admin/geo/cities', q),
      createCity: (body: In<typeof adminCityUpsert>) => c.post<CityRow>('/admin/geo/cities', body),
      updateCity: (id: string, body: In<typeof adminCityUpsert>) => c.put<CityRow>(`/admin/geo/cities/${enc(id)}`, body),
      languages: () => c.get<LanguageRow[]>('/admin/geo/languages'),
      upsertLanguage: (body: In<typeof adminLanguageUpsert>) => c.put<unknown>(`/admin/geo/languages/${enc(body.code)}`, body),
    },
    config: {
      flags: () => c.get<FlagRow[]>('/admin/config/flags'),
      upsertFlag: (body: In<typeof adminFlagUpsert>) => c.put<unknown>(`/admin/config/flags/${enc(body.key)}`, body),
      segments: () => c.get<SegmentRow[]>('/admin/config/segments'),
      upsertSegment: (body: In<typeof adminSegmentUpsert>) => c.put<SegmentRow>(`/admin/config/segments/${enc(body.key)}`, body),
      settings: () => c.get<SettingRow[]>('/admin/config/settings'),
      upsertSetting: (key: string, body: In<typeof adminSettingUpsert>) => c.put<unknown>(`/admin/config/settings/${enc(key)}`, body),
      flows: () => c.get<OnboardingFlowRow[]>('/admin/config/onboarding-flows'),
      createFlow: (body: In<typeof adminOnboardingFlowCreate>) => c.post<OnboardingFlowRow>('/admin/config/onboarding-flows', body),
      publishFlow: (version: number) => c.post<OnboardingFlowRow>(`/admin/config/onboarding-flows/${version}/publish`),
    },
    content: {
      cms: (kind?: CmsKind) => c.get<CmsEntryRow[]>('/admin/content/cms', { kind }),
      upsertCms: (body: In<typeof adminCmsUpsert>) => c.put<CmsEntryRow>(`/admin/content/cms/${enc(body.key)}`, body),
      archiveCms: (key: string) => c.del<void>(`/admin/content/cms/${enc(key)}`),
      legal: () => c.get<LegalSummary[]>('/admin/content/legal'),
      legalDoc: (id: string) => c.get<LegalDocument>(`/admin/content/legal/${enc(id)}`),
      createLegal: (body: In<typeof adminLegalCreate>) => c.post<Pick<LegalSummary, 'id' | 'doc_type' | 'version' | 'locale' | 'status'>>('/admin/content/legal', body),
      publishLegal: (id: string, body: In<typeof adminLegalPublish>) => c.post<unknown>(`/admin/content/legal/${enc(id)}/publish`, body),
    },
    // Later modules keep their wrappers and response types in ./modules/<module>.ts.
    dashboard: dashboardApi(c),
    analytics: analyticsApi(c),
    questionnaire: questionnaireApi(c),
    matching: matchingApi(c),
    users: usersApi(c),
    privacy: privacyApi(c),
    safety: safetyApi(c),
    billing: billingApi(c),
    ai: aiApi(c),
    notifications: notificationsApi(c),
    events: eventsApi(c),
    admins: adminsApi(c),
    dates: datesApi(c),
  };
}

export type AdminApi = ReturnType<typeof adminApi>;
