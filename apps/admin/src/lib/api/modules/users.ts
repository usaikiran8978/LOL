import type { adminGrant, adminUserAction, adminUserSearch, Page } from '@amora/shared';
import type { z } from 'zod';
import type { ApiClient } from '../client';

/*
 * Response shapes mirror apps/api/src/modules/safety/safety-admin.controller.ts (AdminUsersController) and
 * apps/api/src/modules/billing/billing.controller.ts (`GET admin/billing/users/:id`). `@amora/shared` only defines
 * the request contracts for these endpoints.
 */

type In<T extends z.ZodType> = z.input<T>;

export type UserStatus = NonNullable<z.infer<typeof adminUserSearch>['status']>;
export type UserActionKind = z.infer<typeof adminUserAction>['action'];
export interface UserSearchQuery { q?: string; status?: UserStatus; country?: string; verified?: boolean; cursor?: string; limit?: number }

/** Search row. Without `users.view_pii` the API masks `email`/`phone_e164` (e.g. "a•••@x.com", "•••123"). */
export interface UserSearchRow {
  id: string;
  email: string | null;
  phone_e164: string | null;
  status: UserStatus;
  country_code: string | null;
  created_at: string;
  last_active_at: string | null;
  display_name: string | null;
  verification_level: string | null;
  is_discoverable: boolean | null;
}

export interface UserProfileRow {
  user_id: string;
  display_name: string;
  bio: string | null;
  profession: string | null;
  employer: string | null;
  school: string | null;
  home_country_code: string | null;
  completeness_score: number;
  incognito: boolean;
  is_discoverable: boolean;
  moderation_status: string;
  verification_level: string;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSessionRow {
  id: string;
  created_at: string;
  last_used_at: string | null;
  platform: string | null;
  model: string | null;
  app_version: string | null;
}

export interface UserRestrictionRow {
  id: string;
  kind: string;
  action_id: string | null;
  starts_at: string;
  ends_at: string | null;
  lifted_at: string | null;
}

export interface UserVerificationRow {
  id: string;
  kind: string;
  status: string;
  submitted_at: string;
  decided_at: string | null;
  expires_at: string | null;
}

export interface UserSafetyHistory {
  cases: Array<{ id: string; category: string; severity: string; status: string; opened_at: string }>;
  actions: Array<{ id: string; action: string; reason_key: string; created_at: string; reversed_at: string | null }>;
  riskScore: { score: number; components: unknown; computed_at: string } | null;
}

export interface UserDetail {
  id: string;
  email: string | null;
  phone_e164: string | null;
  status: UserStatus;
  status_reason: string | null;
  status_until: string | null;
  country_code: string | null;
  locale: string;
  created_at: string;
  last_login_at: string | null;
  last_active_at: string | null;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  /** Null without `users.view_pii`. */
  date_of_birth: string | null;
  profile: UserProfileRow | null;
  sessions: UserSessionRow[];
  restrictions: UserRestrictionRow[];
  verification: UserVerificationRow[];
  counts: { reportsAgainst: number; reportsBy: number; matches: number };
  /** Null unless the admin holds `users.view_safety_history`. */
  safety: UserSafetyHistory | null;
}

export interface UserLocation {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  geohash7: string;
  source: string;
  captured_at: string;
}

export interface UserSubscriptionRow {
  id: string;
  provider: string;
  status: string;
  product_id: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  trial_end: string | null;
  created_at: string;
}

export interface UserEntitlementRow {
  id: string;
  entitlement_key: string;
  source_type: string;
  source_id: string | null;
  limit_value: number | null;
  limit_period: string | null;
  starts_at: string;
  ends_at: string | null;
  revoked_at: string | null;
}

export interface UserPaymentRow {
  id: string;
  provider: string;
  kind: string;
  productKey: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  refundedMinor: number;
  receiptUrl: string | null;
  at: string;
}

export interface UserBalanceRow {
  item_key: string;
  balance: number;
  updated_at: string;
}

export interface UserBilling {
  subscriptions: UserSubscriptionRow[];
  payments: UserPaymentRow[];
  entitlements: UserEntitlementRow[];
  balances: UserBalanceRow[];
  ledger: Array<{ id: string; item_key: string; delta: number; reason: string; ref_id: string | null; created_at: string }>;
}

const enc = encodeURIComponent;

/** `verified` is only sent when true: the API parses it with z.coerce.boolean(), so "false" would mean true. */
function searchParams(q: UserSearchQuery) {
  return { q: q.q, status: q.status, country: q.country, verified: q.verified ? 'true' : undefined, cursor: q.cursor, limit: q.limit };
}

/** Typed wrappers for the users admin endpoints. */
export function usersApi(c: ApiClient) {
  return {
    search: (q: UserSearchQuery) => c.get<Page<UserSearchRow>>('/admin/users', searchParams(q)),
    detail: (id: string) => c.get<UserDetail>(`/admin/users/${enc(id)}`),
    /** Precise location for an incident investigation; the API requires the moderation case id and logs the access. */
    location: (id: string, caseId: string) => c.get<UserLocation | null>(`/admin/users/${enc(id)}/location`, { caseId }),
    action: (id: string, body: In<typeof adminUserAction>) => c.post<{ ok: true } | { actionId: string }>(`/admin/users/${enc(id)}/actions`, body),
    exportCsv: (q: Omit<UserSearchQuery, 'cursor' | 'limit'>) => c.getText('/admin/users/export/csv', searchParams(q)),
    billing: (id: string) => c.get<UserBilling>(`/admin/billing/users/${enc(id)}`),
    grant: (body: In<typeof adminGrant>) => c.post<void>('/admin/billing/grants', body),
  };
}
