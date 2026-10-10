import { z } from 'zod';
import type { ApiClient } from '../client';

/*
 * Mirrors apps/api/src/modules/dates/admin-dates.controller.ts (`date_safety.manage`). Its request schemas are
 * inline in the controller (not exported from @amora/shared), so they are mirrored here.
 */

const enc = encodeURIComponent;

/** One bounded integer setting of `GET admin/dates/safety/settings` (value falls back to the built-in default). */
export interface DateSafetySetting {
  key: string;
  value: number;
  min: number;
  max: number;
  description: string;
}

export const TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** Date idea as returned by `GET admin/dates/ideas` (camelCase, translations keyed by locale). */
export interface DateIdea {
  id: string;
  key: string;
  activityType: string;
  budgetKey: string | null;
  dateStageKeys: string[];
  interestIds: string[];
  indoor: boolean | null;
  timeOfDay: TimeOfDay[];
  typicalDurationMin: number | null;
  safetyTipsKey: string | null;
  isActive: boolean;
  translations: Record<string, { title: string; description: string }>;
}

/** Path key of `PUT admin/dates/ideas/:key` (checked by the controller; immutable after creation). */
export const IDEA_KEY_RE = /^[a-z0-9_]{2,60}$/;

/** Mirrors `ideaBody` in admin-dates.controller.ts. */
export const dateIdeaUpsert = z.object({
  activityType: z.string().trim().min(2).max(50),
  budgetKey: z.string().max(50).nullable().default(null),
  dateStageKeys: z.array(z.string().max(50)).max(10).default([]),
  interestIds: z.array(z.uuid()).max(20).default([]),
  indoor: z.boolean().nullable().default(null),
  timeOfDay: z.array(z.enum(TIMES_OF_DAY)).max(4).default([]),
  typicalDurationMin: z.number().int().min(10).max(1440).nullable().default(null),
  safetyTipsKey: z.string().max(100).nullable().default(null),
  isActive: z.boolean().default(true),
  translations: z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), z.object({ title: z.string().trim().min(2).max(120), description: z.string().trim().min(2).max(1000) }))
    .refine((t) => !!t.en, { message: 'translations must include "en"' }),
});

/** Typed wrappers for the date-safety and date-idea admin endpoints. */
export function datesApi(c: ApiClient) {
  return {
    safetySettings: () => c.get<DateSafetySetting[]>('/admin/dates/safety/settings'),
    updateSafetySetting: (key: string, value: number) => c.put<{ key: string; value: number }>(`/admin/dates/safety/settings/${enc(key)}`, { value }),
    ideas: () => c.get<DateIdea[]>('/admin/dates/ideas'),
    upsertIdea: (key: string, body: z.input<typeof dateIdeaUpsert>) => c.put<{ id: string; key: string }>(`/admin/dates/ideas/${enc(key)}`, body),
  };
}
