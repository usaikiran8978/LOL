import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View } from 'react-native';
import { eventsApi, type EventListItem } from '../../api/experiences';
import { Badge, Button, ChipGroup, FormError, Screen, Text } from '../../components';
import { useFlag } from '../../config/ConfigProvider';
import { usePaged } from '../../hooks/usePaged';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { formatDateTime, formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

export function formatPrice(p: { amountMinor: number; currency: string }): string {
  return formatNumber(p.amountMinor / 100, { style: 'currency', currency: p.currency });
}

function EventRow({ e, onPress }: { e: EventListItem; onPress: () => void }) {
  const { t } = useTranslation();
  const { spacing, colors } = useTheme();
  return (
    <Pressable testID={`event-${e.id}`} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${e.title}, ${formatDateTime(e.startsAt)}`} style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text variant="heading">{e.title}</Text>
      <Text color="textMuted">{[formatDateTime(e.startsAt), e.isOnline ? t('events.online') : e.city].join(' · ')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
        <Badge label={e.category.label} />
        {e.price ? <Badge label={formatPrice(e.price)} /> : <Badge tone="success" label={t('events.free')} />}
        {e.spotsLeft !== null ? <Badge tone={e.spotsLeft === 0 ? 'warning' : 'neutral'} label={e.spotsLeft === 0 ? t('events.full') : t('events.spotsLeft', { count: formatNumber(e.spotsLeft) })} /> : null}
        {e.myStatus ? <Badge tone="primary" label={t(`events.myStatus.${e.myStatus}`)} /> : null}
      </View>
    </Pressable>
  );
}

export default function EventsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('events');
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const list = usePaged((cursor) => eventsApi.list({ mine: tab === 'mine', cursor }), [tab], enabled);
  useRefreshOnFocus(list.reload);

  if (!enabled) return <Screen title={t('events.title')} status="empty" emptyTitle={t('events.unavailable')} testID="events-screen" />;

  return (
    <Screen
      title={t('events.title')}
      header={<ChipGroup testID="events-tab" label={t('events.show')} options={(['all', 'mine'] as const).map((v) => ({ value: v, label: t(`events.tabs.${v}`) }))} selected={[tab]} onChange={(v) => v[0] && setTab(v[0] as 'all' | 'mine')} />}
      status={list.status === 'ready' && list.items.length === 0 ? 'empty' : list.status}
      error={list.error}
      onRetry={list.reload}
      emptyTitle={t(tab === 'mine' ? 'events.emptyMine' : 'events.empty')}
      scroll={false}
      testID="events-screen"
    >
      <FlatList
        data={list.items}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => <EventRow e={item} onPress={() => router.push({ pathname: '/events/[id]', params: { id: item.id } })} />}
        onEndReached={list.loadMore}
        ListFooterComponent={
          <View>
            <FormError error={list.moreError} />
            {list.hasMore ? <Button variant="ghost" label={t('common.loadMore')} onPress={list.loadMore} loading={list.loadingMore} /> : null}
          </View>
        }
      />
    </Screen>
  );
}
