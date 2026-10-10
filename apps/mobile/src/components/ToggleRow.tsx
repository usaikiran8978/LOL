import { StyleSheet, Switch, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH } from '../theme/tokens';
import { Text } from './Text';

export interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

export function ToggleRow({ label, description, value, onChange, disabled, testID }: ToggleRowProps) {
  const { colors, spacing } = useTheme();
  return (
    <View style={[styles.row, { paddingVertical: spacing.sm, borderBottomColor: colors.border }]}>
      <View style={{ flex: 1, marginEnd: spacing.md }}>
        <Text>{label}</Text>
        {description ? (
          <Text variant="caption" color="textMuted">
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={description}
        accessibilityState={{ checked: value, disabled: !!disabled }}
        trackColor={{ true: colors.primary, false: colors.borderStrong }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH, borderBottomWidth: StyleSheet.hairlineWidth },
});
