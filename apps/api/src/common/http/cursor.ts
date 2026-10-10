import { AppError } from '../errors/app-error';

/** Opaque keyset cursor: base64url(JSON array of sort-key values). */
export function encodeCursor(values: Array<string | number>): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

export function decodeCursor<T extends Array<string | number>>(cursor: string | undefined, arity: number): T | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === arity) return parsed as T;
  } catch {
    /* fall through */
  }
  throw new AppError('VALIDATION_FAILED', 'Invalid cursor', [{ path: 'cursor', message: 'invalid' }]);
}

/**
 * Builds a keyset page from rows fetched with `limit + 1`: the extra row only signals that another page exists.
 * `key` returns the sort-key values of a row, in the same order the query sorts and filters by.
 */
export function keysetPage<T>(rows: T[], limit: number, key: (row: T) => Array<string | number>): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeCursor(key(items.at(-1)!)) : null };
}

/** ISO string for a timestamp column value (Date from pg, or string). */
export const iso = (v: string | Date) => new Date(v).toISOString();
