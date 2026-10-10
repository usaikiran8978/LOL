import { e164, email as emailSchema } from '@amora/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../api';
import { Button, FormError, Screen } from '../../components';
import { useAction } from '../../hooks/useAction';
import { normalizePhone } from '../../utils/validation';
import { ContactFields, type Channel } from './ContactFields';

export function normalizeDestination(channel: Channel, v: string): string | null {
  const value = channel === 'email' ? v.trim() : normalizePhone(v);
  const ok = channel === 'email' ? emailSchema.safeParse(value).success : e164.safeParse(value).success;
  return ok ? value : null;
}

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>('email');
  const [destination, setDestination] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const send = useAction(async () => {
    const dest = normalizeDestination(channel, destination);
    if (!dest) return setFieldError(t(channel === 'email' ? 'validation.email' : 'validation.phone'));
    setFieldError(null);
    await authApi.requestOtp({ channel, destination: dest, purpose: 'password_reset' });
    router.push({ pathname: '/reset-password', params: { channel, destination: dest } });
  });

  return (
    <Screen
      title={t('auth.forgot.title')}
      subtitle={t('auth.forgot.subtitle')}
      testID="forgot-screen"
      footer={<Button testID="forgot-submit" label={t('auth.otp.send')} onPress={() => void send.run()} loading={send.pending} />}
    >
      <FormError error={send.error} />
      <ContactFields channel={channel} onChannel={setChannel} destination={destination} onDestination={setDestination} error={fieldError} />
    </Screen>
  );
}
