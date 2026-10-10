import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { profileApi } from '../../api';
import { useSession } from '../../auth/SessionProvider';
import { Avatar, BrandMark, Button, IconButton, LoveBackground, Notice, Text } from '../../components';
import { useFlag } from '../../config/ConfigProvider';
import { HomeDeck } from '../../features/discovery/HomeDeck';
import { completeProfileHref } from '../../features/profile/completeProfile';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useResource } from '../../hooks/useResource';
import { useTheme } from '../../theme/ThemeProvider';

function greetingKey(hour: number) {
  if (hour < 12) return 'home.greetingMorning';
  if (hour < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

function ModeChip({ label, active, onPress, testID }: { label: string; active?: boolean; onPress: () => void; testID: string }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => ({
        minHeight: 36,
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? colors.primary : colors.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text variant="label" color={active ? 'onPrimary' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Discover tab: personalised greeting, discovery modes, and the swipe deck. Secondary features sit behind the avatar menu. */
export default function HomeScreen() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const profile = useResource(profileApi.me);
  useRefreshOnFocus(profile.reload);
  const travelOn = useFlag('travel_mode');
  const p = profile.data;
  const avatar = p?.media.find((m) => m.kind === 'photo' && (m.thumbUrl || m.url));
  const completeProfile = () => router.push(p ? completeProfileHref(p, !!user?.onboardingCompleted) : '/onboarding');
  const modes: Array<{ key: string; label: string; href: Href }> = [
    { key: 'smart', label: t('discover.surfaces.smart'), href: '/matchmaker' },
    { key: 'daily', label: t('discover.surfaces.daily'), href: '/discover' },
    { key: 'likes', label: t('discover.likesYou'), href: '/discover/likes' },
    { key: 'liked', label: t('liked.tabLiked'), href: '/liked' },
    { key: 'favorites', label: t('liked.tabFavorites'), href: { pathname: '/liked', params: { tab: 'favorites' } } },
    ...(travelOn ? [{ key: 'travel', label: t('travel.title'), href: '/travel' as Href }] : []),
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']} testID="home-screen">
      <LoveBackground />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
        <Pressable
          testID="home-menu"
          onPress={() => router.push('/menu')}
          accessibilityRole="button"
          accessibilityLabel={t('home.menu')}
          hitSlop={8}
          style={({ pressed }) => ({ borderWidth: 2, borderColor: colors.accent, borderRadius: 24, padding: 2, opacity: pressed ? 0.7 : 1 })}
        >
          <Avatar uri={avatar?.thumbUrl ?? avatar?.url} name={p?.displayName ?? user?.email ?? ''} size={38} />
        </Pressable>
        <BrandMark />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <IconButton icon="search" label={t('discover.search')} onPress={() => router.push('/discover/search')} testID="home-search" />
          <IconButton icon="chatbubbles" label={t('home.chats')} onPress={() => router.push('/chats')} testID="home-chats" />
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 }}>
        {user?.status === 'deactivated' ? (
          <>
            <Notice tone="danger" title={t('dataPrivacy.deletionPending')} testID="home-deletion" />
            <Button variant="secondary" label={t('dataPrivacy.restoreOrView')} onPress={() => router.push('/settings/data')} testID="home-restore" />
          </>
        ) : user ? (
          <>
            <Text color="textMuted" style={{ marginTop: spacing.xs }} testID="home-greeting">
              {p?.displayName ? t(greetingKey(new Date().getHours()), { name: p.displayName }) : t(`${greetingKey(new Date().getHours())}Plain`)}
            </Text>
            <Text variant="display" style={{ marginBottom: spacing.md }}>
              {t('home.pickedForYou')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.lg }}>
              <ModeChip label={t('discover.surfaces.swipe')} active onPress={() => undefined} testID="home-mode-swipe" />
              {modes.map((m) => (
                <ModeChip key={m.key} label={m.label} onPress={() => router.push(m.href)} testID={`home-mode-${m.key}`} />
              ))}
            </ScrollView>
            <HomeDeck onCompleteProfile={completeProfile} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
