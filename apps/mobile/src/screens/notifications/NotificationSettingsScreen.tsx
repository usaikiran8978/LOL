import { getCalendars } from 'expo-localization';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { notificationsApi, type NotificationPreferences } from '../../api/notifications';
import { Button, FormError, Notice, Screen, Text, TextField, ToggleRow, useToast } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { pushPermission, registerForPush } from '../../notifications/push';
import { useTheme } from '../../theme/ThemeProvider';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Push permission, per-category/channel preferences and quiet hours. Locked categories (safety) can't be turned off. */
export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const toast = useToast();
  const prefs = useResource(notificationsApi.preferences);
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [quiet, setQuiet] = useState(false);
  const [start, setStart] = useState('22:00');
  const [end, setEnd] = useState('08:00');
  const [perm, setPerm] = useState<'granted' | 'denied' | 'undetermined' | null>(null);

  useEffect(() => {
    void pushPermission().then(setPerm, () => setPerm(null));
  }, []);
  useEffect(() => {
    if (!prefs.data) return;
    setDraft(prefs.data);
    setQuiet(!!prefs.data.quietHours);
    if (prefs.data.quietHours) {
      setStart(prefs.data.quietHours.start);
      setEnd(prefs.data.quietHours.end);
    }
  }, [prefs.data]);

  const enablePush = useAction(async () => {
    const r = await registerForPush({ prompt: true });
    setPerm(r === 'registered' ? 'granted' : r === 'denied' ? 'denied' : perm);
  });

  const save = useAction(async () => {
    if (!draft) return;
    const timezone = getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const next = await notificationsApi.updatePreferences({
      preferences: draft.preferences.filter((p) => !p.locked).map(({ category, channel, enabled }) => ({ category, channel, enabled })),
      quietHours: quiet ? { start, end, timezone } : null,
    });
    prefs.setData(next);
    toast.show(t('common.saved'), 'success');
  });

  const categories = draft ? [...new Set(draft.preferences.map((p) => p.category))] : [];
  const quietInvalid = quiet && (!HHMM.test(start) || !HHMM.test(end));

  return (
    <Screen
      title={t('settings.notifications')}
      status={draft ? 'ready' : prefs.status}
      error={prefs.error}
      onRetry={prefs.reload}
      footer={<Button testID="notif-save" label={t('common.save')} onPress={() => void save.run()} loading={save.pending} disabled={quietInvalid} />}
      testID="notification-settings-screen"
    >
      <Text variant="heading" style={{ marginBottom: spacing.sm }}>{t('notifications.push')}</Text>
      {perm === 'granted' ? (
        <Notice tone="success" title={t('notifications.pushOn')} testID="push-on" />
      ) : perm === 'denied' ? (
        <Notice tone="warning" title={t('notifications.permissionDenied')} testID="push-denied" />
      ) : (
        <Button testID="push-enable" variant="secondary" label={t('notifications.enablePush')} onPress={() => void enablePush.run()} loading={enablePush.pending} />
      )}
      <FormError error={enablePush.error ?? save.error} />

      {categories.map((c) => (
        <View key={c} testID={`notif-category-${c}`} style={{ marginTop: spacing.lg }}>
          <Text variant="heading">{t(`notifications.categories.${c}`)}</Text>
          {draft!.preferences
            .filter((p) => p.category === c)
            .map((p) => (
              <ToggleRow
                key={`${p.category}-${p.channel}`}
                testID={`notif-${p.category}-${p.channel}`}
                label={t(`notifications.channels.${p.channel}`)}
                description={p.locked ? t('notifications.locked') : undefined}
                value={p.locked ? true : p.enabled}
                disabled={p.locked}
                onChange={(v) => setDraft({ ...draft!, preferences: draft!.preferences.map((x) => (x.category === p.category && x.channel === p.channel ? { ...x, enabled: v } : x)) })}
              />
            ))}
        </View>
      ))}

      <Text variant="heading" style={{ marginTop: spacing.xl }}>{t('notifications.quietHours')}</Text>
      <ToggleRow testID="notif-quiet" label={t('notifications.quietHoursOn')} description={t('notifications.quietHoursHint')} value={quiet} onChange={setQuiet} />
      {quiet ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <View style={{ flex: 1 }}>
            <TextField testID="notif-quiet-start" label={t('notifications.from')} value={start} onChangeText={setStart} error={HHMM.test(start) ? null : t('dates.fields.timeHint')} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField testID="notif-quiet-end" label={t('notifications.to')} value={end} onChangeText={setEnd} error={HHMM.test(end) ? null : t('dates.fields.timeHint')} />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
