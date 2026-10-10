import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { analytics } from '../../analytics';
import { isApiError } from '../../api';
import { discoveryApi, type Card, type LikeResult, type Surface } from '../../api/discovery';
import { useSession } from '../../auth/SessionProvider';
import { Button, ChipGroup, FormError, Notice, Screen } from '../../components';
import { ProfileCard } from '../../features/discovery/ProfileCard';
import { gateFor, usePaywall } from '../../features/premium/paywall';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatDateTime } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

const SURFACE_TABS: Surface[] = ['swipe', 'smart', 'daily'];

/** Swipe deck + smart feed. Actions are explicit buttons (accessible, RTL-safe) rather than gestures only. */
export default function DiscoverScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const openPaywall = usePaywall();
  const { user } = useSession();
  const [surface, setSurface] = useState<Surface>('swipe');
  const feed = useResource(() => discoveryApi.feed(surface), [surface]);
  const [deck, setDeck] = useState<Card[]>([]);
  const [match, setMatch] = useState<{ name: string | null; result: LikeResult } | null>(null);
  const [gate, setGate] = useState<ReturnType<typeof gateFor>>(null);

  useEffect(() => {
    if (feed.data) setDeck(feed.data.items);
  }, [feed.data]);

  const top = deck[0];

  const act = useAction(async (action: 'like' | 'pass' | 'super_like') => {
    if (!top) return;
    setGate(null);
    setMatch(null);
    try {
      const result = await discoveryApi.like({ targetId: top.userId, action, surface, candidateRowId: top.candidateRowId ?? undefined });
      analytics.track(action === 'pass' ? 'pass_sent' : action === 'like' ? 'like_sent' : 'super_like_sent', { surface });
      if (result.matched) setMatch({ name: top.displayName, result });
      setDeck((d) => d.slice(1));
    } catch (e) {
      const g = gateFor(e);
      if (g) return setGate(g);
      // Already acted on (e.g. from another device) or no longer available: drop the card and continue.
      if (isApiError(e, 'CONFLICT') || isApiError(e, 'NOT_FOUND')) return setDeck((d) => d.slice(1));
      throw e;
    }
  });

  const rewind = useAction(async () => {
    setGate(null);
    try {
      await discoveryApi.rewind();
      analytics.track('rewind_used', { surface });
      feed.reload();
    } catch (e) {
      const g = gateFor(e);
      if (g) return setGate(g);
      throw e;
    }
  });

  const profileGate = isApiError(feed.error, 'PROFILE_INCOMPLETE');
  const finishProfile = () => router.push(user && !user.onboardingCompleted ? '/onboarding' : '/profile');
  const empty = feed.data && deck.length === 0;
  const limit = feed.data?.limitReached;

  const header = (
    <View>
      <ChipGroup
        testID="surface"
        label={t('discover.surfaceLabel')}
        options={SURFACE_TABS.map((s) => ({ value: s, label: t(`discover.surfaces.${s}`) }))}
        selected={[surface]}
        onChange={(v) => v[0] && setSurface(v[0] as Surface)}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg }}>
        <Button variant="secondary" label={t('discover.search')} onPress={() => router.push('/discover/search')} testID="open-search" />
        <Button variant="secondary" label={t('discover.likesYou')} onPress={() => router.push('/discover/likes')} testID="open-likes" />
        <Button variant="secondary" label={t('discover.matches')} onPress={() => router.push('/matches')} testID="open-matches" />
      </View>
    </View>
  );

  if (profileGate) {
    return (
      <Screen title={t('discover.title')} status="empty" emptyTitle={t('discover.profileIncompleteTitle')} emptyBody={t('discover.profileIncompleteBody')} emptyAction={{ label: t('discover.finishProfile'), onPress: finishProfile }} testID="discover-screen" />
    );
  }

  return (
    <Screen
      title={t('discover.title')}
      header={header}
      status={feed.data ? 'ready' : feed.status}
      error={feed.error}
      onRetry={feed.reload}
      testID="discover-screen"
    >
      {match ? (
        <View testID="match-banner">
          <Notice tone="success" title={t('discover.itsAMatch', { name: match.name ?? t('discover.someone') })} />
          {match.result.conversationId ? (
            <Button label={t('discover.sendMessage')} onPress={() => router.push({ pathname: '/chats/[id]', params: { id: match.result.conversationId! } })} testID="match-message" style={{ marginBottom: spacing.lg }} />
          ) : null}
        </View>
      ) : null}
      {gate?.kind === 'paywall' ? (
        <View testID="limit-reached">
          <Notice tone="warning" title={t('discover.limitTitle')} body={gate.resetsAt ? t('discover.limitResets', { date: formatDateTime(gate.resetsAt) }) : t('discover.limitBody')} />
          <Button label={t('premium.upgrade')} onPress={() => openPaywall('discovery', gate.entitlement)} testID="limit-upgrade" style={{ marginBottom: spacing.lg }} />
        </View>
      ) : null}
      {gate?.kind === 'profile' ? (
        <View>
          <Notice tone="warning" title={t('discover.profileIncompleteTitle')} />
          <Button label={t('discover.finishProfile')} onPress={finishProfile} style={{ marginBottom: spacing.lg }} />
        </View>
      ) : null}
      <FormError error={act.error ?? rewind.error} />
      {limit ? (
        <View testID="feed-limit">
          <Notice tone="warning" title={t('discover.smartLimitTitle')} body={feed.data?.resetsAt ? t('discover.limitResets', { date: formatDateTime(feed.data.resetsAt) }) : undefined} />
          <Button label={t('premium.upgrade')} onPress={() => openPaywall('smart_matches', 'smart_matches')} />
        </View>
      ) : empty ? (
        <View testID="deck-empty">
          <Notice title={t('discover.emptyTitle')} body={t('discover.emptyBody')} />
          <Button variant="secondary" label={t('discover.refresh')} onPress={feed.reload} testID="deck-refresh" />
        </View>
      ) : top ? (
        <View>
          <ProfileCard card={top} onOpen={() => router.push({ pathname: '/users/[id]', params: { id: top.userId, surface } })} />
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
            <Button style={{ flex: 1 }} variant="secondary" label={t('discover.pass')} onPress={() => void act.run('pass')} disabled={act.pending} testID="action-pass" />
            <Button style={{ flex: 1 }} variant="secondary" label={t('discover.superLike')} onPress={() => void act.run('super_like')} disabled={act.pending} testID="action-super" />
            <Button style={{ flex: 1 }} label={t('discover.like')} onPress={() => void act.run('like')} disabled={act.pending} testID="action-like" />
          </View>
          <Button variant="ghost" label={t('discover.rewind')} accessibilityHint={t('discover.rewindHint')} onPress={() => void rewind.run()} loading={rewind.pending} testID="action-rewind" style={{ marginTop: spacing.sm }} />
        </View>
      ) : null}
    </Screen>
  );
}
