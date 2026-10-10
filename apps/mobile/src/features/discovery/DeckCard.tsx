import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import type { Card } from '../../api/discovery';
import { Avatar, OutlinedNumeral, PhotoChip, Text } from '../../components';
import { formatNumber, formatPercent } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';
import { elevation, fonts } from '../../theme/tokens';

const ON_PHOTO = '#FFFFFF';
const MAX_CHIPS = 3;

/**
 * Editorial full-photo discovery card. Tapping the left / right third cycles photos, the middle opens the full profile.
 * `actions` (pass / like controls) are overlaid on the card edges for the top card only.
 */
export function DeckCard({ card, onOpen, actions }: { card: Card; onOpen: () => void; actions?: ReactNode }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const photos = card.photos.filter((p) => p.url || p.thumbUrl);
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const photo = photos[Math.min(index, photos.length - 1)];
  const name = card.displayName ?? t('discover.someone');
  const a11yTitle = [name, card.age !== null ? formatNumber(card.age) : null].filter(Boolean).join(', ');

  const chips: Array<{ icon: 'location-outline' | 'sparkles-outline' | 'heart-outline'; label: string }> = [];
  const place = [card.distance ? t(`discover.distance.${card.distance}`) : null, card.city].filter(Boolean)[0];
  if (place) chips.push({ icon: 'location-outline', label: place });
  if (card.datingIntent) chips.push({ icon: 'heart-outline', label: card.datingIntent.label });
  for (const i of card.sharedInterests) if (i.label) chips.push({ icon: 'sparkles-outline', label: i.label });
  const extra = chips.length - MAX_CHIPS;

  const onTap = (e?: GestureResponderEvent) => {
    // Assistive-tech activation may carry no touch point: treat it as "open profile".
    const x = e?.nativeEvent?.locationX;
    if (typeof x === 'number' && photos.length >= 2 && width > 0) {
      if (x * 3 < width) return setIndex((i) => Math.max(0, i - 1));
      if (x * 3 > width * 2) return setIndex((i) => Math.min(photos.length - 1, i + 1));
    }
    onOpen();
  };

  return (
    <View style={[elevation.raised, { borderRadius: radius.xl }]} testID={`card-${card.userId}`}>
      <View style={{ borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.primarySoft, aspectRatio: 0.64 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <Pressable testID="deck-card-open" style={StyleSheet.absoluteFill} onPress={onTap} accessibilityRole="button" accessibilityLabel={t('discover.openProfile', { name: a11yTitle })}>
          {photo ? (
            <Image source={{ uri: photo.url ?? photo.thumbUrl! }} accessibilityLabel={t('discover.photoOf', { name })} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="person-outline" size={72} color={colors.primary} />
              <Text color="textMuted" style={{ marginTop: spacing.sm }}>
                {t('discover.noPhoto')}
              </Text>
            </View>
          )}
        </Pressable>

        {photos.length > 1 ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: spacing.sm, left: spacing.md, right: spacing.md, flexDirection: 'row', gap: spacing.xs }}>
            {photos.map((p, i) => (
              <View key={p.id} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i === index ? ON_PHOTO : 'rgba(255,255,255,0.35)' }} />
            ))}
          </View>
        ) : null}

        {card.compatibility !== null ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: spacing.lg + spacing.xs, right: spacing.md }}>
            <PhotoChip icon="sparkles" label={t('discover.compatibility', { percent: formatPercent(card.compatibility) })} />
          </View>
        ) : null}

        <LinearGradient pointerEvents="box-none" colors={['transparent', 'rgba(53,27,63,0.55)', 'rgba(36,20,42,0.94)']} locations={[0, 0.45, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 140, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
          {card.age !== null ? (
            <View pointerEvents="none" style={{ position: 'absolute', right: spacing.sm, bottom: spacing.xxl }}>
              <OutlinedNumeral value={formatNumber(card.age)} size={128} color={ON_PHOTO} opacity={0.75} />
            </View>
          ) : null}
          <View pointerEvents="none">
            <View style={{ borderWidth: 2, borderColor: ON_PHOTO, borderRadius: 26, alignSelf: 'flex-start', marginBottom: spacing.sm }}>
              <Avatar uri={photos[photos.length > 1 ? 1 : 0]?.thumbUrl ?? photo?.thumbUrl} name={name} size={44} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingEnd: 96 }}>
              <Text style={{ fontFamily: fonts.display, fontSize: 44, lineHeight: 48, color: ON_PHOTO, textTransform: 'uppercase', flexShrink: 1 }} numberOfLines={2} accessibilityRole="header">
                {name}
              </Text>
              {card.verified ? <Ionicons name="checkmark-circle" size={22} color="#9FC5FF" accessibilityLabel={t('discover.verified')} /> : null}
            </View>
            {card.bio ? (
              <Text numberOfLines={2} style={{ color: 'rgba(255,255,255,0.88)', marginTop: spacing.xs, paddingEnd: 96 }}>
                {card.bio}
              </Text>
            ) : null}
            {chips.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md }}>
                {chips.slice(0, MAX_CHIPS).map((c) => (
                  <PhotoChip key={`${c.icon}-${c.label}`} icon={c.icon} label={c.label} />
                ))}
                {extra > 0 ? <PhotoChip label={`+${formatNumber(extra)}`} /> : null}
              </View>
            ) : null}
          </View>
        </LinearGradient>

        {actions ? (
          <View pointerEvents="box-none" style={{ position: 'absolute', left: spacing.md, right: spacing.md, top: '42%', flexDirection: 'row', justifyContent: 'space-between' }}>
            {actions}
          </View>
        ) : null}
      </View>
    </View>
  );
}
