import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { analytics } from '../../analytics';
import { usersApi } from '../../api';
import { ApiError, isApiError } from '../../api/errors';
import { dateSafetyApi, OPEN_SESSION_STATUSES, type SafetySession } from '../../api/safety';
import { Button, ChipGroup, FormError, Notice, Screen, Text, ToggleRow, appAlert } from '../../components';
import { useFlag } from '../../config/ConfigProvider';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatDateTime, formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Cache of the open session's id. The server (`GET /dates/safety/sessions/active`) is the source of truth; the cached id
 * is only used when that call fails (e.g. offline at launch), so an SOS button is still one tap away.
 */
export const SESSION_KEY = 'amora.safetySessionId';
const CHECK_IN_OPTIONS = [30, 60, 120, 180] as const;

const needsPreciseLocation = (e: unknown) => isApiError(e, 'CONSENT_REQUIRED') && e.detail<string>('consentType') === 'precise_location';

async function currentPosition(): Promise<{ latitude: number; longitude: number; accuracyM?: number } | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyM: pos.coords.accuracy ?? undefined };
  } catch {
    return null;
  }
}

/** Date safety: share a date plan with a trusted contact, scheduled check-ins, and SOS. */
export default function DateSafetyScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const enabled = useFlag('date_safety');
  const { datePlanId } = useLocalSearchParams<{ datePlanId?: string }>();
  const contacts = useResource(dateSafetyApi.contacts, [], enabled);
  const [session, setSession] = useState<SafetySession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [contactId, setContactId] = useState<string | null>(null);
  const [checkInAfter, setCheckInAfter] = useState<number>(60);
  const [shareLocation, setShareLocation] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  /** Live location needs the `precise_location` consent; set when the API asked for it (start or ping). */
  const [consentFor, setConsentFor] = useState<'start' | 'ping' | null>(null);

  // Resume the open session: ask the server (works after reinstall / on another device), fall back to the cached id.
  useEffect(() => {
    let live = true;
    (async () => {
      let restored: SafetySession | null = null;
      try {
        restored = (await dateSafetyApi.active()).session;
      } catch {
        const id = await SecureStore.getItemAsync(SESSION_KEY).catch(() => null);
        const s = id ? await dateSafetyApi.session(id).catch(() => null) : null;
        restored = s && OPEN_SESSION_STATUSES.includes(s.status) ? s : null;
      }
      if (!live) return;
      if (restored) await remember(restored);
      else await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => undefined);
      if (live) setRestoring(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  const remember = async (s: SafetySession) => {
    setSession(s);
    if (OPEN_SESSION_STATUSES.includes(s.status)) await SecureStore.setItemAsync(SESSION_KEY, s.id).catch(() => undefined);
    else await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => undefined);
  };

  const start = useAction(async (withLocation: boolean = shareLocation) => {
    try {
      const s = await dateSafetyApi.start({ datePlanId: datePlanId || undefined, trustedContactId: contactId ?? undefined, startsAt: new Date().toISOString(), checkInAfterMin: checkInAfter, shareLiveLocation: withLocation });
      setConsentFor(null);
      setShareLink(s.shareLink ?? null);
      await remember(s);
      analytics.track('safety_session_started', { withContact: !!contactId, shareLocation: withLocation });
      if (withLocation) {
        const pos = await currentPosition();
        setLocationDenied(!pos);
        if (pos) await dateSafetyApi.ping(s.id, pos).catch(() => undefined);
      }
    } catch (e) {
      if (needsPreciseLocation(e)) return setConsentFor('start');
      // Only one open session at a time: pick up the existing one instead of failing.
      const existing = e instanceof ApiError && e.code === 'CONFLICT' ? e.detail<string>('sessionId') : undefined;
      if (existing) return remember(await dateSafetyApi.session(existing));
      throw e;
    }
  });

  const checkIn = useAction(async (extendMin?: number) => remember(await dateSafetyApi.checkIn(session!.id, extendMin)));
  const checkOut = useAction(async () => {
    await remember(await dateSafetyApi.checkOut(session!.id));
    analytics.track('date_completed', { surface: 'date_safety' });
  });
  const sos = useAction(async () => {
    const pos = await currentPosition();
    await remember(await dateSafetyApi.sos(session!.id, pos ?? {}));
    analytics.track('sos_triggered', { withLocation: !!pos });
  });
  const ping = useAction(async () => {
    const pos = await currentPosition();
    setLocationDenied(!pos);
    if (!pos) return;
    try {
      await dateSafetyApi.ping(session!.id, pos);
      setConsentFor(null);
    } catch (e) {
      if (needsPreciseLocation(e)) return setConsentFor('ping');
      throw e;
    }
  });

  // Record the consent, then retry what asked for it.
  const allowPrecise = useAction(async () => {
    const retry = consentFor;
    await usersApi.setConsent({ consentType: 'precise_location', granted: true });
    setConsentFor(null);
    if (retry === 'start') await start.run(true);
    else if (retry === 'ping') await ping.run();
  });
  const declinePrecise = () => {
    const retry = consentFor;
    setConsentFor(null);
    if (retry === 'start') {
      setShareLocation(false);
      void start.run(false);
    }
  };

  const confirmSos = () =>
    appAlert(t('dateSafety.sosTitle'), t('dateSafety.sosBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('dateSafety.sosConfirm'), style: 'destructive', onPress: () => void sos.run() },
    ]);

  if (!enabled) return <Screen title={t('dateSafety.title')} status="empty" emptyTitle={t('dateSafety.unavailable')} testID="date-safety-screen" />;

  const confirmed = (contacts.data ?? []).filter((c) => c.confirmed);
  const open = session && OPEN_SESSION_STATUSES.includes(session.status);
  const error = start.error ?? checkIn.error ?? checkOut.error ?? sos.error ?? ping.error ?? allowPrecise.error;

  const consentPrompt = consentFor ? (
    <View testID="precise-location-consent">
      <Notice title={t('dateSafety.preciseTitle')} body={t('dateSafety.preciseBody')} />
      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        <Button testID="precise-location-allow" label={t('dateSafety.preciseAllow')} onPress={() => void allowPrecise.run()} loading={allowPrecise.pending} />
        <Button
          testID="precise-location-decline"
          variant="secondary"
          label={t(consentFor === 'start' ? 'dateSafety.preciseWithout' : 'common.cancel')}
          onPress={declinePrecise}
          disabled={allowPrecise.pending}
        />
      </View>
    </View>
  ) : null;

  return (
    <Screen title={t('dateSafety.title')} subtitle={t('dateSafety.intro')} status={restoring ? 'loading' : contacts.data || session ? 'ready' : contacts.status} error={contacts.error} onRetry={contacts.reload} testID="date-safety-screen">
      <FormError error={error} />
      {locationDenied ? <Notice tone="warning" title={t('dateSafety.locationDenied')} /> : null}
      {consentPrompt}
      {session ? (
        <View testID="safety-session">
          <Notice
            tone={session.status === 'sos' || session.status === 'escalated' ? 'danger' : session.status === 'overdue' ? 'warning' : 'success'}
            title={t(`dateSafety.status.${session.status}`)}
            body={open ? t('dateSafety.checkInDue', { date: formatDateTime(session.checkInDueAt) }) : undefined}
            testID="session-status"
          />
          {shareLink ? <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.md }}>{t('dateSafety.shared')}</Text> : null}
          {open ? (
            <View style={{ gap: spacing.sm }}>
              <Button testID="session-checkin" label={t('dateSafety.imOk')} onPress={() => void checkIn.run()} loading={checkIn.pending} />
              <Button testID="session-extend" variant="secondary" label={t('dateSafety.extend', { minutes: formatNumber(30) })} onPress={() => void checkIn.run(30)} disabled={checkIn.pending} />
              {session.shareLiveLocation ? <Button testID="session-ping" variant="secondary" label={t('dateSafety.shareLocationNow')} onPress={() => void ping.run()} loading={ping.pending} /> : null}
              <Button testID="session-checkout" variant="secondary" label={t('dateSafety.endDate')} onPress={() => void checkOut.run()} loading={checkOut.pending} />
              <Button testID="session-sos" variant="danger" label={t('dateSafety.sos')} accessibilityHint={t('dateSafety.sosBody')} onPress={confirmSos} loading={sos.pending} />
              {session.emergencyNumber ? <Button variant="ghost" label={t('dateSafety.callEmergency', { number: session.emergencyNumber })} onPress={() => void Linking.openURL(`tel:${session.emergencyNumber}`)} testID="session-call-emergency" /> : null}
            </View>
          ) : (
            <Button label={t('dateSafety.newSession')} onPress={() => setSession(null)} testID="session-new" />
          )}
        </View>
      ) : (
        <View testID="safety-start">
          <Text variant="heading" style={{ marginBottom: spacing.sm }}>{t('dateSafety.startTitle')}</Text>
          {confirmed.length ? (
            <ChipGroup testID="session-contact" label={t('dateSafety.shareWith')} options={confirmed.map((c) => ({ value: c.id, label: c.name }))} selected={contactId ? [contactId] : []} onChange={(v) => setContactId(v[0] ?? null)} />
          ) : (
            <Notice title={t('dateSafety.noContacts')} />
          )}
          <Button variant="ghost" label={t('trustedContacts.title')} onPress={() => router.push('/safety/contacts')} testID="session-manage-contacts" />
          <ChipGroup
            testID="session-checkin-after"
            label={t('dateSafety.checkInAfter')}
            options={CHECK_IN_OPTIONS.map((m) => ({ value: String(m), label: t('dateSafety.minutes', { minutes: formatNumber(m) }) }))}
            selected={[String(checkInAfter)]}
            onChange={(v) => v[0] && setCheckInAfter(Number(v[0]))}
          />
          <ToggleRow testID="session-share-location" label={t('dateSafety.shareLocation')} description={t('dateSafety.shareLocationHint')} value={shareLocation} onChange={setShareLocation} />
          <Button testID="session-start" label={t('dateSafety.start')} onPress={() => void start.run(shareLocation)} loading={start.pending} disabled={!!consentFor} style={{ marginTop: spacing.lg }} />
        </View>
      )}
    </Screen>
  );
}
