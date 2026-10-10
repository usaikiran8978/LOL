import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { isApiError } from '../../api';
import { DELETION_GRACE_DAYS, privacyRequestsApi } from '../../api/privacyRequests';
import { useSession } from '../../auth/SessionProvider';
import { Button, Checkbox, FormError, Notice, Screen, Text, TextField } from '../../components';
import { useAction } from '../../hooks/useAction';
import { formatDate, formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Delete account: password re-authentication (social/OTP-only accounts need a recent sign-in instead), a 14-day grace
 * period during which signing in and choosing "Restore" cancels it. The API revokes every session immediately.
 */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const { signOut } = useSession();
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [purgeAt, setPurgeAt] = useState<string | null>(null);

  const remove = useAction(async () => {
    const r = await privacyRequestsApi.requestDeletion(password || undefined);
    setPurgeAt(r.purgeAt);
  });

  if (purgeAt) {
    return (
      <Screen title={t('deleteAccount.doneTitle')} testID="delete-account-screen">
        <Notice tone="success" title={t('deleteAccount.scheduled', { date: formatDate(purgeAt) })} body={t('deleteAccount.restoreHow')} testID="delete-scheduled" />
        <Button label={t('common.done')} onPress={() => void signOut()} testID="delete-signout" />
      </Screen>
    );
  }

  const staleSession = isApiError(remove.error, 'UNAUTHENTICATED');
  return (
    <Screen title={t('settings.deleteAccount')} testID="delete-account-screen">
      <Notice tone="danger" title={t('deleteAccount.warningTitle')} body={t('deleteAccount.grace', { days: formatNumber(DELETION_GRACE_DAYS) })} />
      <Text style={{ marginBottom: spacing.md }}>{t('deleteAccount.whatHappens')}</Text>
      <Text color="textMuted" style={{ marginBottom: spacing.lg }}>{t('deleteAccount.exportFirst')}</Text>
      <TextField testID="delete-password" label={t('deleteAccount.password')} hint={t('deleteAccount.passwordHint')} secureToggle autoCapitalize="none" value={password} onChangeText={setPassword} />
      <Checkbox testID="delete-confirm" label={t('deleteAccount.confirm', { days: formatNumber(DELETION_GRACE_DAYS) })} checked={confirmed} onChange={setConfirmed} />
      {staleSession ? <Notice tone="warning" title={t('deleteAccount.signInAgain')} testID="delete-stale" /> : <FormError error={remove.error} />}
      <View>
        <Button testID="delete-submit" variant="danger" label={t('deleteAccount.submit')} disabled={!confirmed} loading={remove.pending} onPress={() => void remove.run()} />
        {staleSession ? <Button variant="secondary" label={t('settings.logout')} onPress={() => void signOut()} style={{ marginTop: spacing.sm }} /> : null}
      </View>
    </Screen>
  );
}
