import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { discoveryApi, type Card } from '../../api/discovery';
import { Button, IconButton, Screen, Text, useToast } from '../../components';
import { usePaged, type Page } from '../../hooks/usePaged';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';
import { elevation, fonts } from '../../theme/tokens';

type Tab = 'liked' | 'favorites';

/** One profile in either list, normalised so both tabs share the grid. */
interface Entry {
  profile: Card;
  matched: boolean;
  conversationId: string | null;
  superLike: boolean;
  liked: boolean;
  favorited: boolean;
}

const loadLiked = async (cursor?: string): Promise<Page<Entry>> => {
  const r = await discoveryApi.likesSent(cursor);
  return { nextCursor: r.nextCursor, items: r.items.map((i) => ({ profile: i.profile, matched: i.matched, conversationId: i.conversationId, superLike: i.superLike, liked: true, favorited: i.favorited })) };
};
const loadFavorites = async (cursor?: string): Promise<Page<Entry>> => {
  const r = await discoveryApi.favorites(cursor);
  return { nextCursor: r.nextCursor, items: r.items.map((i) => ({ profile: i.profile, matched: i.matched, conversationId: null, superLike: false, liked: i.liked, favorited: true })) };
};

function Tile({ entry, onOpen, onToggleFavorite, onMessage }: { entry: Entry; onOpen: () => void; onToggleFavorite: () => void; onMessage?: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const p = entry.profile;
  const photo = p.photos.find((x) => x.thumbUrl || x.url);
  const name = p.displayName ?? t('discover.someone');
  const title = [name, p.age !== null ? formatNumber(p.age) : null].filter(Boolean).join(', ');
  const badge = entry.matched
    ? { icon: 'heart' as const, label: t('liked.badgeMatched'), bg: colors.primary }
    : entry.superLike
      ? { icon: 'star' as const, label: t('liked.badgeSuperLike'), bg: '#5B3FB0' }
      : entry.liked
        ? { icon: 'heart-outline' as const, label: t('liked.badgeLiked'), bg: 'rgba(36,20,42,0.6)' }
        : null;
  return (
    <View style={[elevation.card, { flex: 1, borderRadius: radius.lg }]} testID={`liked-tile-${p.userId}`}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={t('discover.openProfile', { name: title })} style={{ borderRadius: radius.lg, overflow: 'hidden', aspectRatio: 0.75, backgroundColor: colors.primarySoft }}>
        {photo ? <Image source={{ uri: photo.thumbUrl ?? photo.url! }} style={StyleSheet.absoluteFill} accessibilityLabel={t('discover.photoOf', { name })} /> : (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="person-outline" size={44} color={colors.primary} />
          </View>
        )}
        <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(36,20,42,0.88)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 48, padding: spacing.md }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 26, color: '#FFFFFF', textTransform: 'uppercase' }} numberOfLines={1}>
            {title}
          </Text>
          {p.city ? (
            <Text variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }} numberOfLines={1}>
              {p.city}
            </Text>
          ) : null}
        </LinearGradient>
        {badge ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: spacing.sm, left: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: badge.bg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
            <Ionicons name={badge.icon} size={11} color="#FFFFFF" />
            <Text variant="caption" style={{ color: '#FFFFFF', fontWeight: '700' }}>
              {badge.label}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <View style={{ position: 'absolute', top: spacing.xs, right: spacing.xs }}>
        <IconButton
          icon={entry.favorited ? 'star' : 'star-outline'}
          label={entry.favorited ? t('liked.removeFavorite', { name }) : t('liked.addFavorite', { name })}
          onPress={onToggleFavorite}
          size={36}
          color={entry.favorited ? colors.sparkle : colors.primary}
          testID={`liked-fav-${p.userId}`}
        />
      </View>
      {onMessage ? (
        <View style={{ position: 'absolute', bottom: spacing.sm, right: spacing.sm }}>
          <IconButton icon="chatbubble" label={t('liked.message', { name })} onPress={onMessage} size={36} variant="gradient" testID={`liked-msg-${p.userId}`} />
        </View>
      ) : null}
    </View>
  );
}

