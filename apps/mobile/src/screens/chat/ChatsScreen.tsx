import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View } from 'react-native';
import { chatApi, type Conversation } from '../../api/chat';
import { Avatar, Badge, Button, FormError, Screen, Text } from '../../components';
import { usePaged } from '../../hooks/usePaged';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { formatDateTime, formatNumber } from '../../i18n/format';
import { useRealtime, useRealtimeEvent } from '../../realtime/RealtimeProvider';
import { useTheme } from '../../theme/ThemeProvider';

export const LIST_POLL_MS = 20_000;

export function conversationTitle(c: Conversation, fallback: string): string {
  return c.participants.map((p) => p.displayName).filter(Boolean).join(', ') || fallback;
}

/** Conversation list with unread counts; refreshed live over the socket, or by polling while it is down. */
export default function ChatsScreen() {
  const { t } = useTranslation();
  const { spacing, colors } = useTheme();
  const router = useRouter();
  const { status: rt } = useRealtime();
  const list = usePaged((cursor) => chatApi.conversations(cursor));
  useRefreshOnFocus(list.reload);
  useRealtimeEvent('message.new', () => list.reload());
  useRealtimeEvent('match.new', () => list.reload());
  useRealtimeEvent('match.ended', () => list.reload());
  // Moderation outcomes change previews/unread counts: media resolved (updated) or a message removed (deleted).
  useRealtimeEvent('message.updated', () => list.reload());
  useRealtimeEvent('message.deleted', () => list.reload());

  useEffect(() => {
    if (rt === 'open') return;
    const id = setInterval(list.reload, LIST_POLL_MS);
    return () => clearInterval(id);
  }, [rt, list.reload]);

  const row = ({ item: c }: { item: Conversation }) => {
    const title = c.kind === 'event' ? t('chat.eventChat') : conversationTitle(c, t('discover.someone'));
    const unread = c.unreadCount > 0;
    return (
      <Pressable
        testID={`conversation-${c.id}`}
        onPress={() => router.push({ pathname: '/chats/[id]', params: { id: c.id, name: title } })}
        accessibilityRole="button"
        accessibilityLabel={[title, unread ? t('chat.unreadA11y', { count: formatNumber(c.unreadCount) }) : null, c.status === 'closed' ? t('chat.closedShort') : null].filter(Boolean).join(', ')}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <Avatar name={title} />
        <View style={{ flex: 1, marginStart: spacing.md }}>
          <Text variant={unread ? 'heading' : 'body'}>{title}</Text>
          <Text variant="caption" color="textMuted">
            {c.status === 'closed' ? t('chat.closedShort') : c.lastMessageAt ? formatDateTime(c.lastMessageAt) : t('matches.sayHello')}
          </Text>
        </View>
        {c.muted ? <Badge label={t('chat.muted')} /> : null}
        {unread ? <Badge tone="primary" label={formatNumber(c.unreadCount)} testID={`unread-${c.id}`} accessibilityLabel={t('chat.unreadA11y', { count: formatNumber(c.unreadCount) })} /> : null}
      </Pressable>
    );
  };

  return (
    <Screen
      title={t('chat.title')}
      status={list.status === 'ready' && list.items.length === 0 ? 'empty' : list.status}
      error={list.error}
      onRetry={list.reload}
      emptyTitle={t('chat.emptyTitle')}
      emptyBody={t('chat.emptyBody')}
      emptyAction={{ label: t('discover.title'), onPress: () => router.push('/discover') }}
      scroll={false}
      testID="chats-screen"
    >
      <FlatList
        data={list.items}
        keyExtractor={(c) => c.id}
        renderItem={row}
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
