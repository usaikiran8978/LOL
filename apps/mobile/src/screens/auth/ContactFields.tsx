import { useTranslation } from 'react-i18next';
import { ChipGroup, TextField } from '../../components';

export type Channel = 'email' | 'sms';

/** Channel (email / SMS) + destination inputs shared by the password-reset and recovery flows. */
export function ContactFields({ channel, onChannel, destination, onDestination, error }: { channel: Channel; onChannel: (c: Channel) => void; destination: string; onDestination: (v: string) => void; error?: string | null }) {
  const { t } = useTranslation();
  return (
    <>
      <ChipGroup
        label={t('auth.channel')}
        options={[
          { value: 'email', label: t('auth.email') },
          { value: 'sms', label: t('auth.phone') },
        ]}
        selected={[channel]}
        onChange={(v) => v[0] && onChannel(v[0] as Channel)}
        testID="channel"
      />
      {channel === 'email' ? (
        <TextField testID="destination" label={t('auth.email')} value={destination} onChangeText={onDestination} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={error} />
      ) : (
        <TextField testID="destination" label={t('auth.phone')} hint={t('auth.phoneHint')} value={destination} onChangeText={onDestination} keyboardType="phone-pad" autoComplete="tel" error={error} />
      )}
    </>
  );
}
