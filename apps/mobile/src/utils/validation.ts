import type { z } from 'zod';
import { ApiError } from '../api/errors';

export type FieldErrors = Record<string, string>;
type T = (key: string, params?: Record<string, unknown>) => string;

/**
 * Validates with the shared zod contract (the same schema the API enforces) and maps failing paths to localized
 * messages. `messages` maps a field path to an i18n key; unmapped paths fall back to a generic message.
 */
export function validate<S extends z.ZodType>(schema: S, data: unknown, messages: Record<string, string>, t: T): { ok: true; data: z.infer<S> } | { ok: false; errors: FieldErrors } {
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  const errors: FieldErrors = {};
  for (const issue of r.error.issues) {
    const path = issue.path.map(String).join('.');
    const top = path.split('.')[0] ?? path;
    const key = messages[path] ?? messages[top] ?? 'validation.invalid';
    if (!errors[top]) errors[top] = t(key);
  }
  return { ok: false, errors };
}

/** Server-side VALIDATION_FAILED issues mapped onto the same field keys. */
export function serverFieldErrors(e: unknown, messages: Record<string, string>, t: T): FieldErrors {
  if (!(e instanceof ApiError) || e.code !== 'VALIDATION_FAILED') return {};
  const out: FieldErrors = {};
  for (const i of e.fieldIssues) {
    const top = i.path.split('.')[0] ?? i.path;
    out[top] = t(messages[i.path] ?? messages[top] ?? 'validation.invalid');
  }
  return out;
}

/** Strip the separators people type in phone numbers; the API expects strict E.164. */
export const normalizePhone = (v: string) => v.replace(/[\s\-().]/g, '');

export const looksLikeEmail = (v: string) => v.includes('@');
