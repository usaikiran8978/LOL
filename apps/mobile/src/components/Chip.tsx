import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH } from '../theme/tokens';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** checkbox for multi-select groups, radio for single-select. */
  role?: 'checkbox' | 'radio';
  disabled?: boolean;
  testID?: string;
}

export function Chip({ label, selected, onPress, role = 'checkbox', disabled, testID }: ChipProps) {
  const { colors, radius, spacing } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      style={[
        styles.chip,
        {
          borderRadius: radius.pill,
          paddingHorizontal: spacing.lg,
          backgroundColor: selected ? colors.primary : colors.background,
          borderColor: selected ? colors.primary : colors.borderStrong,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text variant="label" color={selected ? 'onPrimary' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface ChipOption {
  value: string;
  label: string;
}

export interface ChipGroupProps {
  label: string;
  options: ChipOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  multiple?: boolean;
  /** Upper bound for multi-select; further chips are disabled once reached. */
  max?: number;
  hint?: string;
  error?: string | null;
  testID?: string;
}

export function ChipGroup({ label, options, selected, onChange, multiple = false, max, hint, error, testID }: ChipGroupProps) {
  const { spacing } = useTheme();
  const full = multiple && max !== undefined && selected.length >= max;
  const toggle = (value: string) => {
    if (!multiple) return onChange(selected[0] === value ? [] : [value]);
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };
  return (
    <View style={{ marginBottom: spacing.lg }} testID={testID}>
      <Text variant="label" style={{ marginBottom: spacing.xs }}>
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.sm }}>
          {hint}
        </Text>
      ) : null}
      <View accessibilityRole={multiple ? undefined : 'radiogroup'} accessibilityLabel={label} style={[styles.wrap, { gap: spacing.sm }]}>
        {options.map((o) => {
          const isOn = selected.includes(o.value);
          return (
            <Chip
              key={o.value}
              testID={testID ? `${testID}-${o.value}` : undefined}
              label={o.label}
              selected={isOn}
              role={multiple ? 'checkbox' : 'radio'}
              disabled={full && !isOn}
              onPress={() => toggle(o.value)}
            />
          );
        })}
      </View>
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert" style={{ marginTop: spacing.xs }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: MIN_TOUCH, justifyContent: 'center', borderWidth: 1.5 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
