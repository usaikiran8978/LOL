import * as Crypto from 'expo-crypto';
import type {
  accountRecoveryRequest, attributesUpdate, changePasswordRequest, clientAnalyticsBatch, consentUpdate, ErrorCode, interestsUpdate,
  languagesUpdate, locationUpdate, loginRequest, mediaUploadRequest, onboardingStepUpdate, otpLoginRequest, otpRequest,
  passwordResetRequest, preferencesUpdate, privacyUpdate, profileUpdate, promptsUpdate, registerRequest, sendVerificationRequest,
  socialLoginRequest, TaxonomyKind, verifyContactRequest,
} from '@amora/shared';
import type { z } from 'zod';
import { env } from '../config/env';
import i18n from '../i18n';
import { ApiClient } from './client';
import { SecureTokenStore } from './tokenStore';
import type {
  AppConfigResponse, AuthResult, City, ConsentState, ContentEntry, ContentKind, Country, InterestCategory, Language, LegalDocType,
  LegalDocument, LocationResult, Media, MeResponse, OnboardingState, OwnProfile, Preferences, PrivacySettings, PromptOption, Session,
  Term, UploadTicket,
} from './types';

export * from './types';
export { ApiError, errorMessage, isApiError } from './errors';

type In<T extends z.ZodType> = z.input<T>;

let sessionExpiredHandler: ((code: ErrorCode) => void) | undefined;
/** The session layer registers here so a dead refresh token signs the user out wherever it is detected. */
export function onSessionExpired(handler: ((code: ErrorCode) => void) | undefined): void {
  sessionExpiredHandler = handler;
}

export const client = new ApiClient({
  baseUrl: env.apiUrl,
  tokens: new SecureTokenStore(),
  getLocale: () => i18n.language,
  newRequestId: () => Crypto.randomUUID(),
  onSessionExpired: (code) => sessionExpiredHandler?.(code),
});

const locale = () => i18n.language;

export const authApi = {
  register: (b: In<typeof registerRequest>) => client.post<AuthResult>('/auth/register', b, { auth: 'none' }),
  login: (b: In<typeof loginRequest>) => client.post<AuthResult>('/auth/login', b, { auth: 'none' }),
  requestOtp: (b: In<typeof otpRequest>) => client.post<{ accepted: true }>('/auth/otp/request', b, { auth: 'none' }),
  otpLogin: (b: In<typeof otpLoginRequest>) => client.post<AuthResult>('/auth/otp/login', b, { auth: 'none' }),
  social: (b: In<typeof socialLoginRequest>) => client.post<AuthResult>('/auth/social', b, { auth: 'none' }),
  resetPassword: (b: In<typeof passwordResetRequest>) => client.post<void>('/auth/password/reset', b, { auth: 'none' }),
  recover: (b: In<typeof accountRecoveryRequest>) => client.post<AuthResult>('/auth/recovery', b, { auth: 'none' }),
  sendVerification: (b: In<typeof sendVerificationRequest>) => client.post<{ accepted: true }>('/auth/verification/send', b),
  confirmVerification: (b: In<typeof verifyContactRequest>) => client.post<MeResponse>('/auth/verification/confirm', b),
  changePassword: (b: In<typeof changePasswordRequest>) => client.post<void>('/auth/password/change', b),
  logout: () => client.post<void>('/auth/logout'),
};

export const usersApi = {
  me: () => client.get<MeResponse>('/users/me'),
  sessions: () => client.get<Session[]>('/users/me/sessions'),
  revokeSession: (id: string) => client.delete(`/users/me/sessions/${encodeURIComponent(id)}`),
  revokeOtherSessions: () => client.post<void>('/users/me/sessions/revoke-others'),
  consents: () => client.get<ConsentState[]>('/users/me/consents'),
  setConsent: (b: In<typeof consentUpdate>) => client.post<ConsentState[]>('/users/me/consents', b),
};

export const configApi = {
  get: (q: { platform?: string; appVersion?: string; country?: string }) => client.get<AppConfigResponse>('/config', { query: q, auth: 'optional' }),
};

export const catalogApi = {
  taxonomy: (kinds: readonly TaxonomyKind[]) => client.get<Term[]>('/catalog/taxonomy', { query: { kinds: kinds.join(','), locale: locale() }, auth: 'none' }),
  interests: () => client.get<InterestCategory[]>('/catalog/interests', { query: { locale: locale() }, auth: 'none' }),
  prompts: () => client.get<PromptOption[]>('/catalog/prompts', { query: { locale: locale() }, auth: 'none' }),
  countries: () => client.get<Country[]>('/catalog/countries', { auth: 'none' }),
  languages: () => client.get<Language[]>('/catalog/languages', { auth: 'none' }),
  cities: (q: string, country?: string) => client.get<City[]>('/catalog/cities', { query: { q, country, limit: 20 }, auth: 'none' }),
};

export const legalApi = {
  get: (type: LegalDocType, country?: string) => client.get<LegalDocument>(`/legal/${type}`, { query: { locale: locale(), country }, auth: 'none' }),
};

export const contentApi = {
  list: (kind: ContentKind, country?: string) => client.get<ContentEntry[]>('/content', { query: { kind, country }, auth: 'none' }),
};

export const profileApi = {
  me: () => client.get<OwnProfile>('/profiles/me'),
  update: (b: In<typeof profileUpdate>) => client.put<OwnProfile>('/profiles/me', b),
  setAttributes: (b: In<typeof attributesUpdate>) => client.put<OwnProfile>('/profiles/me/attributes', b),
  setInterests: (b: In<typeof interestsUpdate>) => client.put<OwnProfile>('/profiles/me/interests', b),
  setLanguages: (b: In<typeof languagesUpdate>) => client.put<OwnProfile>('/profiles/me/languages', b),
  setPrompts: (b: In<typeof promptsUpdate>) => client.put<OwnProfile>('/profiles/me/prompts', b),
  privacy: () => client.get<PrivacySettings>('/profiles/me/privacy'),
  setPrivacy: (b: In<typeof privacyUpdate>) => client.put<PrivacySettings>('/profiles/me/privacy', b),
};

export const mediaApi = {
  list: () => client.get<Media[]>('/media'),
  requestUpload: (b: In<typeof mediaUploadRequest>) => client.post<UploadTicket>('/media/uploads', b),
  confirm: (id: string, caption?: string) => client.post<Media>(`/media/${encodeURIComponent(id)}/confirm`, caption ? { caption } : {}),
  reorder: (mediaIds: string[]) => client.put<Media[]>('/media/order', { mediaIds }),
  remove: (id: string) => client.delete(`/media/${encodeURIComponent(id)}`),
};

export const preferencesApi = {
  get: () => client.get<Preferences>('/preferences'),
  update: (b: In<typeof preferencesUpdate>) => client.put<Preferences>('/preferences', b),
};

export const locationApi = {
  update: (b: In<typeof locationUpdate>) => client.put<LocationResult>('/location', b),
};

export const onboardingApi = {
  get: () => client.get<OnboardingState>('/onboarding'),
  saveStep: (b: In<typeof onboardingStepUpdate>) => client.put<OnboardingState>('/onboarding/step', b),
  complete: () => client.post<OnboardingState>('/onboarding/complete'),
};

export const analyticsApi = {
  send: (b: In<typeof clientAnalyticsBatch>) => client.post<{ accepted: number; rejected: number }>('/analytics/events', b),
};
