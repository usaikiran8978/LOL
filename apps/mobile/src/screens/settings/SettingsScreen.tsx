import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSession } from '../../auth/SessionProvider';
import { ListItem, Screen, Text, appAlert } from '../../components';
import { useSetting } from '../../config/ConfigProvider';
import { env } from '../../config/env';
import { useTheme } from '../../theme/ThemeProvider';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const { signOut } = useSession();
  const supportEmail = useSetting<string | null>('support_email', null);

  const confirmLogout = () =>
    appAlert(t('settings.logoutTitle'), t('settings.logoutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.logout'), style: 'destructive', onPress: () => void signOut() },
    ]);

  const heading = (key: string) => (
    <Text variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.xs }}>
      {t(key)}
    </Text>
  );

  return (
    <Screen title={t('settings.title')} testID="settings-screen">
      {heading('settings.sections.account')}
      <ListItem testID="settings-verify" label={t('settings.verifyContacts')} onPress={() => router.push({ pathname: '/verify', params: { from: 'settings' } })} />
      <ListItem testID="settings-password" label={t('settings.changePassword')} onPress={() => router.push('/settings/password')} />
      <ListItem testID="settings-sessions" label={t('settings.sessions')} onPress={() => router.push('/settings/sessions')} />
      <ListItem testID="settings-subscription" label={t('premium.title')} onPress={() => router.push('/premium')} />
      <ListItem testID="settings-export" label={t('settings.exportData')} onPress={() => router.push('/settings/data')} />
      <ListItem testID="settings-delete" label={t('settings.deleteAccount')} destructive onPress={() => router.push('/settings/delete-account')} />

      {heading('settings.sections.privacy')}
      <ListItem testID="settings-privacy" label={t('settings.privacy')} onPress={() => router.push('/settings/privacy')} />
      <ListItem testID="settings-consents" label={t('settings.consents')} onPress={() => router.push('/settings/consents')} />
      <ListItem testID="settings-preferences" label={t('settings.preferences')} onPress={() => router.push('/settings/preferences')} />
      <ListItem testID="settings-notifications" label={t('settings.notifications')} onPress={() => router.push('/settings/notifications')} />
      <ListItem testID="settings-blocked" label={t('settings.blockedUsers')} onPress={() => router.push('/safety/blocks')} />
      <ListItem testID="settings-safety" label={t('safety.center')} onPress={() => router.push('/safety')} />

      {heading('settings.sections.app')}
      <ListItem testID="settings-language" label={t('settings.language')} onPress={() => router.push('/language')} />

      {heading('settings.sections.support')}
      <ListItem testID="settings-faq" label={t('content.kinds.faq')} onPress={() => router.push({ pathname: '/settings/content/[kind]', params: { kind: 'faq' } })} />
      <ListItem label={t('content.kinds.help_article')} onPress={() => router.push({ pathname: '/settings/content/[kind]', params: { kind: 'help_article' } })} />
      <ListItem label={t('content.kinds.safety_tip')} onPress={() => router.push({ pathname: '/settings/content/[kind]', params: { kind: 'safety_tip' } })} />
      <ListItem testID="settings-legal" label={t('settings.legal')} onPress={() => router.push('/settings/legal')} />
      {supportEmail ? <ListItem label={t('settings.supportEmail')} value={supportEmail} /> : null}

      <View style={{ marginTop: spacing.xl }}>
        <ListItem testID="settings-logout" label={t('settings.logout')} destructive onPress={confirmLogout} />
      </View>
      <Text variant="caption" color="textMuted" align="center" style={{ marginTop: spacing.lg }}>
        {t('settings.version', { version: env.appVersion })}
      </Text>
    </Screen>
  );
}
