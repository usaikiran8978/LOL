import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH } from '../theme/tokens';
import { Text } from './Text';

export interface ListItemProps {
  label: string;
  value?: string;
  description?: string;
  onPress?: () => void;
  /** Visible "Not available yet" state for entries the API does not support; never a silent dead button. */
  unavailable?: boolean;
  destructive?: boolean;
  testID?: string;
}

export function ListItem({ label, value, description, onPress, unavailable, destructive, testID }: ListItemProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const interactive = !!onPress && !unavailable;
  return (
    <Pressable
      testID={testID}
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : 'text'}
      accessibilityLabel={[label, value, unavailable ? t('common.unavailable') : undefined].filter(Boolean).join(', ')}
      accessibilityHint={description}
      accessibilityState={{ disabled: !interactive }}
      style={({ pressed }) => [styles.row, { paddingVertical: spacing.md, borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={{ flex: 1 }}>
        <Text color={destructive ? 'danger' : unavailable ? 'textMuted' : 'text'}>{label}</Text>
        {description ? (
          <Text variant="caption" color="textMuted">
            {description}
          </Text>
        ) : null}
      </View>
      {unavailable ? (
        <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs }}>
          <Text variant="caption" color="textMuted">
            {t('common.comingSoon')}
          </Text>
        </View>
      ) : value ? (
        <Text variant="label" color="textMuted" style={{ marginStart: spacing.sm }}>
          {value}
        </Text>
      ) : null}
      {interactive ? (
        <Text color="textMuted" importantForAccessibility="no" style={{ marginStart: spacing.sm }}>
          {I18nManager.isRTL ? '‹' : '›'}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH, borderBottomWidth: StyleSheet.hairlineWidth },
});
