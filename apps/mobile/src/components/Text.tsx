import { Text as RNText, type TextProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Palette, TypeVariant } from '../theme/tokens';

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  color?: keyof Palette;
  align?: 'auto' | 'left' | 'center' | 'right';
}

/** All text goes through here so typography and colour stay token-driven and Dynamic Type keeps working. */
export function Text({ variant = 'body', color = 'text', align, style, ...rest }: AppTextProps) {
  const { colors, typography } = useTheme();
  const isHeading = variant === 'display' || variant === 'title' || variant === 'heading';
  return (
    <RNText
      accessibilityRole={isHeading ? 'header' : undefined}
      maxFontSizeMultiplier={2}
      {...rest}
      style={[typography[variant], { color: colors[color], textAlign: align ?? 'auto', writingDirection: 'auto' }, style]}
    />
  );
}
