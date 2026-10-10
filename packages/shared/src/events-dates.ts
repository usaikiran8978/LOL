import { z } from 'zod';
import { countryCode, queryBool, uuid } from './common';

// ------------------------------------------------------------------ events

export const eventsQuery = z.object({
  cityId: uuid.optional(),
  country: countryCode.optional(),
  categoryKey: z.string().max(50).optional(),
  interestId: uuid.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  mine: queryBool.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const eventFields = z.object({
  categoryKey: z.string().max(50),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
  cityId: uuid,
  venueName: z.string().trim().max(200).optional(),
  venueAddress: z.string().trim().max(400).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isOnline: z.boolean().default(false),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timezone: z.string().max(64),
  capacity: z.number().int().min(2).max(10000).optional(),
  minAge: z.number().int().min(18).max(99).optional(),
  maxAge: z.number().int().min(18).max(120).optional(),
  interestIds: z.array(uuid).max(10).default([]),
  preEventMatching: z.boolean().default(false),
  chatEnabled: z.boolean().default(true),
  visibility: z.enum(['public', 'unlisted', 'premium_only']).default('public'),
});
const eventChecks = <T extends z.ZodType<{ startsAt?: string; endsAt?: string; minAge?: number | null; maxAge?: number | null }>>(schema: T) => schema
  .refine((e) => !e.startsAt || !e.endsAt || new Date(e.endsAt) > new Date(e.startsAt), { message: 'endsAt must be after startsAt', path: ['endsAt'] })
  .refine((e) => !e.minAge || !e.maxAge || e.minAge <= e.maxAge, { message: 'minAge must be <= maxAge', path: ['minAge'] });
export const eventCreate = eventChecks(eventFields);
const ticketPrice = { priceMinor: z.number().int().min(0).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional() };
/** Platform-organized events (admin console) may be ticketed. */
export const adminEventCreate = eventChecks(eventFields.extend(ticketPrice));
/** Partial update; attendees are notified when the time or place changes. */
// Defaults are stripped first: a partial update must never reset fields the admin didn't send.
export const adminEventUpdate = eventChecks(eventFields.omit({ categoryKey: true, interestIds: true })
  .extend({ isOnline: z.boolean(), preEventMatching: z.boolean(), chatEnabled: z.boolean(), visibility: z.enum(['public', 'unlisted', 'premium_only']) })
  .partial().extend({
    ...ticketPrice, changeNote: z.string().trim().max(500).optional(),
    // null clears the value (unlimited capacity, no venue / coordinates / age bound).
    capacity: z.number().int().min(2).max(10000).nullable().optional(), venueName: z.string().trim().max(200).nullable().optional(), venueAddress: z.string().trim().max(400).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(), minAge: z.number().int().min(18).max(99).nullable().optional(), maxAge: z.number().int().min(18).max(120).nullable().optional(),
  }))
  .refine((e) => Object.keys(e).some((k) => k !== 'changeNote'), { message: 'Nothing to update' });

export const eventRegister = z.object({ openToMeet: z.boolean().default(true), successUrl: z.url().optional(), cancelUrl: z.url().optional() });
/** userId may be omitted: the code alone identifies the attendee (asked for only if two codes collide). */
export const eventCheckIn = z.object({ userId: uuid.optional(), code: z.string().regex(/^[A-Z0-9]{6}$/) });
export const eventFeedback = z.object({
  rating: z.number().int().min(1).max(5), metSomeone: z.boolean().optional(), feltSafe: z.boolean().optional(), wouldAttendAgain: z.boolean().optional(), comment: z.string().trim().max(2000).optional(),
});
export const adminEventDecision = z.object({ decision: z.enum(['publish', 'reject', 'cancel']), note: z.string().max(1000).optional() });

// ------------------------------------------------------------------ dates

export const datePlanCreate = z.object({
  matchId: uuid,
  title: z.string().trim().min(1).max(120),
  activityType: z.string().trim().min(1).max(50),
  stageKey: z.string().max(50).optional(),
  budgetKey: z.string().max(50).optional(),
  notes: z.string().trim().max(1000).optional(),
  venueName: z.string().trim().max(200).optional(),
  venueAddress: z.string().trim().max(400).optional(),
  venueProvider: z.string().max(50).optional(),
  venuePlaceId: z.string().max(200).optional(),
  cityId: uuid.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  startsAt: z.iso.datetime(),
  expectedDurationMin: z.number().int().min(15).max(1440).default(90),
  aiGenerated: z.boolean().default(false),
});
export const datePlanRespond = z.object({ response: z.enum(["accepted", "declined"]) });
export const datePlanUpdate = datePlanCreate.omit({ matchId: true, aiGenerated: true }).partial();
export const dateFeedbackCreate = z.object({
  dateHappened: z.boolean(),
  overall: z.number().int().min(1).max(5).optional(),
  feltSafe: z.boolean().optional(),
  matchedProfile: z.boolean().optional(),
  wantSecondDate: z.enum(['yes', 'maybe', 'no']).optional(),
  tags: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(10).default([]),
  privateNote: z.string().trim().max(2000).optional(),
  raiseSafetyConcern: z.boolean().default(false),
});
export const dateIdeasQuery = z.object({ matchId: uuid.optional(), stageKey: z.string().max(50).optional(), budgetKey: z.string().max(50).optional(), timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'night']).optional(), indoor: queryBool.optional() });
export const aiDatePlanRequest = z.object({ matchId: uuid, stageKey: z.string().max(50).optional(), budgetKey: z.string().max(50).optional(), time: z.string().max(100).optional(), notes: z.string().max(500).optional() });

// ------------------------------------------------------------------ date safety

export const trustedContactCreate = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().regex(/^\+[1-9][0-9]{6,14}$/).optional(),
  email: z.email().max(254).optional(),
  relationship: z.string().max(50).optional(),
}).refine((c) => c.phone || c.email, { message: 'phone or email required', path: ['phone'] });

export const safetySessionStart = z.object({
  datePlanId: uuid.optional(),
  trustedContactId: uuid.optional(),
  startsAt: z.iso.datetime(),
  checkInAfterMin: z.number().int().min(15).max(24 * 60),
  graceMinutes: z.number().int().min(5).max(120).default(15),
  shareDetails: z.boolean().default(true),
  shareLiveLocation: z.boolean().default(false),
});
export const safetyLocationPing = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(10000).optional() });
export const safetySos = safetyLocationPing.partial();

// ------------------------------------------------------------------ calls & couple space

export const callStart = z.object({ kind: z.enum(['voice', 'video']) });
