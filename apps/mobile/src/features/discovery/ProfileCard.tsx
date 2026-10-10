import { useTranslation } from 'react-i18next';
import { Image, Pressable, View } from 'react-native';
import type { Card, Factor } from '../../api/discovery';
import { Badge, Chip, Text } from '../../components';
import { formatNumber, formatPercent } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

/** Localized explanation line for one factor (`match.reason.<category>` with server params; label fallback). */
export function useFactorText() {
  const { t } = useTranslation();
  return (f: Factor) => {
    const fallback = t(f.reasonKey.startsWith('match.difference.') ? 'discover.differenceFallback' : 'discover.reasonFallback', { label: f.label });
    return t(`discover.reasons.${f.reasonKey.replace(/^match\./, '').replace('.', '_')}`, { ...f.params, label: f.label, defaultValue: fallback });
  };
}

export function CompatibilityPanel({ card, testID }: { card: Pick<Card, 'compatibility' | 'topFactors' | 'differences' | 'breakdown'>; testID?: string }) {
  const { t } = useTranslation();
  const { spacing, colors, radius } = useTheme();
  const text = useFactorText();
  if (card.compatibility === null) return null;
  return (
    <View testID={testID} style={{ backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md }}>
      <Text variant="heading" color="primary" accessibilityLabel={t('discover.compatibilityA11y', { percent: formatPercent(card.compatibility) })}>
        {t('discover.compatibility', { percent: formatPercent(card.compatibility) })}
      </Text>
      {card.topFactors.length ? (
        <View style={{ marginTop: spacing.sm }}>
          <Text variant="label">{t('discover.whyMatch')}</Text>
          {card.topFactors.map((f) => (
            <Text key={`top-${f.categoryKey}`} variant="caption" style={{ marginTop: spacing.xxs }}>
              {`• ${text(f)}`}
            </Text>
          ))}
        </View>
      ) : null}
      {card.differences?.length ? (
        <View style={{ marginTop: spacing.sm }} testID={testID ? `${testID}-differences` : undefined}>
          <Text variant="label">{t('discover.differences')}</Text>
          {card.differences.map((f) => (
            <Text key={`diff-${f.categoryKey}`} variant="caption" style={{ marginTop: spacing.xxs }}>
              {`• ${text(f)}`}
            </Text>
          ))}
        </View>
      ) : null}
      {card.breakdown?.length ? (
        <View style={{ marginTop: spacing.sm }}>
          {card.breakdown.map((b) => (
            <Text key={`b-${b.categoryKey}`} variant="caption" color="textMuted">
              {t('discover.breakdownRow', { label: b.label, percent: formatPercent(b.score) })}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Discovery card: photo, essentials, prompt, shared interests and the compatibility explanation. */
export function ProfileCard({ card, onOpen, compact }: { card: Card; onOpen?: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  const { spacing, radius, colors } = useTheme();
  const photo = card.photos[0];
  const title = [card.displayName ?? t('discover.someone'), card.age !== null ? formatNumber(card.age) : null].filter(Boolean).join(', ');
  const meta = [card.city, card.distance ? t(`discover.distance.${card.distance}`) : null].filter(Boolean).join(' · ');
  return (
    <View testID={`card-${card.userId}`} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface }}>
      <Pressable onPress={onOpen} disabled={!onOpen} accessibilityRole={onOpen ? 'button' : undefined} accessibilityLabel={t('discover.openProfile', { name: title })}>
        {photo?.url || photo?.thumbUrl ? (
          <Image source={{ uri: (compact ? photo.thumbUrl : photo.url) ?? photo.url ?? photo.thumbUrl! }} accessibilityLabel={t('discover.photoOf', { name: card.displayName ?? '' })} style={{ width: '100%', aspectRatio: compact ? 2 : 0.85, backgroundColor: colors.surfaceAlt }} />
        ) : (
          <View style={{ width: '100%', aspectRatio: compact ? 3 : 1.4, backgroundColor: colors.surfaceAlt, justifyContent: 'center' }}>
            <Text color="textMuted" align="center">
              {t('discover.noPhoto')}
            </Text>
          </View>
        )}
      </Pressable>
      <View style={{ padding: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
          <Text variant="title">{title}</Text>
          {card.verified ? <Badge tone="success" label={t('discover.verified')} /> : null}
          {card.recentlyActive ? <Badge label={t('discover.recentlyActive')} /> : null}
        </View>
        {meta ? <Text color="textMuted">{meta}</Text> : null}
        {card.datingIntent ? <Text variant="label" style={{ marginTop: spacing.xs }}>{card.datingIntent.label}</Text> : null}
        {!compact && card.bio ? <Text style={{ marginTop: spacing.sm }}>{card.bio}</Text> : null}
        {!compact && card.prompt ? (
          <View style={{ marginTop: spacing.sm }}>
            {card.prompt.prompt ? <Text variant="label">{card.prompt.prompt}</Text> : null}
            <Text>{card.prompt.answer}</Text>
          </View>
        ) : null}
        {card.sharedInterests.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }} accessibilityLabel={t('discover.sharedInterests')}>
            {card.sharedInterests.map((i) => (i.label ? <Chip key={i.id} label={i.label} selected={false} onPress={() => undefined} disabled /> : null))}
          </View>
        ) : null}
        <CompatibilityPanel card={card} testID={`compat-${card.userId}`} />
      </View>
    </View>
  );
}
