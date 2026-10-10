import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { homeRouteFor, useSession } from '../../auth/SessionProvider';
import { Notice, Screen } from '../../components';
import { useConfig, useUpdateRequired } from '../../config/ConfigProvider';
import { wasVerificationPrompted } from '../auth/VerifyContactScreen';

/** Bootstrap gate: config + session restore, then route to the right place. */
export default function SplashScreen() {
  const { t } = useTranslation();
  const { state, user, retryRestore } = useSession();
  const config = useConfig();
  const updateRequired = useUpdateRequired();

  // Flags are user-targeted: reload once we know who the user is.
  useEffect(() => {
    if (user) void config.reload(user.countryCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (config.status === 'error') return <Screen status="error" error={config.error} onRetry={() => void config.reload()} testID="splash-error" />;
  if (state.status === 'unreachable') return <Screen status="error" error={state.error} onRetry={retryRestore} testID="splash-offline" />;
  if (config.status === 'loading' || state.status === 'restoring') return <Screen status="loading" testID="splash-loading" />;
  if (updateRequired) {
    return (
      <Screen title={t('update.title')} testID="update-required">
        <Notice tone="warning" title={t('update.body')} />
      </Screen>
    );
  }
  if (state.status === 'signedIn') return <Redirect href={homeRouteFor(state.user, { verificationPrompted: wasVerificationPrompted() })} />;
  return <Redirect href="/welcome" />;
}
