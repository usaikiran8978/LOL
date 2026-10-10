import { z } from 'zod';
import { countryCode, deviceInfo, e164, email, isoDate, locale } from './common';

/** Password policy: length over composition rules (NIST 800-63B). Breached-password check runs server-side. */
export const password = z.string().min(10, 'min 10 characters').max(128);

export const registerRequest = z
  .object({
    email: email.optional(),
    phone: e164.optional(),
    password: password.optional(),
    dateOfBirth: isoDate,
    countryCode,
    locale,
    timezone: z.string().max(64).optional(),
    acceptedTermsVersionId: z.uuid(),
    acceptedPrivacyVersionId: z.uuid(),
    confirmsMinimumAge: z.literal(true),
    marketingOptIn: z.boolean().default(false),
    device: deviceInfo,
  })
  .refine((v) => v.email || v.phone, { message: 'email or phone is required', path: ['email'] })
  .refine((v) => !v.email || v.password, { message: 'password is required for email sign-up', path: ['password'] });
export type RegisterRequest = z.infer<typeof registerRequest>;

export const loginRequest = z.object({
  identifier: z.string().min(3).max(254), // email or E.164 phone
  password: z.string().min(1).max(128),
  device: deviceInfo,
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const otpChannel = z.enum(['email', 'sms']);

/** Public OTP request: login code, password reset, account recovery. Response is always 202. */
export const otpRequest = z.object({
  channel: otpChannel,
  destination: z.string().min(3).max(254),
  purpose: z.enum(['login_otp', 'password_reset', 'account_recovery']),
});
export type OtpRequest = z.infer<typeof otpRequest>;

/** Authenticated: (re)send a code to verify the account's own email or phone. */
export const sendVerificationRequest = z.object({ channel: otpChannel });

export const verifyContactRequest = z.object({
  channel: otpChannel,
  code: z.string().regex(/^\d{6}$/),
});

export const accountRecoveryRequest = z.object({
  channel: otpChannel,
  destination: z.string().min(3).max(254),
  code: z.string().regex(/^\d{6}$/),
  newPassword: password.optional(),
  device: deviceInfo,
});

export const otpLoginRequest = z.object({
  phone: e164,
  code: z.string().regex(/^\d{6}$/),
  device: deviceInfo,
});

export const socialLoginRequest = z.object({
  provider: z.enum(['google', 'apple', 'facebook']),
  // Google/Apple: OIDC ID token. Facebook: a user access token, or the OIDC token from iOS Limited Login.
  idToken: z.string().min(20).max(8192),
  nonce: z.string().max(256).optional(),
  device: deviceInfo,
  // Required only when the social identity is new (account creation):
  signup: z
    .object({
      dateOfBirth: isoDate,
      countryCode,
      locale,
      timezone: z.string().max(64).optional(),
      acceptedTermsVersionId: z.uuid(),
      acceptedPrivacyVersionId: z.uuid(),
      confirmsMinimumAge: z.literal(true),
      marketingOptIn: z.boolean().default(false),
    })
    .optional(),
});

export const refreshRequest = z.object({ refreshToken: z.string().min(32).max(512) });

export const passwordResetRequest = z.object({
  channel: otpChannel,
  destination: z.string().min(3).max(254),
  code: z.string().regex(/^\d{6}$/),
  newPassword: password,
});

export const changePasswordRequest = z.object({
  /** Required when the account already has a password; omitted for phone/social accounts setting their first one. */
  currentPassword: z.string().min(1).max(128).optional(),
  newPassword: password,
});

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

export interface AuthResult {
  user: MeResponse;
  tokens: AuthTokens;
  isNewUser: boolean;
}

export interface MeResponse {
  id: string;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  status: string;
  countryCode: string | null;
  locale: string;
  onboardingCompleted: boolean;
  createdAt: string;
}

export const consentUpdate = z.object({
  consentType: z.enum([
    'location', 'precise_location', 'crossed_paths', 'marketing_email', 'marketing_push', 'marketing_sms',
    'ai_assistance', 'ai_sensitive_data', 'sensitive_profile_data', 'analytics', 'calendar',
    'biometric_verification', 'identity_verification',
  ]),
  granted: z.boolean(),
});

export const adminLoginRequest = z.object({
  email,
  password: z.string().min(1).max(128),
  totp: z.string().regex(/^\d{6}$/).optional(),
});
