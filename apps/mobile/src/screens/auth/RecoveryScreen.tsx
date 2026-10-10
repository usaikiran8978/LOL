import { accountRecoveryRequest } from '@amora/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi, isApiError } from '../../api';
import { getDeviceInfo } from '../../auth/device';
import { useSession } from '../../auth/SessionProvider';
import { Button, FormError, Notice, OtpInput, Screen, TextField } from '../../components';
import { DEFAULT_RESEND_COOLDOWN_SECONDS, useCooldown } from '../../hooks/useCooldown';
import { useAction } from '../../hooks/useAction';
import { validate, type FieldErrors } from '../../utils/validation';
import { ContactFields, type Channel } from './ContactFields';
import { normalizeDestination } from './ForgotPasswordScreen';

/** Account recovery: prove control of a verified contact; all other sessions are revoked by the server. */
export default function RecoveryScreen() {
  const { t } = useTranslation();
  const { signIn } = useSession();
  const [stage, setStage] = useState<'request' | 'verify'>('request');
  const [channel, setChannel] = useState<Channel>('email');
  const [destination, setDestination] = useState('');
  const [normalized, setNormalized] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const cooldown = useCooldown();

  const send = useAction(async () => {
    const dest = normalizeDestination(channel, stage === 'request' ? destination : normalized);
    if (!dest) return setErrors({ destination: t(channel === 'email' ? 'validation.email' : 'validation.phone') });
    setErrors({});
    try {
      await authApi.requestOtp({ channel, destination: dest, purpose: 'account_recovery' });
      setNormalized(dest);
      setStage('verify');
      cooldown.start(DEFAULT_RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      if (isApiError(e, 'RATE_LIMITED') && e.retryAfterSeconds) cooldown.start(e.retryAfterSeconds);
      throw e;
    }
  });

  const recover = useAction(async () => {
    const v = validate(
      accountRecoveryRequest,
      { channel, destination: normalized, code, newPassword: password || undefined, device: await getDeviceInfo() },
      { code: 'validation.code', newPassword: 'validation.passwordLength' },
      t,
    );
    setErrors(v.ok ? {} : v.errors);
    if (!v.ok) return;
    await signIn(await authApi.recover(v.data));
  });

  if (stage === 'request') {
    return (
      <Screen
        title={t('auth.recovery.title')}
        subtitle={t('auth.recovery.subtitle')}
        testID="recovery-screen"
        footer={<Button testID="recovery-send" label={t('auth.otp.send')} onPress={() => void send.run()} loading={send.pending} disabled={cooldown.remaining > 0} />}
      >
        <FormError error={send.error} />
        <ContactFields channel={channel} onChannel={setChannel} destination={destination} onDestination={setDestination} error={errors.destination} />
      </Screen>
    );
  }
  return (
    <Screen
      title={t('auth.recovery.verifyTitle')}
      testID="recovery-verify-screen"
      footer={
        <>
          <Button testID="recovery-submit" label={t('auth.recovery.submit')} onPress={() => void recover.run()} loading={recover.pending} disabled={code.length !== 6} />
          <Button variant="ghost" label={cooldown.remaining > 0 ? t('auth.otp.resendIn', { seconds: cooldown.remaining }) : t('auth.otp.resend')} disabled={cooldown.remaining > 0 || send.pending} onPress={() => void send.run()} />
        </>
      }
    >
      <Notice title={t('auth.recovery.sentIfExists')} body={t('auth.recovery.revokesSessions')} />
      <FormError error={recover.error ?? send.error} />
      <OtpInput testID="recovery-code" label={t('auth.otp.code')} value={code} onChange={setCode} error={errors.code} />
      <TextField testID="recovery-password" label={t('auth.newPasswordOptional')} hint={t('auth.passwordHint', { min: 10 })} value={password} onChangeText={setPassword} secureToggle autoComplete="new-password" error={errors.newPassword} />
    </Screen>
  );
}
