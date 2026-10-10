import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { usersApi, type Session } from '../../api';
import { Button, FormError, Screen, Text, useToast, appAlert } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatDateTime } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

export default function SessionsScreen() {
  const { t } = useTranslation();
  const { spacing, colors, radius } = useTheme();
  const toast = useToast();
  const sessions = useResource(usersApi.sessions);
  const list = sessions.data ?? [];

  const revoke = useAction(async (id: string) => {
    await usersApi.revokeSession(id);
    sessions.setData(list.filter((s) => s.id !== id));
    toast.show(t('sessions.revoked'), 'success');
  });
  const revokeOthers = useAction(async () => {
    await usersApi.revokeOtherSessions();
    sessions.setData(list.filter((s) => s.current));
    toast.show(t('sessions.othersRevoked'), 'success');
  });

  const confirm = (title: string, onYes: () => void) =>
    appAlert(title, t('sessions.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('sessions.revoke'), style: 'destructive', onPress: onYes },
    ]);

  const device = (s: Session) => [s.model, s.platform ? t(`sessions.platforms.${s.platform}`, { defaultValue: s.platform }) : null, s.osVersion].filter(Boolean).join(' · ') || t('sessions.unknownDevice');
  const others = list.filter((s) => !s.current);

  return (
    <Screen
      title={t('settings.sessions')}
      subtitle={t('sessions.subtitle')}
      status={sessions.status === 'ready' && list.length === 0 ? 'empty' : sessions.data ? 'ready' : sessions.status}
      error={sessions.error}
      onRetry={sessions.reload}
      testID="sessions-screen"
      footer={others.length ? <Button testID="revoke-others" variant="danger" label={t('sessions.revokeOthers')} loading={revokeOthers.pending} onPress={() => confirm(t('sessions.revokeOthers'), () => void revokeOthers.run())} /> : undefined}
    >
      <FormError error={revoke.error ?? revokeOthers.error} />
      {list.map((s) => (
        <View key={s.id} testID={`session-${s.id}`} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
          <Text variant="label">{device(s)}</Text>
          {s.current ? (
            <Text variant="caption" color="success">
              {t('sessions.thisDevice')}
            </Text>
          ) : null}
          <Text variant="caption" color="textMuted">
            {t('sessions.lastActive', { date: formatDateTime(s.lastUsedAt) })}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('sessions.signedIn', { date: formatDateTime(s.createdAt) })}
          </Text>
          {!s.current ? <Button testID={`revoke-${s.id}`} variant="ghost" label={t('sessions.revoke')} onPress={() => confirm(t('sessions.revoke'), () => void revoke.run(s.id))} /> : null}
        </View>
      ))}
    </Screen>
  );
}
