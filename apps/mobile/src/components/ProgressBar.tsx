import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function ProgressBar({ value, label, testID }: { value: number; label: string; testID?: string }) {
  const { colors, radius } = useTheme();
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: colors.primary }} />
    </View>
  );
}
