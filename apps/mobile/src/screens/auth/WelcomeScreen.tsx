import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, Screen, Text } from '../../components';
import { SocialButtons } from '../../features/auth/SocialButtons';
import { useTheme } from '../../theme/ThemeProvider';

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  return (
    <Screen testID="welcome-screen">
      <View style={{ flex: 1, justifyContent: 'center', paddingVertical: spacing.xxl }}>
        <Text variant="display" align="center" style={{ fontSize: 72, lineHeight: 80, letterSpacing: 4 }} color="primary">
          {t('app.name')}
        </Text>
        <Text variant="label" align="center" color="accentText" style={{ letterSpacing: 3, textTransform: 'uppercase' }} testID="welcome-brand-tagline">
          {t('common.tagline')}
        </Text>
        <Text color="textMuted" align="center" style={{ marginTop: spacing.sm }}>
          {t('welcome.tagline')}
        </Text>
      </View>
      <View style={{ gap: spacing.sm }}>
        <Button testID="welcome-register" label={t('welcome.createAccount')} onPress={() => router.push('/register')} />
        <Button testID="welcome-login" variant="secondary" label={t('welcome.signIn')} onPress={() => router.push('/login')} />
        <Button testID="welcome-phone" variant="ghost" label={t('welcome.phoneCode')} onPress={() => router.push('/phone-login')} />
        <Text variant="caption" color="textMuted" align="center" style={{ marginVertical: spacing.sm }}>
          {t('welcome.or')}
        </Text>
        <SocialButtons />
        <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', marginTop: spacing.md }}>
          <Button variant="ghost" label={t('legal.terms')} onPress={() => router.push({ pathname: '/legal/[type]', params: { type: 'terms' } })} />
          <Button variant="ghost" label={t('legal.privacy')} onPress={() => router.push({ pathname: '/legal/[type]', params: { type: 'privacy' } })} />
          <Button variant="ghost" label={t('settings.language')} onPress={() => router.push('/language')} />
        </View>
      </View>
    </Screen>
  );
}
