import { useRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface OtpInputProps {
  label: string;
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  length?: number;
  error?: string | null;
  testID?: string;
}

/**
 * One real TextInput (so SMS autofill, paste and screen readers work as a single field) rendered as digit boxes.
 */
export function OtpInput({ label, value, onChange, onComplete, length = 6, error, testID }: OtpInputProps) {
  const { colors, radius, spacing, typography } = useTheme();
  const ref = useRef<TextInput>(null);
  const digits = value.split('');

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" style={{ marginBottom: spacing.xs }}>
        {label}
      </Text>
      <Pressable onPress={() => ref.current?.focus()} accessible={false} style={styles.row}>
        {Array.from({ length }, (_, i) => (
          <View
            key={i}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={[styles.box, { borderColor: error ? colors.danger : i === value.length ? colors.focus : colors.borderStrong, borderRadius: radius.md, backgroundColor: colors.surface }]}
          >
            <Text variant="title">{digits[i] ?? ''}</Text>
          </View>
        ))}
      </Pressable>
      <TextInput
        ref={ref}
        testID={testID}
        value={value}
        onChangeText={(v) => {
          const code = v.replace(/\D/g, '').slice(0, length);
          onChange(code);
          if (code.length === length) onComplete?.(code);
        }}
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus
        style={[typography.body, styles.hidden]}
      />
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ marginTop: spacing.xs }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  box: { flex: 1, minHeight: 52, maxWidth: 52, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  // Kept in the layout (not display:none) so focus and autofill still work; visually collapsed behind the boxes.
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
});
