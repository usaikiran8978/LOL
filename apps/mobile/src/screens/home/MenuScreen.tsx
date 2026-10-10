import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, View } from 'react-native';
import { profileApi } from '../../api';
import { AI_FLAGS } from '../../api/ai';
import { useSession } from '../../auth/SessionProvider';
import { Avatar, Button, type IconName, Notice, ProgressBar, Screen, Text } from '../../components';
import { useFlag } from '../../config/ConfigProvider';
import { completeProfileHref } from '../../features/profile/completeProfile';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useResource } from '../../hooks/useResource';
import { formatNumber, formatPercent } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

function MenuRow({ icon, label, href, testID }: { icon: IconName; label: string; href: Href; testID: string }) {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      testID={testID}
      onPress={() => router.push(href)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={{ flex: 1 }}>{label}</Text>
      <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function Group({ children }: { children: ReactNode }) {
  const { colors, spacing, radius } = useTheme();
  return <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border }}>{children}</View>;
}

/** Everything that is not the deck: own profile summary + completion, then every member feature. */
export default function MenuScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const profile = useResource(profileApi.me);
  useRefreshOnFocus(profile.reload);
  const p = profile.data;
  const avatar = p?.media.find((m) => m.kind === 'photo' && (m.thumbUrl || m.url));
  const eventsOn = useFlag('events');
  const travelOn = useFlag('travel_mode');
  const coachOn = useFlag(AI_FLAGS.coach);
  const incomplete = !!p && (p.completeness < 100 || !user?.onboardingCompleted);

  return (
    <Screen testID="menu-screen">
      <View style={{ alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
        <View style={{ borderWidth: 3, borderColor: colors.primary, borderRadius: 60, padding: 3 }}>
          <Avatar uri={avatar?.thumbUrl ?? avatar?.url} name={p?.displayName ?? user?.email ?? ''} size={104} />
        </View>
        <Text variant="title" align="center" style={{ marginTop: spacing.md }}>
          {[p?.displayName ?? t('profile.title'), p?.age ? formatNumber(p.age) : null].filter(Boolean).join(', ')}
        </Text>
        {p ? (
          <View style={{ alignSelf: 'stretch', marginTop: spacing.lg }}>
            <ProgressBar value={p.completeness} label={t('profile.completeness', { percent: formatPercent(p.completeness) })} />
            <Text variant="caption" color="textMuted" align="center" style={{ marginTop: spacing.xs }}>
              {t('profile.completeness', { percent: formatPercent(p.completeness) })}
            </Text>
          </View>
        ) : null}
        {incomplete ? <Button label={t('home.completeProfile')} onPress={() => router.push(completeProfileHref(p!, !!user?.onboardingCompleted))} testID="menu-complete-profile" style={{ alignSelf: 'stretch', marginTop: spacing.lg }} /> : null}
        <Button variant="secondary" label={t('home.viewProfile')} onPress={() => router.push('/profile')} testID="menu-profile" style={{ alignSelf: 'stretch', marginTop: spacing.sm }} />
      </View>

      {user && !user.emailVerified && !user.phoneVerified ? (
        <View style={{ marginBottom: spacing.lg }}>
          <Notice tone="warning" title={t('home.verifyContact')} />
          <Button variant="secondary" label={t('verify.title')} onPress={() => router.push({ pathname: '/verify', params: { from: 'settings' } })} />
        </View>
      ) : null}

      <Group>
        <MenuRow icon="flame" label={t('home.discover')} href="/discover" testID="menu-discover" />
        <MenuRow icon="heart" label={t('discover.likesYou')} href="/discover/likes" testID="menu-likes" />
        <MenuRow icon="star" label={t('liked.menuLabel')} href="/liked" testID="menu-liked" />
        <MenuRow icon="people" label={t('home.matches')} href="/matches" testID="menu-matches" />
        <MenuRow icon="chatbubbles" label={t('home.chats')} href="/chats" testID="menu-chats" />
        <MenuRow icon="notifications" label={t('notifications.title')} href="/notifications" testID="menu-notifications" />
      </Group>
      <Group>
        <MenuRow icon="clipboard" label={t('questionnaire.title')} href="/questionnaire" testID="menu-questionnaire" />
        {eventsOn ? <MenuRow icon="calendar" label={t('home.events')} href="/events" testID="menu-events" /> : null}
        {travelOn ? <MenuRow icon="airplane" label={t('travel.title')} href="/travel" testID="menu-travel" /> : null}
        {coachOn ? <MenuRow icon="sparkles" label={t('ai.coachTitle')} href="/ai/coach" testID="menu-coach" /> : null}
        {coachOn ? <MenuRow icon="analytics" label={t('ai.insightsTitle')} href="/ai/insights" testID="menu-insights" /> : null}
        <MenuRow icon="diamond" label={t('premium.title')} href="/premium" testID="menu-premium" />
      </Group>
      <Group>
        <MenuRow icon="shield-checkmark" label={t('safety.center')} href="/safety" testID="menu-safety" />
        <MenuRow icon="settings" label={t('settings.title')} href="/settings" testID="menu-settings" />
      </Group>
    </Screen>
  );
}
