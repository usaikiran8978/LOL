import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { catalogApi, type City } from '../../api';
import { discoveryApi } from '../../api/discovery';
import { Button, DateField, FormError, ListItem, Notice, Screen, Text, TextField, ToggleRow } from '../../components';
import { useFlag } from '../../config/ConfigProvider';
import { gateFor, usePaywall } from '../../features/premium/paywall';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatDate } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

/** Travel mode: tell people in another city when you'll be there (premium + `travel_mode` flag). */
export default function TravelScreen() {
  const { t } = useTranslation();
  const { spacing, colors } = useTheme();
  const openPaywall = usePaywall();
  const enabled = useFlag('travel_mode');
  const plans = useResource(discoveryApi.travelPlans, [], enabled);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<City[]>([]);
  const [city, setCity] = useState<City | null>(null);
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || city?.name === q) return setResults([]);
    let live = true;
    const id = setTimeout(() => {
      catalogApi.cities(q).then((r) => live && setResults(r), () => live && setResults([]));
    }, 300);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, city]);

  const create = useAction(async () => {
    try {
      // The API returns the created plan in the list shape, so it is shown without another round trip.
      const created = await discoveryApi.createTravelPlan({ cityId: city!.id, startsOn, endsOn, visibleToLocals: visible });
      plans.setData([...(plans.data ?? []).filter((p) => p.id !== created.id), created].sort((a, b) => (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0)));
      setCity(null);
      setQuery('');
      setStartsOn('');
      setEndsOn('');
    } catch (e) {
      const g = gateFor(e);
      if (g?.kind === 'paywall' && g.entitlement === 'travel_mode') return openPaywall('travel', 'travel_mode');
      throw e;
    }
  });
  const cancel = useAction(async (id: string) => {
    await discoveryApi.cancelTravelPlan(id);
    plans.setData((plans.data ?? []).filter((p) => p.id !== id));
  });

  if (!enabled) return <Screen title={t('travel.title')} status="empty" emptyTitle={t('travel.unavailable')} testID="travel-screen" />;

  const rangeError = startsOn && endsOn && endsOn < startsOn ? t('travel.rangeError') : null;
  return (
    <Screen title={t('travel.title')} subtitle={t('travel.intro')} status={plans.data ? 'ready' : plans.status} error={plans.error} onRetry={plans.reload} testID="travel-screen">
      {plans.data?.length ? (
        plans.data.map((p) => (
          <View key={p.id} testID={`trip-${p.id}`} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <ListItem label={p.cityName} description={t('travel.range', { from: formatDate(p.startsOn), to: formatDate(p.endsOn) })} />
            </View>
            <Button variant="ghost" label={t('common.delete')} accessibilityHint={p.cityName} onPress={() => void cancel.run(p.id)} testID={`trip-cancel-${p.id}`} />
          </View>
        ))
      ) : (
        <Notice title={t('travel.none')} testID="travel-empty" />
      )}
      <FormError error={cancel.error} />
      <Text variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        {t('travel.add')}
      </Text>
      <TextField testID="travel-city" label={t('travel.city')} value={query} onChangeText={(v) => { setQuery(v); setCity(null); }} autoCorrect={false} />
      {results.map((c) => (
        <ListItem key={c.id} testID={`travel-city-${c.id}`} label={[c.name, c.region, c.countryCode].filter(Boolean).join(', ')} onPress={() => { setCity(c); setQuery(c.name); setResults([]); }} />
      ))}
      <DateField testID="travel-from" label={t('travel.from')} value={startsOn} onChange={setStartsOn} />
      <DateField testID="travel-to" label={t('travel.to')} value={endsOn} onChange={setEndsOn} error={rangeError} />
      <ToggleRow testID="travel-visible" label={t('travel.visible')} value={visible} onChange={setVisible} />
      <FormError error={create.error} />
      <Button testID="travel-save" label={t('travel.save')} disabled={!city || !startsOn || !endsOn || !!rangeError} loading={create.pending} onPress={() => void create.run()} style={{ marginTop: spacing.lg }} />
    </Screen>
  );
}
