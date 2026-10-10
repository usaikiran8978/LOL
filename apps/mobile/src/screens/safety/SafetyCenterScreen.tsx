import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ListItem, Notice, Screen, Text } from '../../components';
import { useFlag } from '../../config/ConfigProvider';
import { useTheme } from '../../theme/ThemeProvider';

/** Safety hub, reachable from profile, chat and date screens. */
export default function SafetyCenterScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const dateSafety = useFlag('date_safety');
  return (
    <Screen title={t('safety.center')} subtitle={t('safety.centerIntro')} testID="safety-screen">
      <Notice tone="danger" title={t('safety.emergencyTitle')} body={t('safety.emergencyBody')} />
      <Text variant="heading" style={{ marginBottom: spacing.xs }}>
        {t('safety.sections.dates')}
      </Text>
      {dateSafety ? (
        <>
          <ListItem testID="safety-date" label={t('dateSafety.title')} description={t('dateSafety.intro')} onPress={() => router.push('/safety/date')} />
          <ListItem testID="safety-contacts" label={t('trustedContacts.title')} onPress={() => router.push('/safety/contacts')} />
        </>
      ) : (
        <ListItem label={t('dateSafety.title')} unavailable />
      )}
      <Text variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.xs }}>
        {t('safety.sections.account')}
      </Text>
      <ListItem testID="safety-verification" label={t('verification.title')} onPress={() => router.push('/safety/verification')} />
      <ListItem testID="safety-blocks" label={t('settings.blockedUsers')} onPress={() => router.push('/safety/blocks')} />
      <ListItem label={t('content.kinds.safety_tip')} onPress={() => router.push({ pathname: '/settings/content/[kind]', params: { kind: 'safety_tip' } })} />
      <ListItem label={t('content.kinds.safety_guide')} onPress={() => router.push({ pathname: '/settings/content/[kind]', params: { kind: 'safety_guide' } })} />
    </Screen>
  );
}
