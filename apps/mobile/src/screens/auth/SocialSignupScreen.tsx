import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { analytics } from '../../analytics';
import { authApi, isApiError } from '../../api';
import { getDeviceInfo } from '../../auth/device';
import { useSession } from '../../auth/SessionProvider';
import { getPendingSocial, setPendingSocial } from '../../auth/social';
import { Button, FormError, Notice, Screen } from '../../components';
import { buildSignup, emptySignupDetails, SignupDetailsFields } from '../../features/auth/SignupDetailsFields';
import { useAction } from '../../hooks/useAction';
import type { FieldErrors } from '../../utils/validation';

/** Second leg of Google/Apple sign-in for a new identity: the API needs age, country and legal acceptance. */
export default function SocialSignupScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { signIn } = useSession();
  const pending = getPendingSocial();
  const [details, setDetails] = useState(emptySignupDetails);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [legalNonce, setLegalNonce] = useState(0);
  const [ineligibleAge, setIneligibleAge] = useState<number | null>(null);

  useEffect(() => {
    if (pending) analytics.track('signup_started', { method: pending.provider });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useAction(async () => {
    if (!pending) return;
    const s = buildSignup(details, t);
    setErrors(s.ok ? {} : s.errors);
    if (!s.ok) return;
    try {
      const result = await authApi.social({ provider: pending.provider, idToken: pending.idToken, nonce: pending.nonce, device: await getDeviceInfo(), signup: s.signup });
      setPendingSocial(null);
      await signIn(result);
    } catch (e) {
      if (isApiError(e, 'AGE_INELIGIBLE')) {
        setPendingSocial(null);
        return setIneligibleAge(e.detail<number>('minAge') ?? null);
      }
      if (isApiError(e, 'CONSENT_REQUIRED')) setLegalNonce((n) => n + 1);
      throw e;
    }
  });

  if (ineligibleAge !== null) {
    return (
      <Screen title={t('auth.register.ineligibleTitle')} testID="social-ineligible">
        <Notice tone="warning" title={t('errors.AGE_INELIGIBLE', { minAge: ineligibleAge })} body={t('auth.register.ineligibleBody')} />
        <Button label={t('common.backToStart')} onPress={() => router.replace('/welcome')} />
      </Screen>
    );
  }
  if (!pending) return <Redirect href="/welcome" />;

  return (
    <Screen
      title={t('auth.socialSignup.title')}
      subtitle={t('auth.socialSignup.subtitle')}
      testID="social-signup-screen"
      footer={<Button testID="social-signup-submit" label={t('auth.register.submit')} onPress={() => void submit.run()} loading={submit.pending} />}
    >
      <FormError error={submit.error} />
      <SignupDetailsFields value={details} onChange={setDetails} errors={errors} legalNonce={legalNonce} />
    </Screen>
  );
}
