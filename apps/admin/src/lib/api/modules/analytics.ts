import type { ApiClient } from '../client';

/*
 * Response shapes mirror apps/api/src/modules/analytics/{analytics.controller,metrics.service,experiments.service}.ts.
 * `@amora/shared` defines no analytics/experiment request or response contracts (the experiment body schema lives
 * only in the controller); the console mirrors it in features/analytics/experimentSchema.ts.
 */

/** `analytics_daily_metrics` row; `value` is a Postgres numeric, serialized as a string. */
export interface MetricPoint {
  metric_date: string;
  value: string;
}

export interface SeriesQuery {
  from: string;
  to: string;
  /** 'all', 'country:XX' or 'currency:XXX' (API regex `^[a-z]+(:[A-Za-z0-9_]+)?$`). */
  dimension: string;
}

export const EXPERIMENT_SURFACES = ['matching', 'profile_layout', 'onboarding', 'questionnaire', 'paywall', 'discovery', 'ai', 'notifications', 'other'] as const;
export type ExperimentSurface = (typeof EXPERIMENT_SURFACES)[number];
export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'archived';
export type ExperimentTransition = 'running' | 'paused' | 'completed' | 'archived';

export interface ExperimentVariantRow {
  id: string;
  experiment_id: string;
  key: string;
  allocation: number;
  config: Record<string, unknown>;
  is_control: boolean;
}

/** `GET /admin/analytics/experiments` returns the `experiments` row plus its variants (no segment key, only the id). */
export interface ExperimentRow {
  id: string;
  key: string;
  surface: ExperimentSurface;
  hypothesis: string | null;
  status: ExperimentStatus;
  segment_id: string | null;
  traffic_pct: number;
  primary_metric: string;
  started_at: string | null;
  ended_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  variants: ExperimentVariantRow[];
}

export interface ExperimentUpsertBody {
  surface: ExperimentSurface;
  hypothesis?: string;
  segmentKey?: string | null;
  trafficPct: number;
  primaryMetric: string;
  variants: Array<{ key: string; allocation: number; isControl?: boolean; config?: Record<string, unknown> }>;
}

/** Two-proportion z-test vs control (apps/api/src/modules/analytics/stats.ts). All null when either arm is empty. */
export interface SignificanceTest {
  /** Relative lift (pB - pA) / pA; null when the control rate is 0. */
  lift: number | null;
  z: number | null;
  pValue: number | null;
  /** 95% CI of the absolute difference in conversion rate (variant - control). */
  ci95: [number, number] | null;
}

export interface VariantResult {
  key: string;
  isControl: boolean;
  allocation: number;
  assigned: number;
  converted: number;
  rate: number | null;
  vsControl: SignificanceTest | null;
}

export interface ExperimentResults {
  key: string;
  status: ExperimentStatus;
  surface: ExperimentSurface;
  primaryMetric: string;
  startedAt: string | null;
  endedAt: string | null;
  variants: VariantResult[];
}

const enc = encodeURIComponent;

/** Typed wrappers for the analytics admin endpoints. */
export function analyticsApi(c: ApiClient) {
  return {
    /** analytics.view; 404 NOT_FOUND for unknown metrics. */
    series: (metric: string, q: SeriesQuery) => c.get<MetricPoint[]>(`/admin/analytics/metrics/${enc(metric)}`, { ...q }),
    /** analytics.export; every metric/dimension in the range as `date,metric,dimension,value` (audited server-side). */
    exportCsv: (q: { from: string; to: string }) => c.getText('/admin/analytics/export.csv', q),
    /** analytics.export; recomputes one UTC day of KPIs (204). */
    recompute: (day: string) => c.post<void>(`/admin/analytics/recompute/${enc(day)}`),
    experiments: () => c.get<ExperimentRow[]>('/admin/analytics/experiments'),
    /** experiments.manage; drafts only (VERSION_IMMUTABLE otherwise). */
    upsertExperiment: (key: string, body: ExperimentUpsertBody) => c.put<{ id: string }>(`/admin/analytics/experiments/${enc(key)}`, body),
    /** experiments.manage; 409 CONFLICT for a transition the current status does not allow. */
    transitionExperiment: (key: string, to: ExperimentTransition) => c.post<void>(`/admin/analytics/experiments/${enc(key)}/${to}`),
    experimentResults: (key: string) => c.get<ExperimentResults>(`/admin/analytics/experiments/${enc(key)}/results`),
  };
}
