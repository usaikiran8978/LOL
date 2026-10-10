import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View } from 'react-native';
import { notificationsApi, type InboxItem } from '../../api/notifications';
import { Badge, Button, FormError, Screen, Text } from '../../components';
import { useAction } from '../../hooks/useAction';
import { usePaged } from '../../hooks/usePaged';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { formatDateTime } from '../../i18n/format';
import { routeForDeepLink } from '../../notifications/deepLink';
import { useRealtimeEvent } from '../../realtime/RealtimeProvider';
import { useTheme } from '../../theme/ThemeProvider';

/** In-app notification list (server-rendered, localized at send time). */
export default function InboxScreen() {
  const { t } = useTranslation();
  const { spacing, colors } = useTheme();
  const router = useRouter();
  const [unread, setUnread] = useState<number | null>(null);
  const inbox = usePaged(async (cursor) => {
    const page = await notificationsApi.inbox(cursor);
    if (!cursor) setUnread(page.unread);
    return page;
  });
  useRefreshOnFocus(inbox.reload);
  useRealtimeEvent('notification', (d) => {
    if ((d as { id?: string })?.id) inbox.reload();
  });

  const open = useAction(async (n: InboxItem) => {
    if (!n.read) {
      await notificationsApi.markRead(n.id).catch(() => undefined);
      inbox.setItems((items) => items.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => (u ? u - 1 : u));
    }
    const route = routeForDeepLink(n.deepLink);
    if (route) router.push(route);
  });
  const readAll = useAction(async () => {
    await notificationsApi.markAllRead();
    inbox.setItems((items) => items.map((x) => ({ ...x, read: true })));
    setUnread(0);
  });

  return (
    <Screen
      title={t('notifications.title')}
      header={
        unread ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
            <Badge tone="primary" label={t('notifications.unread', { count: unread })} />
            <Button variant="ghost" label={t('notifications.markAll')} onPress={() => void readAll.run()} loading={readAll.pending} testID="inbox-read-all" />
          </View>
        ) : null
      }
      status={inbox.status === 'ready' && inbox.items.length === 0 ? 'empty' : inbox.status}
      error={inbox.error}
      onRetry={inbox.reload}
      emptyTitle={t('notifications.empty')}
      scroll={false}
      testID="inbox-screen"
    >
      <FormError error={open.error ?? readAll.error} />
      <FlatList
        data={inbox.items}
        keyExtractor={(n) => n.id}
        onEndReached={inbox.loadMore}
        renderItem={({ item: n }) => (
          <Pressable
            testID={`notification-${n.id}`}
            onPress={() => void open.run(n)}
            accessibilityRole="button"
            accessibilityLabel={[n.title, n.body, n.read ? null : t('notifications.unreadA11y')].filter(Boolean).join(', ')}
            style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
          >
            <Text variant={n.read ? 'body' : 'heading'}>{n.title ?? t(`notifications.categories.${n.category}`)}</Text>
            {n.body ? <Text color="textMuted">{n.body}</Text> : null}
            <Text variant="caption" color="textMuted">{formatDateTime(n.createdAt)}</Text>
          </Pressable>
        )}
        ListFooterComponent={inbox.hasMore ? <Button variant="ghost" label={t('common.loadMore')} onPress={inbox.loadMore} loading={inbox.loadingMore} /> : null}
      />
    </Screen>
  );
}
