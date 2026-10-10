import { SURFACES } from '@amora/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, ScrollView, useWindowDimensions, View } from 'react-native';
import { analytics } from '../../analytics';
import { isApiError } from '../../api';
import { discoveryApi, type LikeResult, type Surface } from '../../api/discovery';
import { Badge, Button, Chip, FormError, IconButton, ListItem, Notice, OutlinedNumeral, PhotoChip, Screen, Text, useToast } from '../../components';
import { MatchModal } from '../../features/discovery/MatchModal';
import { gateFor, usePaywall } from '../../features/premium/paywall';
import { useSafetyActions } from '../../features/safety/useSafetyActions';
import { useResource } from '../../hooks/useResource';
import { formatDateTime, formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts } from '../../theme/tokens';

const ON_PHOTO = '#FFFFFF';

function InfoCard({ title, icon, children }: { title: string; icon: 'person' | 'chatbubble-ellipses' | 'sparkles' | 'information-circle'; children: ReactNode }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
        <Ionicons name={icon} size={18} color={colors.primary} />
        <Text variant="label" color="primary">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** Another member's full profile (GET /profiles/:id): photo gallery, details, like / pass, and message / date / safety actions. */
export default function UserProfileScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const router = useRouter();
  const openPaywall = usePaywall();
  const { id, surface, matchId, conversationId } = useLocalSearchParams<{ id: string; surface?: string; matchId?: string; conversationId?: string }>();
  const profile = useResource(() => discoveryApi.profile(id!, surface ?? 'profile'), [id]);
  const p = profile.data;
  const safety = useSafetyActions({ userId: id!, name: p?.displayName ?? null, matchId }, { onBlocked: () => router.back(), onUnmatched: () => router.replace('/matches') });
  const photos = (p?.media.filter((m) => m.kind === 'photo' && (m.url || m.thumbUrl)).sort((a, b) => a.position - b.position) ?? []);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [gate, setGate] = useState<ReturnType<typeof gateFor>>(null);
  const [match, setMatch] = useState<LikeResult | null>(null);
  const toast = useToast();
  const [favoriteOverride, setFavoriteOverride] = useState<boolean | null>(null);
  const favorited = favoriteOverride ?? !!p?.favorited;
  const toggleFavorite = async () => {
    const next = !favorited;
    setFavoriteOverride(next);
    try {
      if (next) await discoveryApi.addFavorite(id!);
      else await discoveryApi.removeFavorite(id!);
      toast.show(next ? t('liked.added') : t('liked.removed'), 'success');
    } catch {
      setFavoriteOverride(!next);
      toast.show(t('liked.toggleFailed'), 'error');
    }
  };

  const photoWidth = windowWidth - spacing.lg * 2;
  const name = p?.displayName ?? t('discover.someone');
  const title = [name, p?.age != null ? formatNumber(p.age) : null].filter(Boolean).join(', ');
  const meta = p ? [p.city, p.distance ? t(`discover.distance.${p.distance}`) : null].filter(Boolean).join(' · ') : '';
  const canAct = !!p && !p.matched && !matchId;
  const likeSurface: Surface = (SURFACES as readonly string[]).includes(surface ?? '') ? (surface as Surface) : 'search';

  const act = async (action: 'like' | 'pass' | 'super_like') => {
    setPending(true);
    setError(null);
    setGate(null);
    try {
      const result = await discoveryApi.like({ targetId: id!, action, surface: likeSurface });
      analytics.track(action === 'pass' ? 'pass_sent' : action === 'like' ? 'like_sent' : 'super_like_sent', { surface: likeSurface });
      if (result.matched) setMatch(result);
      else router.back();
    } catch (e) {
      const g = gateFor(e);
      if (g) setGate(g);
      else if (isApiError(e, 'CONFLICT')) router.back();
      else setError(e);
    } finally {
      setPending(false);
    }
  };

  const footer = canAct ? (
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xl }}>
      <IconButton icon="close" label={t('discover.pass')} onPress={() => void act('pass')} disabled={pending} size={60} color={colors.pass} testID="profile-pass" />
      <IconButton icon="star" label={t('discover.superLike')} onPress={() => void act('super_like')} disabled={pending} size={48} color={colors.superLike} testID="profile-super" />
      <IconButton icon="heart" label={t('discover.like')} onPress={() => void act('like')} disabled={pending} size={60} variant="gradient" testID="profile-like" />
    </View>
  ) : undefined;

  return (
    <Screen status={p ? 'ready' : profile.status} error={profile.error} onRetry={profile.reload} footer={footer} testID="user-profile-screen">
      {p ? (
        <View>
          <View style={{ borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surfaceAlt, marginBottom: spacing.lg }}>
            {photos.length ? (
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                accessibilityRole="list"
                onMomentumScrollEnd={(e) => setPhotoIndex(Math.round(e.nativeEvent.contentOffset.x / photoWidth))}
              >
                {photos.map((m, i) => (
                  <Image key={m.id} source={{ uri: m.url ?? m.thumbUrl! }} accessibilityLabel={t('media.photoN', { n: i + 1 })} style={{ width: photoWidth, height: photoWidth * 1.3 }} resizeMode="cover" />
                ))}
              </ScrollView>
            ) : (
              <View style={{ width: photoWidth, height: photoWidth * 0.8, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="heart-outline" size={72} color={colors.primary} />
              </View>
            )}
            <View style={{ position: 'absolute', top: spacing.lg, right: spacing.md, zIndex: 2 }}>
              <IconButton
                icon={favorited ? 'star' : 'star-outline'}
                label={favorited ? t('liked.removeFavorite', { name }) : t('liked.addFavorite', { name })}
                onPress={() => void toggleFavorite()}
                size={44}
                color={favorited ? colors.sparkle : colors.primary}
                testID="profile-favorite"
              />
            </View>
            {photos.length > 1 ? (
              <View pointerEvents="none" style={{ position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, flexDirection: 'row', gap: spacing.xs }}>
                {photos.map((m, i) => (
                  <View key={m.id} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i === photoIndex ? ON_PHOTO : 'rgba(255,255,255,0.4)' }} />
                ))}
              </View>
            ) : null}
            <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(53,27,63,0.55)', 'rgba(36,20,42,0.94)']} locations={[0, 0.45, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 120, padding: spacing.lg }}>
              {p.age != null ? (
                <View style={{ position: 'absolute', right: spacing.sm, bottom: spacing.xl }}>
                  <OutlinedNumeral value={formatNumber(p.age)} size={120} opacity={0.75} />
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingEnd: 90 }}>
                <Text accessibilityRole="header" accessibilityLabel={title} style={{ fontFamily: fonts.display, fontSize: 44, lineHeight: 48, color: ON_PHOTO, textTransform: 'uppercase', flexShrink: 1 }}>
                  {name}
                </Text>
                {p.verified ? <Ionicons name="checkmark-circle" size={22} color="#9FC5FF" accessibilityLabel={t('discover.verified')} /> : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm, paddingEnd: 90 }}>
                {meta ? <PhotoChip icon="location-outline" label={meta} /> : null}
                {p.datingIntent ? <PhotoChip icon="heart-outline" label={p.datingIntent.label} /> : null}
                {p.profession ? <PhotoChip icon="briefcase-outline" label={p.profession} /> : null}
              </View>
            </LinearGradient>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
            {p.recentlyActive ? <Badge label={t('discover.recentlyActive')} /> : null}
            {p.matched ? <Badge tone="primary" label={t('matches.matched')} /> : null}
          </View>

          {p.bio ? (
            <InfoCard title={t('home.aboutMe')} icon="person">
              <Text>{p.bio}</Text>
            </InfoCard>
          ) : null}

          {p.datingIntent || p.relationshipGoal || p.gender || p.profession || p.heightCm ? (
            <InfoCard title={t('home.basics')} icon="information-circle">
              {p.datingIntent ? <ListItem label={t('profile.identity.datingIntent')} value={p.datingIntent.label} /> : null}
              {p.relationshipGoal ? <ListItem label={t('profile.identity.relationshipGoal')} value={p.relationshipGoal.label} /> : null}
              {p.gender ? <ListItem label={t('profile.identity.gender')} value={p.gender.label} /> : null}
              {p.profession ? <ListItem label={t('profile.fields.profession')} value={p.profession} /> : null}
              {p.heightCm ? <ListItem label={t('profile.fields.heightCm')} value={t('profile.heightValue', { cm: formatNumber(p.heightCm) })} /> : null}
            </InfoCard>
          ) : null}

          {p.prompts.map((pr) => (
            <InfoCard key={pr.promptId} title={pr.prompt ?? t('profile.sections.prompts')} icon="chatbubble-ellipses">
              <Text variant="heading">{pr.answer}</Text>
            </InfoCard>
          ))}

          {p.interests.length ? (
            <InfoCard title={t('profile.sections.interests')} icon="sparkles">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {p.interests.map((i) => (i.label ? <Chip key={i.id} label={i.label} selected={false} onPress={() => undefined} disabled /> : null))}
              </View>
            </InfoCard>
          ) : null}

          {gate?.kind === 'paywall' ? (
            <View testID="profile-limit">
              <Notice tone="warning" title={t('discover.limitTitle')} body={gate.resetsAt ? t('discover.limitResets', { date: formatDateTime(gate.resetsAt) }) : t('discover.limitBody')} />
              <Button label={t('premium.upgrade')} onPress={() => openPaywall('discovery', gate.entitlement)} style={{ marginBottom: spacing.md }} />
            </View>
          ) : null}
          <FormError error={error} />

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            {conversationId ? <Button label={t('chat.message')} onPress={() => router.push({ pathname: '/chats/[id]', params: { id: conversationId } })} testID="profile-message" /> : null}
            {matchId ? <Button variant="secondary" label={t('dates.plan')} onPress={() => router.push({ pathname: '/dates/match/[matchId]', params: { matchId, name: p.displayName ?? '' } })} testID="profile-plan-date" /> : null}
          </View>

          <Text variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.xs }}>
            {t('safety.title')}
          </Text>
          <FormError error={safety.error} />
          <ListItem testID="profile-report" label={t('safety.report')} onPress={() => safety.report()} />
          <ListItem testID="profile-block" label={t('safety.block')} destructive onPress={safety.confirmBlock} />
          {matchId ? <ListItem testID="profile-unmatch" label={t('matches.unmatch')} destructive onPress={safety.confirmUnmatch} /> : null}
          <ListItem testID="profile-safety-center" label={t('safety.center')} onPress={() => router.push('/safety')} />
        </View>
      ) : null}
      {match ? (
        <MatchModal
          name={name}
          photoUrl={photos[0]?.thumbUrl ?? photos[0]?.url}
          onClose={() => {
            setMatch(null);
            router.back();
          }}
          onMessage={
            match.conversationId
              ? () => {
                  const cid = match.conversationId!;
                  setMatch(null);
                  router.replace({ pathname: '/chats/[id]', params: { id: cid } });
                }
              : undefined
          }
        />
      ) : null}
    </Screen>
  );
}
