/**
 * Response shapes of the endpoints this app calls. `@amora/shared` only publishes request schemas, so these mirror
 * the API services (apps/api/src/modules/**) exactly; request bodies are always typed from the shared zod schemas.
 */
import { consentUpdate, type AuthResult, type AuthTokens, type MeResponse, type TaxonomyKind } from '@amora/shared';

export type { AuthResult, AuthTokens, MeResponse };

export interface AppConfigResponse {
  /** Sticky experiment assignments for the signed-in user (absent when anonymous). */
  experiments?: Record<string, { variant: string; config: Record<string, unknown> }>;
  flags: Record<string, boolean>;
  settings: Record<string, unknown>;
  locales: Array<{ code: string; nativeName: string; rtl: boolean }>;
  countries: Array<{ code: string; currency: string; measurement: 'metric' | 'imperial'; defaultLocale: string }>;
}

export interface Country {
  code: string;
  name: string;
  defaultLocale: string;
  currency: string;
  measurement: 'metric' | 'imperial';
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  rtl: boolean;
}

export interface City {
  id: string;
  countryCode: string;
  name: string;
  region: string | null;
  timezone: string | null;
}

export interface Term {
  id: string;
  kind: TaxonomyKind;
  key: string;
  label: string;
  description: string | null;
  parentId: string | null;
  sensitive: boolean;
}

export interface InterestCategory {
  id: string;
  key: string;
  icon: string | null;
  label: string;
  interests: Array<{ id: string; key: string; icon: string | null; categoryId: string; label: string }>;
}

export interface PromptOption {
  id: string;
  key: string;
  category: string;
  text: string;
}

export const LEGAL_DOC_TYPES = ['terms', 'privacy', 'community_guidelines', 'safety', 'cookie', 'ai_terms'] as const;
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number];

export interface LegalDocument {
  id: string;
  type: LegalDocType;
  version: number;
  locale: string;
  countryCode: string | null;
  title: string;
  bodyMarkdown: string;
  effectiveAt: string | null;
}

export const CONTENT_KINDS = ['faq', 'help_article', 'safety_tip', 'safety_guide', 'announcement', 'page', 'onboarding_tip', 'paywall_copy'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export interface ContentEntry {
  id: string;
  key: string;
  kind: ContentKind;
  category: string | null;
  locale: string;
  title: string;
  bodyMarkdown: string;
  publishedAt: string | null;
}

export interface Session {
  id: string;
  current: boolean;
  platform: string | null;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  createdAt: string;
  lastUsedAt: string;
}

/** Consent types accepted by `POST /users/me/consents` (from the shared request schema). */
export type ConsentType = (typeof consentUpdate.shape.consentType.options)[number];
export const isConsentType = (v: unknown): v is ConsentType => typeof v === 'string' && (consentUpdate.shape.consentType.options as readonly string[]).includes(v);

export interface ConsentState {
  consentType: string;
  granted: boolean;
  legalDocumentId: string | null;
  updatedAt: string;
}

export interface TermLabel {
  id: string;
  key: string;
  label: string;
}

export type MediaKind = 'photo' | 'video' | 'voice';
export interface Media {
  id: string;
  kind: MediaKind;
  position: number;
  /** uploading | processing | ready | failed */
  processingStatus: string;
  /** pending | approved | rejected | needs_review */
  moderationStatus: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  caption: string | null;
  url: string | null;
  thumbUrl: string | null;
}

export interface UploadTicket {
  mediaId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface PrivacySettings {
  showAge: boolean;
  showDistance: boolean;
  showCity: boolean;
  showOnlineStatus: boolean;
  showReadReceipts: boolean;
  showOrientation: boolean;
  showReligion: boolean;
  showVerification: boolean;
  allowAiProfileAnalysis: boolean;
  allowAiMessageAnalysis: boolean;
  allowTranslation: boolean;
  discoverableBy: 'everyone' | 'liked_only' | 'nobody';
  incognito: boolean;
  snoozedUntil: string | null;
}

export interface OwnProfile {
  exists: boolean;
  displayName: string | null;
  bio: string | null;
  age: number | null;
  gender: TermLabel | null;
  orientation: TermLabel | null;
  datingIntent: TermLabel | null;
  relationshipGoal: TermLabel | null;
  relationshipStatus: TermLabel | null;
  educationLevel: TermLabel | null;
  profession: string | null;
  employer: string | null;
  school: string | null;
  heightCm: number | null;
  cityId: string | null;
  homeCountryCode: string | null;
  attributes: Record<string, TermLabel[]>;
  interestIds: string[];
  languages: Array<{ code: string; proficiency: LanguageProficiency }>;
  prompts: Array<{ id: string; promptId: string; answer: string; moderationStatus: string }>;
  media: Media[];
  privacy: PrivacySettings;
  verificationLevel: string;
  completeness: number;
  discoverable: boolean;
  moderationStatus: string;
}

export type LanguageProficiency = 'native' | 'fluent' | 'conversational' | 'learning';

export interface Preferences {
  ageMin: number;
  ageMax: number;
  maxDistanceKm: number;
  distanceStrict: boolean;
  ageStrict: boolean;
  heightMinCm: number | null;
  heightMaxCm: number | null;
  globalMode: boolean;
  verifiedOnly: boolean;
  terms: Partial<Record<TaxonomyKind, Array<{ termId: string; isDealbreaker: boolean }>>>;
}

export interface OnboardingStepState {
  key: string;
  required: boolean;
  applicable: boolean;
  completed: boolean;
}

export interface OnboardingState {
  flowVersion: number;
  steps: OnboardingStepState[];
  currentStep: string | null;
  progress: number;
  draft: Record<string, unknown>;
  completedAt: string | null;
  canComplete: boolean;
}

export interface LocationResult {
  cityId: string | null;
  cityName: string | null;
}
