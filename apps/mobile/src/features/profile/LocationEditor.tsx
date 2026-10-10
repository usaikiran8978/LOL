import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { catalogApi, isApiError, locationApi, profileApi, usersApi, type City } from '../../api';
import { useSession } from '../../auth/SessionProvider';
import { Button, FormError, Notice, Text, TextField } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useTheme } from '../../theme/ThemeProvider';
import type { EditorProps } from './LoadState';

/**
 * City selection by search, with optional GPS. GPS needs two separate permissions: the user's recorded consent
 * (server-side, required by PUT /location) and the OS permission. Exact coordinates stay server-side (DEC-008).
 */
export function LocationEditor({ submitLabel, onSaved }: EditorProps) {
  const { t } = useTranslation();
  const { spacing, colors } = useTheme();
  const { user } = useSession();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<City[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<unknown>(null);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);

  // Debounced search: the catalog endpoint is prefix-matched and cheap, but not free.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setResults(null);
    let live = true;
    const id = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      catalogApi
        .cities(q, user?.countryCode ?? undefined)
        .then((r) => live && setResults(r), (e: unknown) => live && setSearchError(e))
        .finally(() => live && setSearching(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, user?.countryCode]);

  const save = useAction(async () => {
    if (!selected) return;
    await profileApi.update({ cityId: selected.id });
    await onSaved();
  });

  const gps = useAction(async () => {
    setGpsMessage(null);
    await usersApi.setConsent({ consentType: 'location', granted: true });
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return setGpsMessage(t('location.permissionDenied'));
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    try {
      const r = await locationApi.update({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyM: pos.coords.accuracy ?? undefined, source: 'gps' });
      if (r.cityId && r.cityName) setSelected({ id: r.cityId, name: r.cityName });
      else setGpsMessage(t('location.noNearbyCity'));
    } catch (e) {
      if (isApiError(e, 'CONSENT_REQUIRED')) return setGpsMessage(t('errors.CONSENT_REQUIRED'));
      throw e;
    }
  });

  return (
    <View>
      <FormError error={save.error ?? gps.error} />
      <Notice title={t('location.privacyTitle')} body={t('location.privacyBody')} />
      <Button testID="location-gps" variant="secondary" label={t('location.useCurrent')} onPress={() => void gps.run()} loading={gps.pending} />
      {gpsMessage ? (
        <Text color="textMuted" accessibilityLiveRegion="polite" style={{ marginTop: spacing.sm }}>
          {gpsMessage}
        </Text>
      ) : null}
      <View style={{ height: spacing.lg }} />
      <TextField testID="city-search" label={t('location.searchCity')} hint={t('location.searchHint')} value={query} onChangeText={setQuery} autoCorrect={false} />
      {searching ? <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
      <FormError error={searchError} testID="city-search-error" />
      {results && !searching && results.length === 0 ? <Text color="textMuted">{t('common.noResults')}</Text> : null}
      {results?.map((c) => (
        <Button
          key={c.id}
          testID={`city-${c.id}`}
          variant={selected?.id === c.id ? 'primary' : 'ghost'}
          label={[c.name, c.region, c.countryCode].filter(Boolean).join(', ')}
          onPress={() => setSelected({ id: c.id, name: c.name })}
        />
      ))}
      {selected ? <Notice tone="success" title={t('location.selected', { city: selected.name })} testID="city-selected" /> : null}
      <Button testID="location-save" label={submitLabel} onPress={() => void save.run()} loading={save.pending} disabled={!selected} />
    </View>
  );
}
