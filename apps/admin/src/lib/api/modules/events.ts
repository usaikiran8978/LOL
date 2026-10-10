import { adminEventCreate, type adminEventDecision, type adminEventUpdate, type eventCheckIn, type Page } from '@amora/shared';
import type { z } from 'zod';
import type { ApiClient } from '../client';

type In<T extends z.ZodType> = z.input<T>;
const enc = encodeURIComponent;

export type EventStatus = 'draft' | 'pending_review' | 'published' | 'cancelled' | 'completed' | 'rejected';
export const EVENT_STATUSES: readonly EventStatus[] = ['draft', 'pending_review', 'published', 'cancelled', 'completed', 'rejected'];
export type EventOrganizerType = 'platform' | 'user' | 'partner';

/** Admin create body (`eventCreate` + ticket price), shared with the API. */
export { adminEventCreate };

/** Row shape of EventsService.adminList (apps/api/src/modules/events/events.service.ts). */
export interface AdminEventRow {
  id: string;
  title: string;
  status: EventStatus;
  organizer_type: EventOrganizerType;
  organizer_user_id: string | null;
  starts_at: string;
  ends_at: string;
  /** Null = unlimited. */
  capacity: number | null;
  /** Postgres bigint — may arrive as a string. 0 = free. */
  price_minor: number | string;
  currency: string | null;
  moderation_note: string | null;
  city: string;
  country_code: string;
  /** Registered + checked in. */
  registered_count: number;
  waitlist_count: number;
  checked_in_count: number;
}

export type EventVisibility = 'public' | 'unlisted' | 'premium_only';

/** `GET admin/events/:id` (EventsService.adminDetail): the event row (snake_case columns) plus city, category and interests. */
export interface AdminEventDetail {
  id: string;
  title: string;
  description: string;
  status: EventStatus;
  organizer_type: EventOrganizerType;
  organizer_user_id: string | null;
  category_key: string | null;
  city_id: string;
  city: string;
  country_code: string;
  venue_name: string | null;
  venue_address: string | null;
  /** Postgres numeric — may arrive as a string. */
  latitude: number | string | null;
  longitude: number | string | null;
  is_online: boolean;
  starts_at: string;
  ends_at: string;
  timezone: string;
  capacity: number | null;
  min_age: number | null;
  max_age: number | null;
  visibility: EventVisibility;
  pre_event_matching: boolean;
  chat_enabled: boolean;
  price_minor: number | string;
  currency: string | null;
  moderation_note: string | null;
  interest_ids: string[];
}

export type AttendeeStatus = 'registered' | 'checked_in' | 'waitlisted';

/** Entry of `GET admin/events/:id/attendees` (EventsService.roster): everyone registered, checked in or waitlisted. */
export interface RosterEntry {
  userId: string;
  displayName: string | null;
  verificationLevel: string | null;
  status: AttendeeStatus;
  checkedInAt: string | null;
  registeredAt: string;
}

/** Typed wrappers for the events admin endpoints. */
export function eventsApi(c: ApiClient) {
  return {
    /** Ordered by start time, limited to the admin's country scope. */
    list: (q: { status?: EventStatus; cursor?: string; limit?: number }) => c.get<Page<AdminEventRow>>('/admin/events', { ...q }),
    detail: (id: string) => c.get<AdminEventDetail>(`/admin/events/${enc(id)}`),
    create: (body: In<typeof adminEventCreate>) => c.post<{ id: string }>('/admin/events', body),
    /** Partial update; attendees are notified when a published event's time or place changes. */
    update: (id: string, body: In<typeof adminEventUpdate>) => c.put<{ id: string }>(`/admin/events/${enc(id)}`, body),
    attendees: (id: string) => c.get<RosterEntry[]>(`/admin/events/${enc(id)}/attendees`),
    decide: (id: string, body: In<typeof adminEventDecision>) => c.post<void>(`/admin/events/${enc(id)}/decision`, body),
    /** `userId` is optional: the code alone identifies the attendee unless two codes collide (`details.ambiguous`). */
    checkIn: (id: string, body: In<typeof eventCheckIn>) => c.post<void>(`/admin/events/${enc(id)}/check-in`, body),
  };
}
