import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { fonts } from '../theme/tokens';
import { Text } from './Text';

/** Heart + "LOL" wordmark with the "Lot of Love" tagline, used in app bars. */
export function BrandMark({ size = 22, showTagline = true }: { size?: number; showTagline?: boolean }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <View style={{ alignItems: 'center' }} accessible accessibilityRole="header" accessibilityLabel={`${t('common.appName')}, ${t('common.tagline')}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Ionicons name="heart" size={size - 2} color={colors.accent} />
        <Text style={{ fontFamily: fonts.display, fontSize: size + 2, lineHeight: size + 8, letterSpacing: 2 }} color="primary">
          {t('common.appName').toLocaleUpperCase()}
        </Text>
      </View>
      {showTagline ? (
        <Text style={{ fontSize: 9, lineHeight: 11, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase' }} color="accentText">
          {t('common.tagline')}
        </Text>
      ) : null}
    </View>
  );
}
