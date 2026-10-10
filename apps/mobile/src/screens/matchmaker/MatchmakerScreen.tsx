import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, View } from 'react-native';
import { analytics } from '../../analytics';
import { isApiError } from '../../api';
import { discoveryApi, type Card, type LikeResult } from '../../api/discovery';
import { Button, FormError, IconButton, Notice, OutlinedNumeral, Screen, Text } from '../../components';
import { MatchModal } from '../../features/discovery/MatchModal';
import { useFactorText } from '../../features/discovery/ProfileCard';
import { gateFor, usePaywall } from '../../features/premium/paywall';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useResource } from '../../hooks/useResource';
import { formatDateTime, formatNumber, formatPercent } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';
import { elevation, fonts } from '../../theme/tokens';

/** One compatibility category as a labelled bar (server-computed score, 0–100). */
function Meter({ label, score }: { label: string; score: number }) {
  const { colors, spacing, radius } = useTheme();
  const pct = Math.max(0, Math.min(100, score));
  return (
    <View style={{ marginTop: spacing.sm }} accessible accessibilityLabel={`${label}: ${formatPercent(pct)}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption">{label}</Text>
        <Text variant="caption" color="textMuted">
          {formatPercent(pct)}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.primarySoft, marginTop: spacing.xxs, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent }} />
      </View>
    </View>
  );
}

function MatchmakerCard({ card, pending, onAct, onOpen, onUnlock }: { card: Card; pending: boolean; onAct: (a: 'like' | 'pass') => void; onOpen: () => void; onUnlock: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const factorText = useFactorText();
  const photo = card.photos[0];
  const name = card.displayName ?? t('discover.someone');
  const score = card.compatibility;
  return (
    <View testID={`mm-card-${card.userId}`} style={[elevation.card, { backgroundColor: colors.surface, borderRadius: radius.xl, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border }]}>
      <View style={{ flexDirection: 'row', padding: spacing.lg, gap: spacing.lg }}>
        <View style={{ width: 112, height: 148, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.primarySoft }}>
          {photo?.thumbUrl || photo?.url ? <Image source={{ uri: photo.thumbUrl ?? photo.url! }} accessibilityLabel={t('discover.photoOf', { name })} style={{ width: '100%', height: '100%' }} /> : null}
        </View>
        <View style={{ flex: 1, justifyContent: 'space-between' }}>
          <View>
            <Text style={{ fontFamily: fonts.display, fontSize: 28, lineHeight: 32, textTransform: 'uppercase' }} color="primary" numberOfLines={2}>
              {[name, card.age !== null ? formatNumber(card.age) : null].filter(Boolean).join(', ')}
            </Text>
            {card.city ? (
              <Text variant="caption" color="textMuted">
                {card.city}
              </Text>
            ) : null}
          </View>
          {score !== null ? (
            <View accessible accessibilityLabel={t('discover.compatibilityA11y', { percent: formatPercent(score) })}>
              <Text style={{ fontFamily: fonts.display, fontSize: 40, lineHeight: 44 }} color="accentText">
                {formatPercent(score)}
              </Text>
              <Text variant="caption" color="textMuted" style={{ letterSpacing: 1.2, textTransform: 'uppercase' }}>
                {t('matchmaker.compatibility')}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={{ paddingHorizontal: spacing.lg }}>
        {card.topFactors.length ? (
          <View style={{ backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs }}>
              <Ionicons name="sparkles" size={16} color={colors.primary} />
              <Text variant="label" color="primary">
                {t('matchmaker.why')}
              </Text>
            </View>
            {card.topFactors.map((f) => (
              <Text key={f.categoryKey} style={{ marginTop: spacing.xxs }}>
                {`• ${factorText(f)}`}
              </Text>
            ))}
          </View>
        ) : null}
        {card.differences?.length ? (
          <View style={{ marginTop: spacing.md }}>
            <Text variant="label">{t('discover.differences')}</Text>
            {card.differences.map((f) => (
              <Text key={f.categoryKey} color="textMuted" style={{ marginTop: spacing.xxs }}>
                {`• ${factorText(f)}`}
              </Text>
            ))}
          </View>
        ) : null}
        {card.breakdown?.length ? (
          <View style={{ marginTop: spacing.md }} testID={`mm-breakdown-${card.userId}`}>
            {card.breakdown.map((b) => (
              <Meter key={b.categoryKey} label={b.label} score={b.score} />
            ))}
          </View>
        ) : (
          <Button variant="ghost" label={t('matchmaker.unlockBreakdown')} onPress={onUnlock} testID={`mm-unlock-${card.userId}`} style={{ marginTop: spacing.sm }} />
        )}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
        <IconButton icon="close" label={t('discover.pass')} onPress={() => onAct('pass')} disabled={pending} size={52} color={colors.primary} testID={`mm-pass-${card.userId}`} />
        <Button variant="secondary" label={t('home.viewProfile')} onPress={onOpen} style={{ flex: 1 }} testID={`mm-open-${card.userId}`} />
        <IconButton icon="heart" label={t('discover.like')} onPress={() => onAct('like')} disabled={pending} size={52} variant="gradient" testID={`mm-like-${card.userId}`} />
      </View>
    </View>
  );
}

/** AI Matchmaker tab: the "smart" feed with compatibility estimates and the reasons behind each recommendation. */
export default function MatchmakerScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const openPaywall = usePaywall();
  const feed = useResource(() => discoveryApi.feed('smart'));
  useRefreshOnFocus(feed.reload);
  const [items, setItems] = useState<Card[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [gate, setGate] = useState<ReturnType<typeof gateFor>>(null);
  const [match, setMatch] = useState<{ card: Card; result: LikeResult } | null>(null);

  useEffect(() => {
    if (feed.data) setItems(feed.data.items);
  }, [feed.data]);

  const act = async (card: Card, action: 'like' | 'pass') => {
    setPending(card.userId);
    setError(null);
    setGate(null);
    try {
      const result = await discoveryApi.like({ targetId: card.userId, action, surface: 'smart', candidateRowId: card.candidateRowId ?? undefined });
      analytics.track(action === 'pass' ? 'pass_sent' : 'like_sent', { surface: 'smart' });
      if (result.matched) setMatch({ card, result });
      setItems((list) => list.filter((c) => c.userId !== card.userId));
    } catch (e) {
      const g = gateFor(e);
      if (g) setGate(g);
      else if (isApiError(e, 'CONFLICT') || isApiError(e, 'NOT_FOUND')) setItems((list) => list.filter((c) => c.userId !== card.userId));
      else setError(e);
    } finally {
      setPending(null);
    }
  };

  const profileGate = isApiError(feed.error, 'PROFILE_INCOMPLETE');
  const header = (
    <View style={{ marginBottom: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Ionicons name="sparkles" size={18} color={colors.accent} />
        <Text variant="label" color="accentText" style={{ letterSpacing: 1.2, textTransform: 'uppercase' }}>
          {t('matchmaker.eyebrow')}
        </Text>
      </View>
      <Text variant="display">{t('matchmaker.title')}</Text>
      <Text color="textMuted">{t('matchmaker.subtitle')}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }} testID="mm-disclaimer">
        <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
        <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
          {t('matchmaker.disclaimer')}
        </Text>
      </View>
    </View>
  );

  if (profileGate) {
    return (
      <Screen header={header} status="empty" emptyTitle={t('discover.profileIncompleteTitle')} emptyBody={t('discover.profileIncompleteBody')} emptyAction={{ label: t('home.completeProfile'), onPress: () => router.push('/onboarding') }} testID="matchmaker-screen" />
    );
  }

  return (
    <Screen header={header} status={feed.data ? 'ready' : feed.status} error={feed.error} onRetry={feed.reload} testID="matchmaker-screen">
      {gate?.kind === 'paywall' ? (
        <View testID="mm-limit" style={{ marginBottom: spacing.md }}>
          <Notice tone="warning" title={t('discover.limitTitle')} body={gate.resetsAt ? t('discover.limitResets', { date: formatDateTime(gate.resetsAt) }) : t('discover.limitBody')} />
          <Button label={t('premium.upgrade')} onPress={() => openPaywall('discovery', gate.entitlement)} />
        </View>
      ) : null}
      <FormError error={error} />
      {feed.data?.limitReached ? (
        <View testID="mm-feed-limit">
          <Notice tone="warning" title={t('discover.smartLimitTitle')} body={feed.data.resetsAt ? t('discover.limitResets', { date: formatDateTime(feed.data.resetsAt) }) : undefined} />
          <Button label={t('premium.upgrade')} onPress={() => openPaywall('smart_matches', 'smart_matches')} />
        </View>
      ) : feed.data && !items.length ? (
        <View testID="mm-empty" style={{ alignItems: 'center', paddingVertical: spacing.xxl }}>
          <OutlinedNumeral value="0" size={96} color={colors.primary} opacity={0.3} />
          <Text variant="title" align="center">
            {t('discover.emptyTitle')}
          </Text>
          <Text color="textMuted" align="center" style={{ marginTop: spacing.xs }}>
            {t('matchmaker.emptyBody')}
          </Text>
          <Button variant="secondary" label={t('discover.refresh')} onPress={feed.reload} style={{ marginTop: spacing.lg }} />
        </View>
      ) : (
        items.map((c) => (
          <MatchmakerCard
            key={c.userId}
            card={c}
            pending={pending === c.userId}
            onAct={(a) => void act(c, a)}
            onOpen={() => router.push({ pathname: '/users/[id]', params: { id: c.userId, surface: 'smart' } })}
            onUnlock={() => openPaywall('compatibility_insights', 'compatibility_insights')}
          />
        ))
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
    </Screen>
  );
}
