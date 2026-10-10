import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { CONTROL_HEIGHT } from '../theme/tokens';
import { Text } from './Text';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, variant = 'primary', disabled, loading, accessibilityHint, testID, style }: ButtonProps) {
  const { colors, radius, spacing } = useTheme();
  const inactive = disabled || loading;
  const palette = {
    primary: { bg: colors.gradientStart, fg: 'onGradient', border: 'transparent' },
    secondary: { bg: colors.background, fg: 'primary', border: colors.primary },
    ghost: { bg: 'transparent', fg: 'primary', border: 'transparent' },
    danger: { bg: colors.danger, fg: 'onDanger', border: colors.danger },
  }[variant] as { bg: string; fg: 'onGradient' | 'primary' | 'onDanger'; border: string };

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.bg, borderColor: palette.border, borderRadius: radius.pill, paddingHorizontal: spacing.xl, opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {variant === 'primary' ? <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
      <View style={styles.row}>
        {loading ? <ActivityIndicator color={colors[palette.fg]} style={{ marginEnd: spacing.sm }} /> : null}
        <Text variant="label" color={palette.fg} style={styles.label} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: CONTROL_HEIGHT, minWidth: CONTROL_HEIGHT, justifyContent: 'center', borderWidth: 1.5, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
