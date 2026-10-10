import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface BadgeProps {
  label: string;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
  accessibilityLabel?: string;
  testID?: string;
}

/** Small status pill (unread count, RSVP state, verification state…). */
export function Badge({ label, tone = 'neutral', accessibilityLabel, testID }: BadgeProps) {
  const { colors, radius, spacing } = useTheme();
  const palette = {
    neutral: { bg: colors.surfaceAlt, fg: 'textMuted' },
    primary: { bg: colors.primary, fg: 'onPrimary' },
    success: { bg: colors.successSoft, fg: 'success' },
    warning: { bg: colors.warningSoft, fg: 'warning' },
    danger: { bg: colors.dangerSoft, fg: 'danger' },
  }[tone] as { bg: string; fg: 'textMuted' | 'onPrimary' | 'success' | 'warning' | 'danger' };
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      style={{ backgroundColor: palette.bg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, alignSelf: 'flex-start' }}
    >
      <Text variant="caption" color={palette.fg}>
        {label}
      </Text>
    </View>
  );
}
