import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { discoveryApi, type SearchFilters } from '../../api/discovery';
import { Button, FormError, Notice, Screen, Text, TextField, ToggleRow } from '../../components';
import { ProfileCard } from '../../features/discovery/ProfileCard';
import { gateFor, usePaywall } from '../../features/premium/paywall';
import { usePaged } from '../../hooks/usePaged';
import { useTheme } from '../../theme/ThemeProvider';

const int = (v: string) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
};

/** Search with basic filters (age, distance) and advanced ones (verified only, keyword — premium). */
export default function SearchScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const openPaywall = usePaywall();
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [distance, setDistance] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState<SearchFilters | null>(null);

  const results = usePaged((cursor) => discoveryApi.search(applied!, cursor), [applied], !!applied);
  const gate = gateFor(results.error);

  const apply = () =>
    setApplied({
      ageMin: int(ageMin),
      ageMax: int(ageMax),
      maxDistanceKm: int(distance),
      verifiedOnly: verifiedOnly || undefined,
      q: q.trim() || undefined,
    });

  return (
    <Screen title={t('search.title')} testID="search-screen">
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <TextField testID="search-age-min" label={t('search.ageMin')} keyboardType="number-pad" value={ageMin} onChangeText={setAgeMin} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField testID="search-age-max" label={t('search.ageMax')} keyboardType="number-pad" value={ageMax} onChangeText={setAgeMax} />
        </View>
      </View>
      <TextField testID="search-distance" label={t('search.maxDistance')} keyboardType="number-pad" value={distance} onChangeText={setDistance} />
      <Text variant="heading" style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
        {t('search.advanced')}
      </Text>
      <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.sm }}>
        {t('search.advancedHint')}
      </Text>
      <ToggleRow testID="search-verified" label={t('search.verifiedOnly')} value={verifiedOnly} onChange={setVerifiedOnly} />
      <View style={{ height: spacing.md }} />
      <TextField testID="search-q" label={t('search.keyword')} value={q} onChangeText={setQ} autoCorrect={false} />
      <Button testID="search-apply" label={t('search.apply')} onPress={apply} />

      <View style={{ marginTop: spacing.xl }}>
        {!applied ? null : gate?.kind === 'paywall' ? (
          <View testID="search-upsell">
            <Notice tone="warning" title={t('search.premiumFilters')} />
            <Button label={t('premium.upgrade')} onPress={() => openPaywall('search', gate.entitlement)} />
          </View>
        ) : gate?.kind === 'profile' ? (
          <View>
            <Notice tone="warning" title={t('discover.profileIncompleteTitle')} />
            <Button label={t('discover.finishProfile')} onPress={() => router.push('/onboarding')} />
          </View>
        ) : results.status === 'error' ? (
          <View testID="search-error">
            <FormError error={results.error} />
            <Button variant="secondary" label={t('common.retry')} onPress={results.reload} />
          </View>
        ) : results.status === 'loading' ? (
          <Text color="textMuted" testID="search-loading">
            {t('common.loading')}
          </Text>
        ) : results.items.length === 0 ? (
          <Notice title={t('search.noResults')} testID="search-empty" />
        ) : (
          <View style={{ gap: spacing.md }}>
            {results.items.map((c) => (
              <ProfileCard key={c.userId} card={c} compact onOpen={() => router.push({ pathname: '/users/[id]', params: { id: c.userId, surface: 'search' } })} />
            ))}
            <FormError error={results.moreError} />
            {results.hasMore ? <Button variant="secondary" label={t('common.loadMore')} onPress={results.loadMore} loading={results.loadingMore} testID="search-more" /> : null}
          </View>
        )}
      </View>
    </Screen>
  );
}
