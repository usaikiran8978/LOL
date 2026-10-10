import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { authApi, isApiError } from '../../api';
import { homeRouteFor, useSession } from '../../auth/SessionProvider';
import { Button, FormError, Notice, OtpInput, Screen, Text, useToast } from '../../components';
import { DEFAULT_RESEND_COOLDOWN_SECONDS, useCooldown } from '../../hooks/useCooldown';
import { useAction } from '../../hooks/useAction';
import { useTheme } from '../../theme/ThemeProvider';

type Channel = 'email' | 'sms';

// Remembered for this app session so an unverified user is prompted once, not on every navigation.
let prompted = false;
export const wasVerificationPrompted = () => prompted;
export const resetVerificationPrompt = () => {
  prompted = false;
};

export default function VerifyContactScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { user, setUser, refreshUser } = useSession();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [active, setActive] = useState<Channel | null>(null);
  const [code, setCode] = useState('');
  const cooldown = useCooldown();

  const send = useAction(async (channel: Channel) => {
    try {
      await authApi.sendVerification({ channel });
      setActive(channel);
      setCode('');
      cooldown.start(DEFAULT_RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      if (isApiError(e, 'RATE_LIMITED') && e.retryAfterSeconds) {
        setActive(channel);
        cooldown.start(e.retryAfterSeconds);
      }
      // CONFLICT = already verified elsewhere; just refresh our copy of the account.
      if (isApiError(e, 'CONFLICT')) return void (await refreshUser());
      throw e;
    }
  });

  const confirm = useAction(async (value?: string) => {
    if (!active) return;
    const me = await authApi.confirmVerification({ channel: active, code: value ?? code });
    setUser(me);
    setActive(null);
    setCode('');
    toast.show(t(active === 'email' ? 'verify.emailDone' : 'verify.phoneDone'), 'success');
  });

  if (!user) return null;
  const leave = () => {
    prompted = true;
    if (from === 'settings') router.back();
    else router.replace(homeRouteFor(user, { verificationPrompted: true }));
  };
  const rows: Array<{ channel: Channel; value: string | null; verified: boolean }> = [
    { channel: 'email', value: user.email, verified: user.emailVerified },
    { channel: 'sms', value: user.phone, verified: user.phoneVerified },
  ];

  return (
    <Screen
      title={t('verify.title')}
      subtitle={t('verify.subtitle')}
      testID="verify-screen"
      footer={<Button testID="verify-continue" variant={user.emailVerified || user.phoneVerified ? 'primary' : 'secondary'} label={user.emailVerified || user.phoneVerified ? t('common.continue') : t('verify.later')} onPress={leave} />}
    >
      <FormError error={send.error ?? confirm.error} />
      {rows
        .filter((r) => r.value)
        .map((r) => (
          <View key={r.channel} style={{ marginBottom: spacing.xl }}>
            <Text variant="heading">{t(r.channel === 'email' ? 'auth.email' : 'auth.phone')}</Text>
            <Text color="textMuted" style={{ marginBottom: spacing.sm }}>
              {r.value}
            </Text>
            {r.verified ? (
              <Notice tone="success" title={t('verify.verified')} testID={`verified-${r.channel}`} />
            ) : active === r.channel ? (
              <>
                <OtpInput testID={`verify-code-${r.channel}`} label={t('auth.otp.code')} value={code} onChange={setCode} onComplete={(c) => void confirm.run(c)} />
                <Button testID={`verify-confirm-${r.channel}`} label={t('auth.otp.verify')} loading={confirm.pending} disabled={code.length !== 6} onPress={() => void confirm.run()} />
                <Button
                  variant="ghost"
                  label={cooldown.remaining > 0 ? t('auth.otp.resendIn', { seconds: cooldown.remaining }) : t('auth.otp.resend')}
                  disabled={cooldown.remaining > 0 || send.pending}
                  onPress={() => void send.run(r.channel)}
                />
              </>
            ) : (
              <Button testID={`verify-send-${r.channel}`} variant="secondary" label={t('verify.sendCode')} loading={send.pending} disabled={cooldown.remaining > 0 && active !== null} onPress={() => void send.run(r.channel)} />
            )}
          </View>
        ))}
    </Screen>
  );
}
