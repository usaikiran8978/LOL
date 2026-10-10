import type { ApiClient } from '../client';

/*
 * Response shapes mirror apps/api/src/modules/analytics/metrics.service.ts `dashboard()` — `@amora/shared` defines no
 * response contract for it.
 */

export type KpiUnit = 'count' | 'ratio' | 'minor_currency' | 'hours' | 'score';

export interface KpiDefinition {
  /** Developer-facing English label from the API; the console shows `analytics.metrics.<key>` instead. */
  label: string;
  unit: KpiUnit;
}

/** Live counters computed at request time (all integers). */
export interface DashboardLive {
  total_users: number;
  active_users: number;
  premium: number;
  open_cases: number;
  breached: number;
}

/** One daily value. `dimension` is 'all' or 'currency:XXX' (USD/EUR/INR/GBP) on the dashboard. */
export interface DashboardPoint {
  date: string;
  dimension: string;
  value: number;
}

export interface DashboardResponse {
  definitions: Record<string, KpiDefinition>;
  live: DashboardLive | undefined;
  /** Keyed by metric; metrics without computed rows in the window are absent. */
  series: Record<string, DashboardPoint[]>;
}

/** Typed wrappers for the dashboard admin endpoints. */
export function dashboardApi(c: ApiClient) {
  return {
    /** `GET /admin/analytics/dashboard` (dashboard.view); `days` 1–365, default 30 server-side. */
    get: (days: number) => c.get<DashboardResponse>('/admin/analytics/dashboard', { days }),
  };
}
