import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { catalogApi, isApiError, preferencesApi, type Preferences, type Term } from '../../api';
import { useSession } from '../../auth/SessionProvider';
import { Button, ChipGroup, FormError, Notice, RangeSlider, Text, ToggleRow } from '../../components';
import { useConfig } from '../../config/ConfigProvider';
import { useAction } from '../../hooks/useAction';
import { usePaywall } from '../premium/paywall';
import { useResource } from '../../hooks/useResource';
import { formatDistanceKm, formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';
import { LoadState, type EditorProps } from './LoadState';

const AGE = { min: 18, max: 99 };
const DISTANCE = { min: 1, max: 500 };

export function PreferencesEditor(props: EditorProps & { requireGender?: boolean }) {
  const { i18n } = useTranslation();
  const prefs = useResource(preferencesApi.get);
  const terms = useResource(() => catalogApi.taxonomy(['gender', 'dating_intent']), [i18n.language]);
  return <LoadState resources={[prefs, terms]}>{() => <Editor {...props} prefs={prefs.data!} terms={terms.data!} />}</LoadState>;
}

function Editor({ prefs, terms, submitLabel, onSaved, requireGender }: EditorProps & { prefs: Preferences; terms: Term[]; requireGender?: boolean }) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const { user } = useSession();
  const { config } = useConfig();
  const measurement = config?.countries.find((c) => c.code === user?.countryCode)?.measurement ?? 'metric';
  const [v, setV] = useState({
    ageMin: Math.max(AGE.min, prefs.ageMin),
    ageMax: Math.min(AGE.max, prefs.ageMax),
    maxDistanceKm: Math.min(DISTANCE.max, prefs.maxDistanceKm),
    ageStrict: prefs.ageStrict,
    distanceStrict: prefs.distanceStrict,
    globalMode: prefs.globalMode,
    verifiedOnly: prefs.verifiedOnly,
    gender: (prefs.terms.gender ?? []).map((x) => x.termId),
    datingIntent: (prefs.terms.dating_intent ?? []).map((x) => x.termId),
  });
  const [upsell, setUpsell] = useState(false);
  const openPaywall = usePaywall();
  const [genderError, setGenderError] = useState<string | null>(null);
  const options = (kind: string) => terms.filter((x) => x.kind === kind).map((x) => ({ value: x.id, label: x.label }));

  const save = useAction(async () => {
    if (requireGender && v.gender.length === 0) return setGenderError(t('validation.chooseAtLeastOne'));
    setGenderError(null);
    try {
      await preferencesApi.update({
        ageMin: v.ageMin,
        ageMax: v.ageMax,
        maxDistanceKm: v.maxDistanceKm,
        ageStrict: v.ageStrict,
        distanceStrict: v.distanceStrict,
        globalMode: v.globalMode,
        verifiedOnly: v.verifiedOnly,
        terms: {
          gender: v.gender.map((termId) => ({ termId, isDealbreaker: false })),
          dating_intent: v.datingIntent.map((termId) => ({ termId, isDealbreaker: false })),
        },
      });
    } catch (e) {
      // Advanced filters are a premium entitlement: revert the toggle and offer the paywall.
      if (isApiError(e, 'ENTITLEMENT_REQUIRED')) {
        setV((s) => ({ ...s, verifiedOnly: false }));
        setUpsell(true);
        return;
      }
      throw e;
    }
    await onSaved();
  });

  return (
    <View>
      <FormError error={save.error} />
      <RangeSlider
        testID="age-range"
        label={t('preferences.ageRange')}
        min={AGE.min}
        max={AGE.max}
        low={v.ageMin}
        high={v.ageMax}
        onChange={(lo, hi) => setV((s) => ({ ...s, ageMin: lo, ageMax: hi ?? s.ageMax }))}
        format={(n) => formatNumber(n)}
        lowLabel={t('preferences.ageMin')}
        highLabel={t('preferences.ageMax')}
      />
      <RangeSlider
        testID="distance"
        label={t('preferences.distance')}
        min={DISTANCE.min}
        max={DISTANCE.max}
        low={v.maxDistanceKm}
        onChange={(lo) => setV((s) => ({ ...s, maxDistanceKm: lo }))}
        format={(n) => formatDistanceKm(n, measurement)}
        lowLabel={t('preferences.maxDistance')}
      />
      <ChipGroup testID="pref-gender" label={t('preferences.showMe')} options={options('gender')} selected={v.gender} onChange={(g) => setV((s) => ({ ...s, gender: g }))} multiple error={genderError} />
      <ChipGroup testID="pref-intent" label={t('preferences.intents')} hint={t('common.chooseAny')} options={options('dating_intent')} selected={v.datingIntent} onChange={(g) => setV((s) => ({ ...s, datingIntent: g }))} multiple />
      <ToggleRow label={t('preferences.ageStrict')} description={t('preferences.ageStrictHint')} value={v.ageStrict} onChange={(b) => setV((s) => ({ ...s, ageStrict: b }))} />
      <ToggleRow label={t('preferences.distanceStrict')} description={t('preferences.distanceStrictHint')} value={v.distanceStrict} onChange={(b) => setV((s) => ({ ...s, distanceStrict: b }))} />
      <ToggleRow label={t('preferences.globalMode')} description={t('preferences.globalModeHint')} value={v.globalMode} onChange={(b) => setV((s) => ({ ...s, globalMode: b }))} />
      <Text variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        {t('preferences.advanced')}
      </Text>
      <ToggleRow testID="pref-verified-only" label={t('preferences.verifiedOnly')} description={t('preferences.premium')} value={v.verifiedOnly} onChange={(b) => setV((s) => ({ ...s, verifiedOnly: b }))} />
      {upsell ? (
        <View testID="upsell">
          <Notice tone="warning" title={t('upsell.title')} body={t('preferences.upsellRetry')} />
          <Button testID="upsell-open" variant="secondary" label={t('premium.upgrade')} onPress={() => openPaywall('preferences', 'advanced_filters')} style={{ marginBottom: 16 }} />
        </View>
      ) : null}
      <View style={{ height: spacing.lg }} />
      <Button testID="preferences-save" label={submitLabel} onPress={() => void save.run()} loading={save.pending} />
    </View>
  );
}
