import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { analytics } from '../../analytics';
import { discoveryApi, type LikesReceived } from '../../api/discovery';
import { Button, FormError, Notice, Screen, Text } from '../../components';
import { ProfileCard } from '../../features/discovery/ProfileCard';
import { gateFor, usePaywall } from '../../features/premium/paywall';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

/** People who liked me. Without `see_who_liked` the API returns only the count, and the screen offers the paywall. */
export default function LikesReceivedScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const openPaywall = usePaywall();
  const likes = useResource(() => discoveryApi.likesReceived());
  const d = likes.data;

  useEffect(() => {
    if (d?.locked) analytics.track('paywall_viewed', { entitlement: 'see_who_liked', surface: 'likes_received', placement: 'inline' });
  }, [d?.locked]);

  const respond = useAction(async (targetId: string, action: 'like' | 'pass') => {
    try {
      const result = await discoveryApi.like({ targetId, action, surface: 'swipe' });
      analytics.track(action === 'like' ? 'like_sent' : 'pass_sent', { surface: 'likes_received' });
      if (d && !d.locked) likes.setData({ ...d, total: Math.max(0, d.total - 1), items: d.items.filter((i) => i.profile.userId !== targetId) } as LikesReceived);
      if (result.matched && result.conversationId) router.push({ pathname: '/chats/[id]', params: { id: result.conversationId } });
    } catch (e) {
      const g = gateFor(e);
      if (g?.kind === 'paywall') return openPaywall('likes_received', g.entitlement);
      throw e;
    }
  });

  return (
    <Screen
      title={t('likes.title')}
      status={d ? (d.total === 0 ? 'empty' : 'ready') : likes.status}
      error={likes.error}
      onRetry={likes.reload}
      emptyTitle={t('likes.emptyTitle')}
      emptyBody={t('likes.emptyBody')}
      testID="likes-screen"
    >
      {d?.locked ? (
        <View testID="likes-locked">
          <Notice title={t('likes.lockedTitle', { count: formatNumber(d.total) })} body={t('likes.lockedBody')} />
          <Button label={t('likes.unlock')} onPress={() => openPaywall('likes_received', 'see_who_liked')} testID="likes-unlock" />
        </View>
      ) : d ? (
        <View style={{ gap: spacing.lg }}>
          <Text color="textMuted">{t('likes.count', { count: formatNumber(d.total) })}</Text>
          <FormError error={respond.error} />
          {d.items.map((i) => (
            <View key={i.likeId} testID={`like-${i.likeId}`}>
              {i.superLike ? <Notice tone="success" title={t('likes.superLiked')} /> : null}
              {i.comment ? <Notice title={t('likes.comment', { comment: i.comment })} /> : null}
              <ProfileCard card={i.profile} compact onOpen={() => router.push({ pathname: '/users/[id]', params: { id: i.profile.userId, surface: 'likes_received' } })} />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <Button style={{ flex: 1 }} variant="secondary" label={t('discover.pass')} onPress={() => void respond.run(i.profile.userId, 'pass')} testID={`like-pass-${i.likeId}`} />
                <Button style={{ flex: 1 }} label={t('likes.likeBack')} onPress={() => void respond.run(i.profile.userId, 'like')} testID={`like-back-${i.likeId}`} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
