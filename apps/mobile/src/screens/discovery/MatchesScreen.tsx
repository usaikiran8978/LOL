import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View } from 'react-native';
import { discoveryApi, type MatchItem } from '../../api/discovery';
import { Avatar, Badge, Button, FormError, Screen, Text } from '../../components';
import { usePaged } from '../../hooks/usePaged';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { formatPercent } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

export function MatchRow({ item, onPress }: { item: MatchItem; onPress: () => void }) {
  const { t } = useTranslation();
  const { spacing, colors } = useTheme();
  const name = item.partner.displayName ?? t('discover.someone');
  const preview = item.lastMessage ? (item.lastMessage.preview ?? t(`chat.kinds.${item.lastMessage.kind}`, { defaultValue: t('chat.kinds.other') })) : t('matches.sayHello');
  return (
    <Pressable
      testID={`match-${item.matchId}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('matches.rowA11y', { name, preview })}
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <Avatar uri={item.partner.photo?.thumbUrl ?? item.partner.photo?.url} name={name} />
      <View style={{ flex: 1, marginStart: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Text variant="label">{name}</Text>
          {item.partner.verified ? <Badge tone="success" label={t('discover.verified')} /> : null}
        </View>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {item.lastMessage?.fromMe ? t('matches.you', { preview }) : preview}
        </Text>
      </View>
      {item.compatibility !== null ? (
        <Text variant="caption" color="primary" style={{ marginStart: spacing.sm }}>
          {formatPercent(item.compatibility)}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function MatchesScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const matches = usePaged((cursor) => discoveryApi.matches(cursor));
  useRefreshOnFocus(matches.reload);
  return (
    <Screen
      title={t('matches.title')}
      status={matches.status === 'ready' && matches.items.length === 0 ? 'empty' : matches.status}
      error={matches.error}
      onRetry={matches.reload}
      emptyTitle={t('matches.emptyTitle')}
      emptyBody={t('matches.emptyBody')}
      emptyAction={{ label: t('discover.title'), onPress: () => router.push('/discover') }}
      scroll={false}
      header={
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
          <Button variant="secondary" label={t('liked.tabLiked')} onPress={() => router.push('/liked')} testID="matches-open-liked" style={{ flex: 1 }} />
          <Button variant="secondary" label={t('liked.tabFavorites')} onPress={() => router.push({ pathname: '/liked', params: { tab: 'favorites' } })} testID="matches-open-favorites" style={{ flex: 1 }} />
        </View>
      }
      testID="matches-screen"
    >
      <FlatList
        data={matches.items}
        keyExtractor={(m) => m.matchId}
        renderItem={({ item }) => <MatchRow item={item} onPress={() => router.push({ pathname: '/chats/[id]', params: { id: item.conversationId } })} />}
        onEndReached={matches.loadMore}
        ListFooterComponent={
          <View>
            <FormError error={matches.moreError} />
            {matches.hasMore ? <Button variant="ghost" label={t('common.loadMore')} onPress={matches.loadMore} loading={matches.loadingMore} /> : null}
          </View>
        }
      />
    </Screen>
  );
}
