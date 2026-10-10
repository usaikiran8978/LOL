import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { IconName } from './IconButton';
import { Text } from './Text';

/** Translucent pill for text laid over photos (location, intent, interests). */
export function PhotoChip({ icon, label }: { icon?: IconName; label: string }) {
  const { spacing, radius } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)', backgroundColor: 'rgba(36,20,42,0.35)', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
      {icon ? <Ionicons name={icon} size={14} color="#FFFFFF" /> : null}
      <Text variant="label" style={{ color: '#FFFFFF' }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
