import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ApiError } from '../../api/errors';

/** What a failed call needs from the user, when it is not a plain error. */
export type Gate =
  | { kind: 'paywall'; entitlement: string | null; resetsAt: string | null }
  | { kind: 'profile' }
  /** CONSENT_REQUIRED: `details.kind` says whether a consent record (`consentType`) or a privacy setting (`setting`) is missing. */
  | { kind: 'consent'; consentType: string | null; setting: string | null }
  /** FEATURE_DISABLED by the member's own privacy setting (e.g. `allowTranslation`), not by the platform. */
  | { kind: 'setting_off'; setting: string };

/**
 * Maps entitlement/limit/profile/consent errors to the UI they need. Daily limits (LIMIT_REACHED) and missing
 * entitlements both lead to the paywall; PROFILE_INCOMPLETE leads to finishing the profile.
 */
export function gateFor(e: unknown): Gate | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === 'ENTITLEMENT_REQUIRED') return { kind: 'paywall', entitlement: e.detail<string>('entitlement') ?? e.detail<string>('item') ?? null, resetsAt: null };
  if (e.code === 'LIMIT_REACHED') return { kind: 'paywall', entitlement: e.detail<string>('key') ?? null, resetsAt: e.detail<string>('resetsAt') ?? null };
  if (e.code === 'PROFILE_INCOMPLETE') return { kind: 'profile' };
  if (e.code === 'CONSENT_REQUIRED') {
    const kind = e.detail<string>('kind');
    const consentType = e.detail<string>('consentType') ?? null;
    const setting = e.detail<string>('setting') ?? null;
    return { kind: 'consent', consentType: kind === 'setting' ? null : consentType, setting: kind === 'consent' ? null : setting };
  }
  const off = e.code === 'FEATURE_DISABLED' ? e.detail<string>('setting') : undefined;
  if (typeof off === 'string' && off) return { kind: 'setting_off', setting: off };
  return null;
}

/** Opens the paywall; `surface` is reported with the paywall_viewed event. */
export function usePaywall() {
  const router = useRouter();
  return useCallback(
    (surface: string, entitlement?: string | null) => router.push({ pathname: '/premium', params: { surface, ...(entitlement ? { entitlement } : {}) } }),
    [router],
  );
}
