import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Image, Modal, Pressable, View } from 'react-native';
import { LoveBackground, Text } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { elevation, fonts } from '../../theme/tokens';

const PLUM = '#351B3F';
const WINE = '#6B2F5B';
const CORAL = '#F27878';
const IVORY = '#FFF9F5';

/** Full-screen "It's a match!" celebration with a shortcut to the new conversation. Brand colours in both schemes. */
export function MatchModal({ name, photoUrl, onMessage, onClose }: { name: string; photoUrl?: string | null; onMessage?: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { spacing, radius } = useTheme();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} testID="match-modal">
      <LinearGradient colors={[PLUM, WINE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
        <LoveBackground tint={CORAL} />
        <Text accessibilityRole="alert" align="center" style={{ fontFamily: fonts.display, fontSize: 56, lineHeight: 60, color: IVORY, textTransform: 'uppercase', transform: [{ rotate: '-3deg' }] }}>
          {t('matchModal.headline')}
        </Text>
        <View style={[elevation.raised, { marginVertical: spacing.xl, transform: [{ rotate: '4deg' }], backgroundColor: IVORY, padding: spacing.sm, paddingBottom: spacing.xl, borderRadius: radius.sm }]}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} accessibilityLabel={t('discover.photoOf', { name })} style={{ width: 200, height: 240, borderRadius: radius.sm }} />
          ) : (
            <View style={{ width: 200, height: 240, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAE2F4', borderRadius: radius.sm }}>
              <Ionicons name="heart" size={72} color={CORAL} />
            </View>
          )}
          <Text align="center" style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: PLUM, textTransform: 'uppercase', marginTop: spacing.sm }} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <Text align="center" style={{ color: IVORY, marginBottom: spacing.xl }}>
          {t('home.matchBody', { name })}
        </Text>
        {onMessage ? (
          <Pressable
            testID="match-message"
            onPress={onMessage}
            accessibilityRole="button"
            style={({ pressed }) => ({ alignSelf: 'stretch', minHeight: 52, borderRadius: radius.pill, backgroundColor: IVORY, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1, marginBottom: spacing.md })}
          >
            <Text variant="label" style={{ fontSize: 16, fontWeight: '700', color: PLUM }}>
              {t('discover.sendMessage')}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          testID="match-close"
          onPress={onClose}
          accessibilityRole="button"
          style={({ pressed }) => ({ alignSelf: 'stretch', minHeight: 52, borderRadius: radius.pill, borderWidth: 2, borderColor: IVORY, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
        >
          <Text variant="label" style={{ fontSize: 16, fontWeight: '700', color: IVORY }}>
            {t('home.keepSwiping')}
          </Text>
        </Pressable>
      </LinearGradient>
    </Modal>
  );
}
