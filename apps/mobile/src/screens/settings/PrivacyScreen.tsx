import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { isApiError, profileApi, type PrivacySettings } from '../../api';
import { Button, ChipGroup, FormError, Notice, Screen, Select, Text, ToggleRow, useToast } from '../../components';
import { usePaywall } from '../../features/premium/paywall';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatDateTime } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

const TOGGLES = ['showAge', 'showDistance', 'showCity', 'showOnlineStatus', 'showReadReceipts', 'showOrientation', 'showReligion', 'showVerification', 'allowTranslation', 'allowAiProfileAnalysis', 'allowAiMessageAnalysis'] as const;
const SNOOZE_HOURS = { off: 0, '24h': 24, '72h': 72, '7d': 168 } as const;
type Snooze = keyof typeof SNOOZE_HOURS;

export default function PrivacyScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const toast = useToast();
  const openPaywall = usePaywall();
  const privacy = useResource(profileApi.privacy);
  const [upsell, setUpsell] = useState(false);
  const p = privacy.data;

  // Each change is saved immediately; the server echoes the full settings, which become the new truth.
  const update = useAction(async (patch: Partial<Omit<PrivacySettings, 'snoozedUntil'>> & { snoozedUntil?: string | null }) => {
    try {
      privacy.setData(await profileApi.setPrivacy(patch));
      toast.show(t('common.saved'), 'success');
    } catch (e) {
      if (isApiError(e, 'ENTITLEMENT_REQUIRED')) {
        setUpsell(true);
        return;
      }
      throw e;
    }
  });

  const snoozed = p?.snoozedUntil && new Date(p.snoozedUntil) > new Date();

  return (
    <Screen title={t('settings.privacy')} status={p ? 'ready' : privacy.status} error={privacy.error} onRetry={privacy.reload} testID="privacy-screen">
      {p ? (
        <View>
          <FormError error={update.error} />
          <Text variant="heading" style={{ marginBottom: spacing.sm }}>
            {t('privacy.visibility')}
          </Text>
          <Select
            testID="privacy-discoverable"
            label={t('privacy.discoverableBy')}
            value={p.discoverableBy}
            options={(['everyone', 'liked_only', 'nobody'] as const).map((v) => ({ value: v, label: t(`privacy.discoverable.${v}`) }))}
            onChange={(v) => void update.run({ discoverableBy: v as PrivacySettings['discoverableBy'] })}
          />
          <ToggleRow testID="privacy-incognito" label={t('privacy.incognito')} description={t('privacy.incognitoHint')} value={p.incognito} onChange={(v) => void update.run({ incognito: v })} disabled={update.pending} />
          {upsell ? (
            <View testID="upsell">
              <Notice tone="warning" title={t('upsell.title')} body={t('upsell.incognito')} />
              <Button testID="upsell-open" label={t('premium.upgrade')} onPress={() => openPaywall('privacy', 'incognito')} />
            </View>
          ) : null}

          <Text variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
            {t('privacy.snooze')}
          </Text>
          {snoozed ? <Notice title={t('privacy.snoozedUntil', { date: formatDateTime(p.snoozedUntil) })} testID="snoozed" /> : null}
          <ChipGroup
            testID="privacy-snooze"
            label={t('privacy.snoozeFor')}
            hint={t('privacy.snoozeHint')}
            options={(Object.keys(SNOOZE_HOURS) as Snooze[]).map((k) => ({ value: k, label: t(`privacy.snoozeOptions.${k}`) }))}
            selected={snoozed ? [] : ['off']}
            onChange={(v) => {
              const k = (v[0] ?? 'off') as Snooze;
              void update.run({ snoozedUntil: k === 'off' ? null : new Date(Date.now() + SNOOZE_HOURS[k] * 3_600_000).toISOString() });
            }}
          />

          <Text variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
            {t('privacy.fields')}
          </Text>
          {TOGGLES.map((k) => (
            <ToggleRow key={k} testID={`privacy-${k}`} label={t(`privacy.toggles.${k}`)} value={p[k]} onChange={(v) => void update.run({ [k]: v })} disabled={update.pending} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
