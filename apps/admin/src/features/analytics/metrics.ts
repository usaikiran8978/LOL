import { locale, t, tDynamic } from '@/i18n';
import type { KpiUnit } from '@/lib/api/modules/dashboard';
import { formatMoney, formatNumber, formatPercent } from '@/lib/format';

/**
 * KPI catalog mirrored from `KPI_DEFINITIONS` + `compute()` in apps/api/src/modules/analytics/metrics.service.ts.
 * The API exposes the catalog only inside `GET /admin/analytics/dashboard` (dashboard.view), not to analytics.view
 * holders, so the explorer keeps a local copy (reported as a contract gap). `dimension` records which breakdowns
 * `compute()` writes besides 'all': country metrics also have 'country:XX' rows; currency metrics ONLY have
 * 'currency:XXX' rows (money in different currencies is not additive).
 */
export const KPI_CATALOG: ReadonlyArray<{ key: string; unit: KpiUnit; dimension: 'country' | 'currency' | null }> = [
  { key: 'registrations', unit: 'count', dimension: 'country' },
  { key: 'profile_completion_rate', unit: 'ratio', dimension: 'country' },
  { key: 'verification_rate', unit: 'ratio', dimension: 'country' },
  { key: 'questionnaire_completion', unit: 'ratio', dimension: 'country' },
  { key: 'dau', unit: 'count', dimension: 'country' },
  { key: 'mau', unit: 'count', dimension: 'country' },
  { key: 'discovery_engagement', unit: 'count', dimension: 'country' },
  { key: 'likes', unit: 'count', dimension: 'country' },
  { key: 'like_pass_ratio', unit: 'ratio', dimension: 'country' },
  { key: 'matches', unit: 'count', dimension: 'country' },
  { key: 'match_rate', unit: 'ratio', dimension: null },
  { key: 'conversation_start_rate', unit: 'ratio', dimension: null },
  { key: 'messages_per_conversation', unit: 'score', dimension: null },
  { key: 'reply_rate', unit: 'ratio', dimension: null },
  { key: 'dates_planned', unit: 'count', dimension: null },
  { key: 'date_conversion', unit: 'ratio', dimension: null },
  { key: 'post_date_satisfaction', unit: 'score', dimension: null },
  { key: 'retention_d1', unit: 'ratio', dimension: null },
  { key: 'retention_d7', unit: 'ratio', dimension: null },
  { key: 'retention_d30', unit: 'ratio', dimension: null },
  { key: 'churn', unit: 'ratio', dimension: null },
  { key: 'premium_users', unit: 'count', dimension: null },
  { key: 'premium_conversion', unit: 'ratio', dimension: null },
  { key: 'revenue', unit: 'minor_currency', dimension: 'currency' },
  { key: 'arpu', unit: 'minor_currency', dimension: 'currency' },
  { key: 'arppu', unit: 'minor_currency', dimension: 'currency' },
  { key: 'reports', unit: 'count', dimension: null },
  { key: 'report_rate', unit: 'score', dimension: null },
  { key: 'moderation_sla', unit: 'ratio', dimension: null },
  { key: 'moderation_resolution_hours', unit: 'hours', dimension: null },
  { key: 'safety_incidents', unit: 'count', dimension: null },
  { key: 'event_attendance', unit: 'ratio', dimension: null },
  { key: 'ai_requests', unit: 'count', dimension: null },
  { key: 'ai_recommendation_acceptance', unit: 'ratio', dimension: null },
];

export function metricLabel(key: string, fallback?: string): string {
  return tDynamic(`analytics.metrics.${key}`, fallback ?? key);
}

/** Human label for a stored dimension ('all', 'country:US', 'currency:EUR'). */
export function dimensionLabel(dimension: string): string {
  if (dimension === 'all') return t('analytics.dimensions.all');
  const [kind, code] = dimension.split(':');
  if (kind === 'country' && code) return `${t('analytics.dimensions.country')}: ${code}`;
  if (kind === 'currency' && code) return code;
  return dimension;
}

/** Formats a KPI value by unit; money values take their currency from a 'currency:XXX' dimension. */
export function formatMetricValue(value: number | null | undefined, unit: KpiUnit, dimension = 'all'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  switch (unit) {
    case 'count':
      return formatNumber(value, 0);
    case 'ratio':
      return formatPercent(value);
    case 'minor_currency': {
      const currency = dimension.startsWith('currency:') ? dimension.slice('currency:'.length) : null;
      return currency ? formatMoney(Math.round(value), currency) : formatNumber(value, 0);
    }
    case 'hours':
      return t('analytics.units.hours', { value: formatNumber(value, 1) });
    default:
      return formatNumber(value, 2);
  }
}

/** Compact axis labels. Money axes with several currencies show major units without a symbol (dashboard currencies all use 2 decimals). */
export function formatAxisValue(value: number, unit: KpiUnit, dimension = 'all'): string {
  if (unit === 'ratio') return formatPercent(value, 0);
  if (unit === 'minor_currency') {
    if (dimension.startsWith('currency:')) return formatMetricValue(value, unit, dimension);
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value / 100);
  }
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: unit === 'count' ? 1 : 2 }).format(value);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Current UTC calendar day (metrics are computed per UTC day). */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** Inclusive day count between two YYYY-MM-DD values. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
