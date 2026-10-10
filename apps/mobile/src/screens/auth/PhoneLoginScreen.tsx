import { e164, otpLoginRequest } from '@amora/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi, isApiError } from '../../api';
import { getDeviceInfo } from '../../auth/device';
import { useSession } from '../../auth/SessionProvider';
import { Button, FormError, OtpInput, Screen, TextField } from '../../components';
import { DEFAULT_RESEND_COOLDOWN_SECONDS, useCooldown } from '../../hooks/useCooldown';
import { useAction } from '../../hooks/useAction';
import { normalizePhone } from '../../utils/validation';

export default function PhoneLoginScreen() {
  const { t } = useTranslation();
  const { signIn } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'request' | 'verify'>('request');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const cooldown = useCooldown();

  const send = useAction(async () => {
    const normalized = normalizePhone(phone);
    if (!e164.safeParse(normalized).success) return setPhoneError(t('validation.phone'));
    setPhoneError(null);
    try {
      await authApi.requestOtp({ channel: 'sms', destination: normalized, purpose: 'login_otp' });
      setStage('verify');
      cooldown.start(DEFAULT_RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      if (isApiError(e, 'RATE_LIMITED') && e.retryAfterSeconds) cooldown.start(e.retryAfterSeconds);
      throw e;
    }
  });

  const verify = useAction(async (value?: string) => {
    // OtpInput only ever yields digits; the shared schema is still the final gate before the request.
    const body = otpLoginRequest.parse({ phone: normalizePhone(phone), code: value ?? code, device: await getDeviceInfo() });
    await signIn(await authApi.otpLogin(body));
  });

  if (stage === 'request') {
    return (
      <Screen
        title={t('auth.phoneLogin.title')}
        subtitle={t('auth.phoneLogin.subtitle')}
        testID="phone-login-screen"
        footer={<Button testID="phone-send" label={t('auth.otp.send')} onPress={() => void send.run()} loading={send.pending} disabled={cooldown.remaining > 0} />}
      >
        <FormError error={send.error} />
        <TextField testID="phone-input" label={t('auth.phone')} hint={t('auth.phoneHint')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" error={phoneError} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('auth.otp.enterCode')}
      subtitle={t('auth.otp.sentTo', { destination: normalizePhone(phone) })}
      testID="phone-verify-screen"
      footer={
        <>
          <Button testID="phone-verify" label={t('auth.otp.verify')} onPress={() => void verify.run()} loading={verify.pending} disabled={code.length !== 6} />
          <Button
            variant="ghost"
            label={cooldown.remaining > 0 ? t('auth.otp.resendIn', { seconds: cooldown.remaining }) : t('auth.otp.resend')}
            disabled={cooldown.remaining > 0 || send.pending}
            onPress={() => void send.run()}
          />
          <Button variant="ghost" label={t('auth.otp.changeNumber')} onPress={() => setStage('request')} />
        </>
      }
    >
      <FormError error={verify.error} />
      <FormError error={send.error} testID="resend-error" />
      <OtpInput testID="otp" label={t('auth.otp.code')} value={code} onChange={setCode} onComplete={(c) => void verify.run(c)} />
    </Screen>
  );
}
