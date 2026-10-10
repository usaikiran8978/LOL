import { Image, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** Round photo with an initial fallback (no photo, still processing, or hidden by privacy settings). */
export function Avatar({ uri, name, size = 48, label, testID }: { uri?: string | null; name?: string | null; size?: number; label?: string; testID?: string }) {
  const { colors } = useTheme();
  const initial = (name ?? '').trim().charAt(0).toLocaleUpperCase();
  if (uri) {
    return <Image testID={testID} source={{ uri }} accessibilityLabel={label ?? name ?? undefined} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceAlt }} />;
  }
  return (
    <View
      testID={testID}
      accessible={!!(label ?? name)}
      accessibilityLabel={label ?? name ?? undefined}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text variant="heading" color="primary" importantForAccessibility="no">
        {initial}
      </Text>
    </View>
  );
}
