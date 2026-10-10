import { BILLING_PROVIDERS, ENTITLEMENT_KEYS } from '@amora/shared';
import type { Option } from '@/components/ui/fields';
import { t, tDynamic } from '@/i18n';
import { formatNumber } from '@/lib/format';

/** Enum values from the billing API → localized labels (unknown values fall back to the raw value). */
export const entitlementLabel = (key: string) => tDynamic(`billing.entitlementKeys.${key}`, key);
export const kindLabel = (kind: string) => tDynamic(`billing.kinds.${kind}`, kind);
export const tierLabel = (tier: string | null) => (tier ? tDynamic(`billing.tiers.${tier}`, tier) : '—');
export const periodLabel = (period: string | null) => (period ? tDynamic(`billing.periods.${period}`, period) : t('billing.noPeriod'));
export const intervalLabel = (interval: string) => tDynamic(`billing.intervals.${interval}`, interval);
export const providerLabel = (provider: string) => tDynamic(`billing.providers.${provider}`, provider);
export const itemLabel = (item: string) => tDynamic(`billing.items.${item}`, item);
export const limitLabel = (limit: number | null | undefined) => (limit === null || limit === undefined ? t('billing.unlimited') : formatNumber(limit, 0));

export const PRODUCT_KINDS = ['subscription', 'consumable', 'event_ticket'] as const;
export const PRODUCT_TIERS = ['premium', 'ai_premium', 'premium_plus'] as const;
export const LIMIT_PERIODS = ['day', 'week', 'month'] as const;
export const BILLING_INTERVALS = ['week', 'month', 'year'] as const;
export const CONSUMABLE_ITEMS = ['boost', 'super_like', 'spotlight'] as const;
export const DISCOUNT_TYPES = ['percent', 'amount', 'free_trial_days', 'grant_entitlement'] as const;

export const entitlementOptions = (keys: readonly string[] = ENTITLEMENT_KEYS): Option[] => keys.map((k) => ({ value: k, label: entitlementLabel(k) }));
export const kindOptions = (): Option[] => PRODUCT_KINDS.map((k) => ({ value: k, label: kindLabel(k) }));
export const tierOptions = (): Option[] => PRODUCT_TIERS.map((k) => ({ value: k, label: tierLabel(k) }));
export const periodOptions = (): Option[] => LIMIT_PERIODS.map((k) => ({ value: k, label: periodLabel(k) }));
export const intervalOptions = (): Option[] => BILLING_INTERVALS.map((k) => ({ value: k, label: intervalLabel(k) }));
export const providerOptions = (): Option[] => BILLING_PROVIDERS.map((k) => ({ value: k, label: providerLabel(k) }));
export const itemOptions = (): Option[] => CONSUMABLE_ITEMS.map((k) => ({ value: k, label: itemLabel(k) }));
export const discountOptions = (): Option[] => DISCOUNT_TYPES.map((k) => ({ value: k, label: tDynamic(`billing.coupons.types.${k}`, k) }));

/** Comma/newline separated ISO country codes → upper-cased list, or null for "all countries". */
export function countryList(text: string): string[] | null {
  const list = text.split(/[,\n]/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  return list.length ? list : null;
}

/** Postgres jsonb may come back as a JSON string depending on the driver path; normalise to an object. */
export function overridesOf(value: Record<string, number | null> | string | null | undefined): Record<string, number | null> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, number | null>) : {};
    } catch {
      return {};
    }
  }
  return value;
}

let seq = 0;
/** Stable React keys for editable rows that have no server id. */
export const rowId = () => `row-${++seq}`;
