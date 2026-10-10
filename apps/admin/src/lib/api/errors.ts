import { t, tDynamic } from '@/i18n';
import { ApiError, ReauthCancelledError } from './client';

/** Localized, user-facing message for any thrown value. Server `message` is developer-facing and never shown. */
export function errorMessage(error: unknown): string {
  if (error instanceof ReauthCancelledError) return t('auth.reauthCancelled');
  if (error instanceof ApiError) {
    return tDynamic(`errors.${error.code}`, t('errors.UNKNOWN'));
  }
  return t('errors.UNKNOWN');
}

export function requestIdOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}

/**
 * Field-level errors from a VALIDATION_FAILED response (`details: [{ path, message, code }]`).
 * Messages are mapped from the zod issue code so they stay localized.
 */
export function apiFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED' || !Array.isArray(error.details)) return {};
  const out: Record<string, string> = {};
  for (const d of error.details as Array<{ path?: unknown; code?: unknown }>) {
    if (typeof d?.path !== 'string') continue;
    out[d.path] ??= d.code === 'invalid_type' ? t('validation.required') : d.code === 'invalid_format' ? t('validation.invalidFormat') : t('validation.invalid');
  }
  return out;
}
