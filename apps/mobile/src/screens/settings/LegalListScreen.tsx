import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LEGAL_DOC_TYPES } from '../../api';
import { useSession } from '../../auth/SessionProvider';
import { ListItem, Screen } from '../../components';

export default function LegalListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useSession();
  return (
    <Screen title={t('settings.legal')} testID="legal-list">
      {LEGAL_DOC_TYPES.map((type) => (
        <ListItem key={type} testID={`legal-${type}`} label={t(`legal.types.${type}`)} onPress={() => router.push({ pathname: '/legal/[type]', params: { type, country: user?.countryCode ?? '' } })} />
      ))}
    </Screen>
  );
}
