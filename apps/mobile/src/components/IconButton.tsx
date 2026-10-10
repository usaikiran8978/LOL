import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH } from '../theme/tokens';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Round icon-only button. `label` is required: it is the accessible name (there is no visible text). */
export function IconButton({
  icon,
  label,
  onPress,
  size = MIN_TOUCH,
  color,
  variant = 'surface',
  disabled,
  testID,
  style,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  /** Icon colour; defaults to the variant's foreground. */
  color?: string;
  variant?: 'surface' | 'gradient' | 'plain';
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const fg = color ?? (variant === 'gradient' ? colors.onGradient : colors.primary);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={Math.max(0, (MIN_TOUCH - size) / 2)}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size, borderRadius: size / 2, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] },
        variant === 'surface' ? [styles.shadow, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }] : null,
        variant === 'gradient' ? styles.shadow : null,
        style,
      ]}
    >
      {variant === 'gradient' ? (
        <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]} />
      ) : null}
      <Ionicons name={icon} size={Math.round(size * 0.48)} color={fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  shadow: { shadowColor: '#7A1440', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
});
