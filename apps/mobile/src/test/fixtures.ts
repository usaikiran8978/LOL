import type { MeResponse, OnboardingState, OwnProfile } from '../api/types';

export const user = (over: Partial<MeResponse> = {}): MeResponse => ({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'sam@example.com',
  phone: null,
  emailVerified: true,
  phoneVerified: false,
  status: 'active',
  countryCode: 'GB',
  locale: 'en',
  onboardingCompleted: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

export const tokens = (n = 1) => ({
  accessToken: `access-${n}`,
  accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  refreshToken: `refresh-token-${n}-${'x'.repeat(40)}`,
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  sessionId: '22222222-2222-4222-8222-222222222222',
});

export const privacy = () => ({
  showAge: true, showDistance: true, showCity: true, showOnlineStatus: true, showReadReceipts: true, showOrientation: false, showReligion: true,
  showVerification: true, allowAiProfileAnalysis: false, allowAiMessageAnalysis: false, allowTranslation: true, discoverableBy: 'everyone' as const,
  incognito: false, snoozedUntil: null,
});

export const profile = (over: Partial<OwnProfile> = {}): OwnProfile => ({
  exists: true,
  displayName: 'Sam',
  bio: 'Coffee, climbing and long walks.',
  age: 30,
  gender: null,
  orientation: null,
  datingIntent: null,
  relationshipGoal: null,
  relationshipStatus: null,
  educationLevel: null,
  profession: 'Designer',
  employer: null,
  school: null,
  heightCm: null,
  cityId: null,
  homeCountryCode: null,
  attributes: {},
  interestIds: ['i-hiking'],
  languages: [{ code: 'en', proficiency: 'native' }],
  prompts: [],
  media: [],
  privacy: privacy(),
  verificationLevel: 'email',
  completeness: 55,
  discoverable: false,
  moderationStatus: 'approved',
  ...over,
});

export const onboarding = (over: Partial<OnboardingState> = {}): OnboardingState => ({
  flowVersion: 1,
  steps: [
    { key: 'profile_basics', required: true, applicable: true, completed: true },
    { key: 'gender', required: true, applicable: true, completed: false },
    { key: 'orientation', required: false, applicable: true, completed: false },
    { key: 'questionnaire', required: true, applicable: true, completed: false },
  ],
  currentStep: 'gender',
  progress: 25,
  draft: {},
  completedAt: null,
  canComplete: false,
  ...over,
});
