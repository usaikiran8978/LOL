import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { authApi, isApiError } from '../../api';
import { getDeviceInfo } from '../../auth/device';
import { useSession } from '../../auth/SessionProvider';
import { appleSignIn, isProviderMarkedUnavailable, markProviderUnavailable, newNonce, setPendingSocial, type SocialProvider } from '../../auth/social';
import { Button, FormError, Notice } from '../../components';
import { env } from '../../config/env';
import { useTheme } from '../../theme/ThemeProvider';
import { CONTROL_HEIGHT } from '../../theme/tokens';

WebBrowser.maybeCompleteAuthSession();

const googleClientConfigured = () =>
  !!(Platform.OS === 'ios' ? env.google.iosClientId : Platform.OS === 'android' ? env.google.androidClientId : env.google.webClientId);

/**
 * Google / Apple sign-in. A provider that is not configured (client id missing in this build, or the API answers
 * SOCIAL_PROVIDER_NOT_CONFIGURED) is shown as explicitly unavailable rather than as a button that silently fails.
 */
export function SocialButtons() {
  const { t } = useTranslation();
  const { spacing, scheme } = useTheme();
  const router = useRouter();
  const { signIn } = useSession();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [unavailable, setUnavailable] = useState(() => ({ google: isProviderMarkedUnavailable('google'), apple: isProviderMarkedUnavailable('apple') }));
  const [appleSupported, setAppleSupported] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAppleSupported, () => setAppleSupported(false));
  }, []);

  const exchange = async (provider: SocialProvider, idToken: string, nonce?: string) => {
    setBusy(provider);
    setError(null);
    try {
      const result = await authApi.social({ provider, idToken, nonce, device: await getDeviceInfo() });
      await signIn(result);
    } catch (e) {
      if (isApiError(e, 'CONSENT_REQUIRED') && e.detail<boolean>('needsSignup')) {
        setPendingSocial({ provider, idToken, nonce });
        router.push('/social-signup');
      } else if (isApiError(e, 'SOCIAL_PROVIDER_NOT_CONFIGURED')) {
        markProviderUnavailable(provider);
        setUnavailable((u) => ({ ...u, [provider]: true }));
      } else {
        setError(e);
      }
    } finally {
      setBusy(null);
    }
  };

  const onApple = async () => {
    try {
      const r = await appleSignIn();
      if (r) await exchange('apple', r.idToken, r.nonce);
    } catch (e) {
      setError(e);
    }
  };

  const googleReady = googleClientConfigured() && !unavailable.google;
  return (
    <View style={{ gap: spacing.sm }}>
      {googleReady ? (
        <GoogleButton busy={busy === 'google'} onToken={(idToken, nonce) => exchange('google', idToken, nonce)} />
      ) : (
        <Notice testID="social-google-unavailable" title={t('auth.social.googleUnavailable')} body={t('auth.social.unavailableBody')} />
      )}
      {Platform.OS === 'ios' ? (
        appleSupported && !unavailable.apple ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={scheme === 'dark' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={10}
            style={{ height: CONTROL_HEIGHT, opacity: busy ? 0.5 : 1 }}
            onPress={() => !busy && void onApple()}
          />
        ) : (
          <Notice testID="social-apple-unavailable" title={t('auth.social.appleUnavailable')} body={t('auth.social.unavailableBody')} />
        )
      ) : null}
      <FormError error={error} testID="social-error" />
    </View>
  );
}

function GoogleButton({ busy, onToken }: { busy: boolean; onToken: (idToken: string, nonce: string) => void }) {
  const { t } = useTranslation();
  const nonce = useMemo(newNonce, []);
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: env.google.iosClientId,
    androidClientId: env.google.androidClientId,
    webClientId: env.google.webClientId,
    extraParams: { nonce },
  });
  useEffect(() => {
    if (response?.type === 'success' && response.params.id_token) onToken(response.params.id_token, nonce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);
  return <Button testID="social-google" variant="secondary" label={t('auth.social.google')} disabled={!request} loading={busy} onPress={() => void promptAsync()} />;
}