/** "Liked & Favourites": everyone I liked (with match state) and my private favourites, as a photo grid. */
export default function LikedScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'favorites' ? 'favorites' : 'liked');
  const liked = usePaged(loadLiked);
  const favorites = usePaged(loadFavorites);
  const list = tab === 'liked' ? liked : favorites;
  // Favourites/likes can change on the profile screen: refresh both when we come back.
  const { reload: reloadLiked } = liked;
  const { reload: reloadFavorites } = favorites;
  useRefreshOnFocus(
    useCallback(() => {
      reloadLiked();
      reloadFavorites();
    }, [reloadLiked, reloadFavorites]),
  );

  const toggleFavorite = async (entry: Entry) => {
    const id = entry.profile.userId;
    const next = !entry.favorited;
    const apply = (value: boolean) => liked.setItems((xs) => xs.map((x) => (x.profile.userId === id ? { ...x, favorited: value } : x)));
    apply(next);
    if (next) favorites.setItems((xs) => (xs.some((x) => x.profile.userId === id) ? xs : [{ ...entry, favorited: true }, ...xs]));
    else favorites.setItems((xs) => xs.filter((x) => x.profile.userId !== id));
    try {
      if (next) await discoveryApi.addFavorite(id);
      else await discoveryApi.removeFavorite(id);
      toast.show(next ? t('liked.added') : t('liked.removed'), 'success');
    } catch {
      apply(!next);
      reloadFavorites();
      toast.show(t('liked.toggleFailed'), 'error');
    }
  };

  const tabs: Array<{ key: Tab; label: string; icon: 'heart' | 'star' }> = [
    { key: 'liked', label: t('liked.tabLiked'), icon: 'heart' },
    { key: 'favorites', label: t('liked.tabFavorites'), icon: 'star' },
  ];
  const rows: Entry[][] = [];
  for (let i = 0; i < list.items.length; i += 2) rows.push(list.items.slice(i, i + 2));

  return (
    <Screen testID="liked-screen" status={list.status} error={list.error} onRetry={list.reload}
      header={
        <View style={{ marginBottom: spacing.lg }}>
          <Text variant="label" color="accentText" style={{ letterSpacing: 1.2, textTransform: 'uppercase' }}>
            {t('liked.eyebrow')}
          </Text>
          <Text variant="display">{t('liked.title')}</Text>
          <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, padding: 4, marginTop: spacing.md }} accessibilityRole="tablist">
            {tabs.map((x) => {
              const active = tab === x.key;
              return (
                <Pressable
                  key={x.key}
                  testID={`liked-tab-${x.key}`}
                  onPress={() => setTab(x.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={{ flex: 1, minHeight: 40, flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: active ? colors.primary : 'transparent' }}
                >
                  <Ionicons name={x.icon} size={16} color={active ? colors.accent : colors.textMuted} />
                  <Text variant="label" color={active ? 'onPrimary' : 'textMuted'}>
                    {x.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      }
    >
      {list.items.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: spacing.xxl }} testID={`liked-empty-${tab}`}>
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg }}>
            <Ionicons name={tab === 'liked' ? 'heart-outline' : 'star-outline'} size={44} color={colors.primary} />
          </View>
          <Text variant="title" align="center">
            {tab === 'liked' ? t('liked.emptyLikedTitle') : t('liked.emptyFavoritesTitle')}
          </Text>
          <Text color="textMuted" align="center" style={{ marginTop: spacing.xs }}>
            {tab === 'liked' ? t('liked.emptyLikedBody') : t('liked.emptyFavoritesBody')}
          </Text>
          <Button label={t('home.discover')} onPress={() => router.push('/home')} style={{ marginTop: spacing.lg, alignSelf: 'stretch' }} />
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          {rows.map((row) => (
            <View key={row.map((e) => e.profile.userId).join('-')} style={{ flexDirection: 'row', gap: spacing.md }}>
              {row.map((e) => (
                <Tile
                  key={e.profile.userId}
                  entry={e}
                  onOpen={() => router.push({ pathname: '/users/[id]', params: { id: e.profile.userId } })}
                  onToggleFavorite={() => void toggleFavorite(e)}
                  onMessage={e.conversationId ? () => router.push({ pathname: '/chats/[id]', params: { id: e.conversationId! } }) : undefined}
                />
              ))}
              {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
            </View>
          ))}
          {list.hasMore ? <Button variant="secondary" label={t('common.loadMore')} onPress={list.loadMore} loading={list.loadingMore} testID="liked-more" /> : null}
        </View>
      )}
    </Screen>
  );
}
