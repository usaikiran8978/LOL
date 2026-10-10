import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH } from '../theme/tokens';
import { Text } from './Text';

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
  testID?: string;
  children?: ReactNode;
}

export function Checkbox({ label, checked, onChange, error, testID, children }: CheckboxProps) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Pressable
        testID={testID}
        onPress={() => onChange(!checked)}
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityState={{ checked }}
        style={styles.row}
      >
        <View style={[styles.box, { borderRadius: radius.sm, borderColor: error ? colors.danger : colors.borderStrong, backgroundColor: checked ? colors.primary : colors.background }]}>
          {checked ? (
            <Text variant="label" color="onPrimary" importantForAccessibility="no">
              ✓
            </Text>
          ) : null}
        </View>
        <Text style={{ flex: 1, marginStart: spacing.md }}>{label}</Text>
      </Pressable>
      {children}
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH },
  box: { width: 24, height: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
