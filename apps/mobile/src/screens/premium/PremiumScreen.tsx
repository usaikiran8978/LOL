import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { analytics } from '../../analytics';
import { isApiError } from '../../api';
import { billingApi, type ProductPrice } from '../../api/billing';
import { platformName } from '../../auth/device';
import { Badge, Button, FormError, ListItem, Notice, Screen, Text } from '../../components';
import { useConfig, useFlag } from '../../config/ConfigProvider';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatDate, formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';
import { humanizeKey } from '../../utils/text';

/**
 * Store purchases require a native in-app purchase module (StoreKit / Play Billing) whose transactions are then sent
 * to the API for receipt validation. That module is not part of this build, so buying is disabled with an explicit
 * message — a purchase is never simulated. Everything else (plans, prices, entitlements, store management) is live.
 */
export const STORE_PURCHASES_AVAILABLE = false;

export function formatPrice(p: Pick<ProductPrice, 'amountMinor' | 'currency'>): string {
  return formatNumber(p.amountMinor / 100, { style: 'currency', currency: p.currency });
}

export default function PremiumScreen() {
  const { t } = useTranslation();
  const { spacing, colors, radius } = useTheme();
  const { surface, entitlement } = useLocalSearchParams<{ surface?: string; entitlement?: string }>();
  const enabled = useFlag('subscriptions');
  const { config } = useConfig();
  const platform = platformName();
  const me = useResource(billingApi.me);
  const products = useResource(() => billingApi.products(platform), [platform], enabled);
  /** Google Play subscriptions the server re-checked on the last restore (null = not restored yet). */
  const [restored, setRestored] = useState<number | null>(null);
  const variant = config?.experiments?.paywall_layout?.variant ?? config?.experiments?.paywall?.variant ?? null;

  useEffect(() => {
    analytics.track('paywall_viewed', { surface: surface ?? 'direct', entitlement: entitlement ?? null, variant });
  }, [surface, entitlement, variant]);

  const restore = useAction(async () => {
    const { refreshed, ...billing } = await billingApi.restore();
    me.setData(billing);
    setRestored(refreshed);
  });

  const m = me.data;
  const subs = m?.subscriptions.filter((s) => ['trialing', 'active', 'past_due', 'in_grace', 'paused'].includes(s.status)) ?? [];
  const productsDisabled = isApiError(products.error, 'FEATURE_DISABLED') || !enabled;
  const plans = (products.data ?? []).slice().sort((a, b) => a.rank - b.rank);
  const grouped = plans.reduce<Record<string, ProductPrice[]>>((acc, p) => ({ ...acc, [p.productKey]: [...(acc[p.productKey] ?? []), p] }), {});

  return (
    <Screen title={t('premium.title')} subtitle={t('premium.intro')} status={m ? 'ready' : me.status} error={me.error} onRetry={me.reload} testID="premium-screen">
      {entitlement ? <Notice tone="warning" title={t('premium.neededFor')} body={t(`premium.entitlements.${entitlement}`, { defaultValue: humanizeKey(entitlement) })} testID="premium-needed" /> : null}

      <Text variant="heading" style={{ marginBottom: spacing.sm }}>
        {t('premium.yourPlan')}
      </Text>
      {subs.length ? (
        subs.map((s) => (
          <View key={s.id} testID={`subscription-${s.id}`} style={{ marginBottom: spacing.md }}>
            <ListItem label={humanizeKey(s.productKey)} value={t(`premium.subStatus.${s.status}`)} description={s.renewsAt ? t(s.cancelAtPeriodEnd ? 'premium.endsOn' : 'premium.renewsOn', { date: formatDate(s.renewsAt) }) : undefined} />
            {s.manageUrl ? <Button variant="ghost" label={t('premium.manage')} onPress={() => void Linking.openURL(s.manageUrl!)} testID={`manage-${s.id}`} /> : null}
          </View>
        ))
      ) : (
        <Text color="textMuted" style={{ marginBottom: spacing.md }} testID="premium-free">
          {t('premium.free')}
        </Text>
      )}
      {m?.entitlements.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }} testID="premium-entitlements">
          {m.entitlements.map((e) => (
            <Badge key={e} tone="success" label={t(`premium.entitlements.${e}`, { defaultValue: humanizeKey(e) })} />
          ))}
        </View>
      ) : null}
      {m
        ? Object.entries(m.allowances).map(([k, a]) =>
            a ? <ListItem key={k} label={t(`premium.allowances.${k}`, { defaultValue: humanizeKey(k) })} value={a.unlimited ? t('premium.unlimited') : t('premium.remaining', { remaining: formatNumber(a.remaining ?? 0), limit: formatNumber(a.limit ?? 0) })} description={a.resetsAt ? t('premium.resets', { date: formatDate(a.resetsAt) }) : undefined} /> : null,
          )
        : null}

      <Text variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        {t('premium.plans')}
      </Text>
      {productsDisabled ? (
        <Notice title={t('premium.unavailable')} testID="premium-unavailable" />
      ) : products.status === 'error' ? (
        <View>
          <FormError error={products.error} />
          <Button variant="secondary" label={t('common.retry')} onPress={products.reload} />
        </View>
      ) : products.status === 'loading' && !products.data ? (
        <Text color="textMuted">{t('common.loading')}</Text>
      ) : plans.length === 0 ? (
        <Notice title={t('premium.noPlans')} testID="premium-no-plans" />
      ) : (
        <View>
          {!STORE_PURCHASES_AVAILABLE ? <Notice tone="warning" title={t('premium.storeUnavailableTitle')} body={t('premium.storeUnavailableBody')} testID="premium-store-unavailable" /> : null}
          {Object.entries(grouped).map(([key, prices]) => (
            <View key={key} testID={`plan-${key}`} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
              <Text variant="heading">{prices[0]!.name}</Text>
              {prices[0]!.description ? <Text color="textMuted">{prices[0]!.description}</Text> : null}
              {prices[0]!.entitlements.length ? (
                <Text variant="caption" style={{ marginTop: spacing.xs }}>
                  {prices[0]!.entitlements.map((e) => t(`premium.entitlements.${e.key}`, { defaultValue: humanizeKey(e.key) })).join(' · ')}
                </Text>
              ) : null}
              {prices.map((p) => (
                <View key={p.priceId} style={{ marginTop: spacing.sm }}>
                  <Text variant="label">
                    {p.interval ? t(`premium.per.${p.interval}`, { price: formatPrice(p), count: formatNumber(p.intervalCount) }) : formatPrice(p)}
                  </Text>
                  {p.trialDays ? <Text variant="caption" color="success">{t('premium.trial', { days: formatNumber(p.trialDays) })}</Text> : null}
                  <Button label={t('premium.buy')} disabled={!STORE_PURCHASES_AVAILABLE} accessibilityHint={t('premium.storeUnavailableTitle')} onPress={() => undefined} testID={`buy-${p.priceId}`} style={{ marginTop: spacing.xs }} />
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      <View style={{ marginTop: spacing.lg }}>
        <Button variant="secondary" label={t('premium.restore')} onPress={() => void restore.run()} loading={restore.pending} testID="premium-restore" />
        <FormError error={restore.error} />
        {restored !== null ? (
          <Notice
            tone="success"
            title={t('premium.restoreDone')}
            // Honest per store: Play is re-checked by the server; App Store transactions can only come from the device.
            body={platform === 'android' ? t('premium.restoreGoogle', { n: formatNumber(restored) }) : platform === 'ios' ? t('premium.restoreAppleNote') : undefined}
            testID="premium-restored"
          />
        ) : null}
      </View>
    </Screen>
  );
}
