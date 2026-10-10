import { passwordResetRequest } from '@amora/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi, isApiError } from '../../api';
import { Button, FormError, OtpInput, Screen, TextField, useToast } from '../../components';
import { DEFAULT_RESEND_COOLDOWN_SECONDS, useCooldown } from '../../hooks/useCooldown';
import { useAction } from '../../hooks/useAction';
import { validate, type FieldErrors } from '../../utils/validation';

export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ channel?: string; destination?: string }>();
  const channel = params.channel === 'sms' ? 'sms' : 'email';
  const destination = params.destination ?? '';
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const cooldown = useCooldown();
  const { start } = cooldown;
  useEffect(() => start(DEFAULT_RESEND_COOLDOWN_SECONDS), [start]);

  const resend = useAction(async () => {
    try {
      await authApi.requestOtp({ channel, destination, purpose: 'password_reset' });
      start(DEFAULT_RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      if (isApiError(e, 'RATE_LIMITED') && e.retryAfterSeconds) start(e.retryAfterSeconds);
      throw e;
    }
  });

  const submit = useAction(async () => {
    const v = validate(passwordResetRequest, { channel, destination, code, newPassword: password }, { code: 'validation.code', newPassword: 'validation.passwordLength' }, t);
    const next: FieldErrors = v.ok ? {} : { ...v.errors };
    if (password !== confirm) next.confirm = t('validation.passwordMismatch');
    setErrors(next);
    if (!v.ok || Object.keys(next).length) return;
    await authApi.resetPassword(v.data);
    toast.show(t('auth.reset.done'), 'success');
    router.replace('/login');
  });

  return (
    <Screen
      title={t('auth.reset.title')}
      subtitle={t('auth.otp.sentTo', { destination })}
      testID="reset-screen"
      footer={
        <>
          <Button testID="reset-submit" label={t('auth.reset.submit')} onPress={() => void submit.run()} loading={submit.pending} />
          <Button variant="ghost" label={cooldown.remaining > 0 ? t('auth.otp.resendIn', { seconds: cooldown.remaining }) : t('auth.otp.resend')} disabled={cooldown.remaining > 0 || resend.pending} onPress={() => void resend.run()} />
        </>
      }
    >
      <FormError error={submit.error ?? resend.error} />
      <OtpInput testID="reset-code" label={t('auth.otp.code')} value={code} onChange={setCode} error={errors.code} />
      <TextField testID="reset-password" label={t('auth.newPassword')} hint={t('auth.passwordHint', { min: 10 })} value={password} onChangeText={setPassword} secureToggle autoComplete="new-password" textContentType="newPassword" error={errors.newPassword} />
      <TextField testID="reset-confirm" label={t('auth.confirmPassword')} value={confirm} onChangeText={setConfirm} secureToggle autoComplete="new-password" textContentType="newPassword" error={errors.confirm} />
    </Screen>
  );
}
