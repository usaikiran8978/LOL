import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { isApiError } from '../../api/errors';
import { eventsApi, type RosterEntry } from '../../api/experiences';
import { Badge, Button, FormError, Notice, Screen, Text, TextField } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatDateTime, formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

const CODE = /^[A-Z0-9]{6}$/;
const STATUS_TONE = { checked_in: 'success', registered: 'primary', waitlisted: 'neutral' } as const;

/** Codes are shown to attendees in upper case; accept what people type (lower case, spaces, dashes). */
export function normalizeCode(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

/**
 * Organizer check-in at the door: type the attendee's 6-character code. The code alone identifies the attendee; only
 * when two codes collide (400 with `details.ambiguous`) is the organizer asked to pick the person from the roster.
 */
export default function EventCheckInScreen() {
  const { t } = useTranslation();
  const { spacing, colors } = useTheme();
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const roster = useResource(() => eventsApi.roster(id!), [id]);
  const [code, setCode] = useState('');
  /** Set when the API could not tell attendees apart by code alone. */
  const [ambiguous, setAmbiguous] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string | null; code: string } | null>(null);

  const submit = useAction(async (userId?: string) => {
    const c = ambiguous ?? code;
    const before = new Set((roster.data ?? []).filter((r) => r.status === 'checked_in').map((r) => r.userId));
    setDone(null);
    try {
      await eventsApi.checkIn(id!, userId ? { userId, code: c } : { code: c });
    } catch (e) {
      if (!userId && isApiError(e, 'VALIDATION_FAILED') && e.detail<boolean>('ambiguous') === true) {
        setAmbiguous(c);
        return;
      }
      // Someone already in: the roster may be stale on this device, so refresh it alongside the message.
      if (isApiError(e, 'CONFLICT') && e.detail<boolean>('alreadyCheckedIn') === true) roster.reload();
      throw e;
    }
    setAmbiguous(null);
    setCode('');
    // The API answers 204; the fresh roster tells us who was just checked in.
    const fresh = await eventsApi.roster(id!).catch(() => null);
    if (fresh) roster.setData(fresh);
    const who = userId ?? fresh?.find((r) => r.status === 'checked_in' && !before.has(r.userId))?.userId;
    setDone({ name: (fresh ?? roster.data ?? []).find((r) => r.userId === who)?.displayName ?? null, code: c });
  });

  const errorFor = (e: unknown) => {
    if (isApiError(e, 'CONFLICT') && e.detail<boolean>('alreadyCheckedIn') === true) return t('events.checkIn.alreadyCheckedIn');
    if (isApiError(e, 'VALIDATION_FAILED')) return t('events.checkIn.invalidCode');
    if (isApiError(e, 'EVENT_NOT_OPEN')) return t('events.checkIn.notOpen');
    return null;
  };
  const submitError = submit.error ? errorFor(submit.error) : null;

  const list = roster.data ?? [];
  const checkedIn = list.filter((r) => r.status === 'checked_in').length;
  const expected = list.filter((r) => r.status !== 'waitlisted').length;
  const candidates = list.filter((r) => r.status === 'registered');

  const row = (r: RosterEntry) => (
    <View key={r.userId} testID={`roster-${r.userId}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flex: 1 }}>
        <Text>{r.displayName ?? t('discover.someone')}</Text>
        {r.status === 'checked_in' && r.checkedInAt ? (
          <Text variant="caption" color="textMuted">
            {t('events.checkIn.at', { date: formatDateTime(r.checkedInAt) })}
          </Text>
        ) : null}
      </View>
      {r.verificationLevel && r.verificationLevel !== 'none' ? <Badge tone="success" label={t(`verification.levels.${r.verificationLevel}`, { defaultValue: t('verification.levels.selfie') })} /> : null}
      <Badge tone={STATUS_TONE[r.status] ?? 'neutral'} label={t(`events.myStatus.${r.status}`)} testID={`roster-status-${r.userId}`} />
    </View>
  );

  return (
    <Screen
      title={t('events.checkIn.title')}
      subtitle={title || undefined}
      status={roster.data ? 'ready' : roster.status}
      error={roster.error}
      onRetry={roster.reload}
      testID="event-checkin-screen"
    >
      {done ? (
        <Notice tone="success" title={done.name ? t('events.checkIn.doneNamed', { name: done.name }) : t('events.checkIn.done', { code: done.code })} testID="checkin-success" />
      ) : null}

      {ambiguous ? (
        <View testID="checkin-ambiguous">
          <Notice tone="warning" title={t('events.checkIn.ambiguousTitle', { code: ambiguous })} body={t('events.checkIn.ambiguousBody')} />
          {candidates.map((r) => (
            <Button
              key={r.userId}
              variant="secondary"
              label={r.displayName ?? t('discover.someone')}
              accessibilityHint={t('events.checkIn.pickHint')}
              onPress={() => void submit.run(r.userId)}
              disabled={submit.pending}
              testID={`checkin-pick-${r.userId}`}
              style={{ marginBottom: spacing.sm }}
            />
          ))}
          {submitError ? <Notice tone="danger" title={submitError} testID="checkin-error" /> : <FormError error={submit.error} />}
          <Button variant="ghost" label={t('common.cancel')} onPress={() => { setAmbiguous(null); submit.reset(); }} testID="checkin-ambiguous-cancel" />
        </View>
      ) : (
        <View>
          <TextField
            testID="checkin-code"
            label={t('events.checkIn.codeLabel')}
            hint={t('events.checkIn.codeHint')}
            value={code}
            onChangeText={(v) => {
              setCode(normalizeCode(v));
              setDone(null);
              submit.reset();
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            returnKeyType="done"
            onSubmitEditing={() => CODE.test(code) && void submit.run()}
          />
          {submitError ? <Notice tone="danger" title={submitError} testID="checkin-error" /> : <FormError error={submit.error} />}
          <Button testID="checkin-submit" label={t('events.checkIn.submit')} disabled={!CODE.test(code)} loading={submit.pending} onPress={() => void submit.run()} />
        </View>
      )}

      <Text variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.xs }}>
        {t('events.checkIn.roster')}
      </Text>
      <Text color="textMuted" style={{ marginBottom: spacing.sm }} testID="checkin-count">
        {t('events.checkIn.count', { checked: formatNumber(checkedIn), total: formatNumber(expected) })}
      </Text>
      {list.length ? list.map(row) : <Notice title={t('events.checkIn.empty')} testID="roster-empty" />}
      <Button variant="ghost" label={t('events.checkIn.refresh')} onPress={roster.reload} testID="roster-refresh" style={{ marginTop: spacing.md }} />
    </Screen>
  );
}
