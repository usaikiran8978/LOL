import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { analytics } from '../../analytics';
import { isApiError } from '../../api';
import { discoveryApi, type Card, type LikeResult } from '../../api/discovery';
import { Button, FormError, IconButton, Notice, Text } from '../../components';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useResource } from '../../hooks/useResource';
import { formatDateTime } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';
import { gateFor, usePaywall } from '../premium/paywall';
import { DeckCard } from './DeckCard';
import { MatchModal } from './MatchModal';
import { SwipeCard } from './SwipeCard';

type Action = 'like' | 'pass' | 'super_like';

function EmptyState({ icon, title, body, action }: { icon: 'heart-half-outline' | 'heart-circle-outline'; title: string; body?: string; action?: { label: string; onPress: () => void; testID?: string } }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl, paddingHorizontal: spacing.lg }}>
      <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg }}>
        <Ionicons name={icon} size={64} color={colors.primary} />
      </View>
      <Text variant="title" align="center">
        {title}
      </Text>
      {body ? (
        <Text color="textMuted" align="center" style={{ marginTop: spacing.sm }}>
          {body}
        </Text>
      ) : null}
      {action ? <Button label={action.label} onPress={action.onPress} testID={action.testID} style={{ marginTop: spacing.xl, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

/** Tinder-style deck over the "For you" feed: drag right to like, left to pass, or use the round buttons. */
export function HomeDeck({ onCompleteProfile }: { onCompleteProfile: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const openPaywall = usePaywall();
  const feed = useResource(() => discoveryApi.feed('swipe'));
  // Back from a profile opened from the deck: cards acted on there are gone server-side.
  useRefreshOnFocus(feed.reload);
  const [deck, setDeck] = useState<Card[]>([]);
  const [match, setMatch] = useState<{ card: Card; result: LikeResult } | null>(null);
  const [gate, setGate] = useState<ReturnType<typeof gateFor>>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (feed.data) setDeck(feed.data.items);
  }, [feed.data]);

  const top = deck[0];
  const next = deck[1];

  /** Resolves true when the card is consumed (acted on or no longer available). */
  const act = async (action: Action): Promise<boolean> => {
    if (!top || pending) return false;
    setPending(true);
    setGate(null);
    setError(null);
    try {
      const result = await discoveryApi.like({ targetId: top.userId, action, surface: 'swipe', candidateRowId: top.candidateRowId ?? undefined });
      analytics.track(action === 'pass' ? 'pass_sent' : action === 'like' ? 'like_sent' : 'super_like_sent', { surface: 'swipe' });
      if (result.matched) setMatch({ card: top, result });
      setDeck((d) => d.slice(1));
      return true;
    } catch (e) {
      const g = gateFor(e);
      if (g) {
        setGate(g);
        return false;
      }
      if (isApiError(e, 'CONFLICT') || isApiError(e, 'NOT_FOUND')) {
        setDeck((d) => d.slice(1));
        return true;
      }
      setError(e);
      return false;
    } finally {
      setPending(false);
    }
  };

  const open = (card: Card) => router.push({ pathname: '/users/[id]', params: { id: card.userId, surface: 'swipe' } });

  if (isApiError(feed.error, 'PROFILE_INCOMPLETE')) {
    return (
      <View testID="home-deck">
        <EmptyState icon="heart-circle-outline" title={t('discover.profileIncompleteTitle')} body={t('discover.profileIncompleteBody')} action={{ label: t('home.completeProfile'), onPress: onCompleteProfile, testID: 'home-deck-complete-profile' }} />
      </View>
    );
  }
  // Other feed failures (offline, feature off) leave Home usable; the full Discover screen shows the details.
  if (feed.error) return null;
  if (!feed.data) {
    return (
      <View style={{ paddingVertical: spacing.xxxl, alignItems: 'center' }} testID="home-deck-loading">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View testID="home-deck">
      {gate?.kind === 'paywall' ? (
        <View testID="home-deck-limit" style={{ marginBottom: spacing.md }}>
          <Notice tone="warning" title={t('discover.limitTitle')} body={gate.resetsAt ? t('discover.limitResets', { date: formatDateTime(gate.resetsAt) }) : t('discover.limitBody')} />
          <Button label={t('premium.upgrade')} onPress={() => openPaywall('discovery', gate.entitlement)} />
        </View>
      ) : null}
      <FormError error={error} />
      {top ? (
        <>
          <View>
            {next ? (
              <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: [{ scale: 0.95 }, { translateY: 14 }], opacity: 0.9 }}>
                <DeckCard card={next} onOpen={() => undefined} />
              </View>
            ) : null}
            <SwipeCard key={top.userId} onSwipe={act} disabled={pending} likeLabel={t('discover.like')} passLabel={t('discover.pass')} testID="home-deck-card">
              <DeckCard
                card={top}
                onOpen={() => open(top)}
                actions={
                  <>
                    <IconButton icon="close" label={t('discover.pass')} onPress={() => void act('pass')} disabled={pending} size={60} color={colors.primary} testID="home-deck-pass" />
                    <View style={{ alignItems: 'center', gap: spacing.sm }}>
                      <IconButton icon="heart" label={t('discover.like')} onPress={() => void act('like')} disabled={pending} size={60} variant="gradient" testID="home-deck-like" />
                      <IconButton icon="star" label={t('discover.superLike')} onPress={() => void act('super_like')} disabled={pending} size={42} color={colors.superLike} testID="home-deck-super" />
                    </View>
                  </>
                }
              />
            </SwipeCard>
          </View>
        </>
      ) : (
        <View testID="home-deck-empty">
          <EmptyState icon="heart-half-outline" title={t('discover.emptyTitle')} body={t('discover.emptyBody')} action={{ label: t('discover.refresh'), onPress: feed.reload }} />
        </View>
      )}
      {match ? (
        <MatchModal
          name={match.card.displayName ?? t('discover.someone')}
          photoUrl={match.card.photos[0]?.thumbUrl ?? match.card.photos[0]?.url}
          onClose={() => setMatch(null)}
          onMessage={
            match.result.conversationId
              ? () => {
                  const id = match.result.conversationId!;
                  setMatch(null);
                  router.push({ pathname: '/chats/[id]', params: { id } });
                }
              : undefined
          }
        />
      ) : null}
    </View>
  );
}
