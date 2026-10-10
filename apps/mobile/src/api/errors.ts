import { ErrorCodes, type ErrorCode } from '@amora/shared';

/** Client-side failure codes that never come from the server (no HTTP response, or an unparseable one). */
export const CLIENT_ERROR_CODES = ['NETWORK', 'TIMEOUT', 'BAD_RESPONSE'] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];
export type AnyErrorCode = ErrorCode | ClientErrorCode;

export interface FieldIssue {
  path: string;
  message: string;
  code?: string;
}

/** Every failed API call surfaces as an ApiError; UI code branches on `code`, never on `message`. */
export class ApiError extends Error {
  constructor(
    readonly code: AnyErrorCode,
    readonly status: number,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }

  /** Seconds to wait before retrying, when the server says so (RATE_LIMITED, ACCOUNT_LOCKED). */
  get retryAfterSeconds(): number | null {
    const v = (this.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
    return typeof v === 'number' && v > 0 ? v : null;
  }

  /** VALIDATION_FAILED details are `[{ path, message }]`; anything else yields no field issues. */
  get fieldIssues(): FieldIssue[] {
    return Array.isArray(this.details) ? (this.details.filter((d) => d && typeof d.path === 'string') as FieldIssue[]) : [];
  }

  detail<T = unknown>(key: string): T | undefined {
    return this.details && typeof this.details === 'object' && !Array.isArray(this.details) ? ((this.details as Record<string, unknown>)[key] as T) : undefined;
  }
}

export function isApiError(e: unknown, code?: AnyErrorCode): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

const KNOWN = new Set<string>([...Object.keys(ErrorCodes), ...CLIENT_ERROR_CODES]);

/** Unknown server codes (e.g. a newer API) fall back to the generic message instead of showing a raw key. */
export function normalizeCode(code: unknown): AnyErrorCode {
  return typeof code === 'string' && KNOWN.has(code) ? (code as AnyErrorCode) : 'INTERNAL';
}

/** i18n key + interpolation params for any thrown value. */
export function errorMessage(e: unknown): { key: string; params: Record<string, unknown> } {
  if (!(e instanceof ApiError)) return { key: 'errors.INTERNAL', params: {} };
  const params: Record<string, unknown> = {};
  if (e.retryAfterSeconds) params.seconds = e.retryAfterSeconds;
  const minAge = e.detail<number>('minAge');
  if (typeof minAge === 'number') params.minAge = minAge;
  const until = e.detail<string>('until');
  if (until) params.until = until;
  // Onboarding step checks return an i18n reason key (e.g. onboarding.missing.photos); prefer it when present.
  const reason = e.detail<string>('reason');
  if (e.code === 'ONBOARDING_STEP_INVALID' && typeof reason === 'string' && /^onboarding\.missing\.[a-z_]+$/.test(reason)) return { key: reason, params };
  // Some codes read better with the retry hint when the server supplied one.
  if ((e.code === 'RATE_LIMITED' || e.code === 'ACCOUNT_LOCKED') && params.seconds) return { key: `errors.${e.code}_retry`, params };
  return { key: `errors.${e.code}`, params };
}
