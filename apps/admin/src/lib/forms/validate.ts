import type { z } from 'zod';
import { t } from '@/i18n';

type Issue = z.core.$ZodIssue;

/** Maps a zod issue to a localized message (zod's own messages are developer-facing English). */
export function issueMessage(issue: Issue): string {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.input === undefined || issue.input === null || issue.input === '') return t('validation.required');
      return issue.expected === 'number' ? t('validation.notNumber') : t('validation.invalid');
    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.origin === 'string') return min <= 1 ? t('validation.required') : t('validation.tooShort', { min });
      if (issue.origin === 'array' || issue.origin === 'set') return t('validation.tooFewItems', { min });
      return t('validation.tooSmall', { min });
    }
    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.origin === 'string') return t('validation.tooLong', { max });
      if (issue.origin === 'array' || issue.origin === 'set') return t('validation.tooManyItems', { max });
      return t('validation.tooBig', { max });
    }
    case 'invalid_format':
      if (issue.format === 'uuid') return t('validation.invalidUuid');
      if (issue.format === 'datetime') return t('validation.invalidDate');
      return t('validation.invalidFormat');
    case 'invalid_value':
      return t('validation.invalidOption');
    case 'custom':
      // The shared `translations()` refinement is the only custom rule in the admin contracts.
      return issue.message.includes('"en"') ? t('validation.enRequired') : t('validation.invalid');
    default:
      return t('validation.invalid');
  }
}

export type FieldErrors = Record<string, string>;

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

/** Validates with a shared contract; errors keyed by dotted path ('' for root). First issue per path wins. */
export function validate<S extends z.ZodType>(schema: S, value: unknown): ValidationResult<z.output<S>> {
  const r = schema.safeParse(value);
  if (r.success) return { ok: true, data: r.data };
  const errors: FieldErrors = {};
  for (const issue of r.error.issues) {
    const path = issue.path.map(String).join('.');
    errors[path] ??= issueMessage(issue);
  }
  return { ok: false, errors };
}

/** Errors at `prefix` or below, re-keyed relative to it (for nested editors such as translations). */
export function scopedErrors(errors: FieldErrors, prefix: string): FieldErrors {
  const out: FieldErrors = {};
  for (const [k, v] of Object.entries(errors)) {
    if (k === prefix) out[''] = v;
    else if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v;
  }
  return out;
}

export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function parseList(text: string): string[] {
  return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

/** `<input type="datetime-local">` value ↔ ISO-8601 UTC (the contracts require `Z` timestamps). */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
