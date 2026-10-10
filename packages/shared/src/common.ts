import { z } from 'zod';

export const uuid = z.uuid();

/** Boolean query-string parameter. Unlike z.coerce.boolean(), the string "false" parses as false. */
export const queryBool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
export const countryCode = z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2');
export const locale = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2}|-[A-Za-z]{4})?$/, 'BCP-47 locale');
export const e164 = z.string().regex(/^\+[1-9][0-9]{6,14}$/, 'E.164 phone number');
export const email = z.email().max(254).transform((v) => v.trim().toLowerCase());
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** Cursor pagination (TECH §22). Cursors are opaque to clients. */
export const pageQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof pageQuery>;
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const platform = z.enum(['ios', 'android', 'web']);

export const deviceInfo = z.object({
  installationId: z.string().min(8).max(128),
  platform,
  model: z.string().max(100).optional(),
  osVersion: z.string().max(50).optional(),
  appVersion: z.string().max(50).optional(),
});
export type DeviceInfo = z.infer<typeof deviceInfo>;
