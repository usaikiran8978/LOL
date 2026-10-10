import type { datePlanCreate, eventCheckIn, eventRegister, safetySessionStart } from '@amora/shared';
import type { z } from 'zod';
import { client } from './index';

type In<T extends z.ZodType> = z.input<T>;

// Shapes mirror apps/api/src/modules/events/events.service.ts and dates/dates.service.ts.

export type AttendeeStatus = 'interested' | 'registered' | 'waitlisted' | 'cancelled' | 'checked_in' | 'no_show' | 'removed';
export type EventStatus = 'draft' | 'pending_review' | 'published' | 'cancelled' | 'completed' | 'rejected';

export interface EventListItem {
  id: string;
  title: string;
  category: { key: string; label: string };
  city: string;
  countryCode: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  isOnline: boolean;
  capacity: number | null;
  attending: number;
  spotsLeft: number | null;
  price: { amountMinor: number; currency: string } | null;
  preEventMatching: boolean;
  status: EventStatus;
  myStatus: AttendeeStatus | null;
  fit: number | null;
  sharedInterestCount: number;
}

export interface EventDetail {
  id: string;
  title: string;
  description: string;
  /** Category key (the list returns {key,label}; the detail only the key). */
  category: string;
  city: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  isOnline: boolean;
  status: EventStatus;
  capacity: number | null;
  attending: number;
  spotsLeft: number | null;
  price: { amountMinor: number; currency: string } | null;
  preEventMatching: boolean;
  chatEnabled: boolean;
  venue: { name: string | null; address: string | null };
  isOrganizer: boolean;
  myStatus: AttendeeStatus | null;
  myCheckInCode: string | null;
  conversationId: string | null;
  moderationNote: string | null;
}

/** Organizer roster row (`GET /events/:id/attendees` for the event's organizer: everyone registered, waitlisted or in). */
export interface RosterEntry {
  userId: string;
  displayName: string | null;
  /** none | selfie | identity */
  verificationLevel: string;
  status: Extract<AttendeeStatus, 'registered' | 'waitlisted' | 'checked_in'>;
  checkedInAt: string | null;
  registeredAt: string | null;
}

export type CheckoutOutcome = 'success' | 'cancel';
/** Paid-ticket return links. The API only accepts origins in CHECKOUT_RETURN_ORIGINS (default includes `amora://`). */
export function checkoutReturnUrls(eventId: string): { successUrl: string; cancelUrl: string } {
  const base = `amora://events/${encodeURIComponent(eventId)}`;
  return { successUrl: `${base}?checkout=success`, cancelUrl: `${base}?checkout=cancel` };
}
/** `success` / `cancel` from a checkout return link, or null for anything else. */
export function checkoutOutcome(url: string | null | undefined): CheckoutOutcome | null {
  const m = /[?&]checkout=(success|cancel)(?:&|#|$)/.exec(url ?? '');
  return m ? (m[1] as CheckoutOutcome) : null;
}

export type RegisterResult = { status: 'registered'; checkInCode: string } | { status: 'waitlisted'; checkInCode: null } | { status: 'payment_required'; checkoutUrl: string };

export type DatePlanStatus = 'draft' | 'proposed' | 'accepted' | 'declined' | 'rescheduled' | 'cancelled' | 'completed';
export type DateResponse = 'pending' | 'accepted' | 'declined' | 'proposed_change';
export interface DatePlan {
  id: string;
  matchId: string;
  status: DatePlanStatus;
  proposedBy: string;
  title: string;
  activityType: string;
  stage: string | null;
  budget: string | null;
  notes: string | null;
  venue: { name: string | null; address: string | null; provider: string | null; placeId: string | null; city: string | null; latitude: number | null; longitude: number | null };
  startsAt: string;
  expectedDurationMin: number;
  aiGenerated: boolean;
  myResponse: DateResponse;
  reminders: number[];
  participants: Array<{ userId: string; response: DateResponse }>;
}

export interface DateIdea {
  key: string;
  title: string;
  description: string;
  activityType: string;
  budget: string | null;
  indoor: boolean;
  durationMin: number;
  sharedInterestMatch: number;
}

export const eventsApi = {
  list: (q: { mine?: boolean; cursor?: string }) => client.get<{ items: EventListItem[]; nextCursor: string | null }>('/events', { query: { mine: q.mine || undefined, cursor: q.cursor, limit: 20 } }),
  get: (id: string) => client.get<EventDetail>(`/events/${encodeURIComponent(id)}`),
  register: (id: string, b: In<typeof eventRegister>) => client.post<RegisterResult>(`/events/${encodeURIComponent(id)}/registration`, b),
  unregister: (id: string) => client.delete(`/events/${encodeURIComponent(id)}/registration`),
  /** Organizer: the full roster. (Attendees get only others open to meeting, in a smaller shape.) */
  roster: (id: string) => client.get<RosterEntry[]>(`/events/${encodeURIComponent(id)}/attendees`),
  /** Organizer: `{ code }` alone; `{ userId, code }` only after a 400 with `details.ambiguous`. */
  checkIn: (id: string, b: In<typeof eventCheckIn>) => client.post<void>(`/events/${encodeURIComponent(id)}/check-in`, b),
};

export const datesApi = {
  ideas: (matchId?: string) => client.get<DateIdea[]>('/dates/ideas', { query: { matchId } }),
  forMatch: (matchId: string) => client.get<DatePlan[]>(`/dates/match/${encodeURIComponent(matchId)}`),
  get: (id: string) => client.get<DatePlan>(`/dates/${encodeURIComponent(id)}`),
  create: (b: In<typeof datePlanCreate>) => client.post<DatePlan>('/dates', b),
  respond: (id: string, response: 'accepted' | 'declined') => client.post<DatePlan>(`/dates/${encodeURIComponent(id)}/response`, { response }),
  cancel: (id: string) => client.delete(`/dates/${encodeURIComponent(id)}`),
  aiIdeas: (matchId: string) => client.post<AiDateIdeas>('/dates/ideas/ai', { matchId }),
};

export interface AiDateIdeas {
  ideas: Array<{ title: string; description: string; activityType: string; budgetTier: 'free' | 'low' | 'medium' | 'high'; durationMin: number; safetyTip: string }>;
  note: string;
}

export type SafetySessionStart = In<typeof safetySessionStart>;
