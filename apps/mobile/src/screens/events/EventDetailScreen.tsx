import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { analytics } from '../../analytics';
import { checkoutOutcome, checkoutReturnUrls, eventsApi, type CheckoutOutcome } from '../../api/experiences';
import { Badge, Button, FormError, ListItem, Notice, Screen, Text, ToggleRow } from '../../components';
import { gateFor, usePaywall } from '../../features/premium/paywall';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatDateTime, formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';
import { formatPrice } from './EventsScreen';

const ATTENDING = new Set(['registered', 'checked_in']);

/**
 * Event detail with RSVP / waitlist and the attendee's check-in code (shown to the organizer at the door).
 * Paid tickets go through the API's hosted checkout in the browser; the seat is only ever confirmed by the server
 * (payment webhook), so on return the app just re-reads the registration.
 */
export default function EventDetailScreen() {
  const { t } = useTranslation();
  const { spacing, colors, radius } = useTheme();
  const router = useRouter();
  const openPaywall = usePaywall();
  const { id, checkout } = useLocalSearchParams<{ id: string; checkout?: string }>();
  const event = useResource(() => eventsApi.get(id!), [id]);
  const e = event.data;
  const [openToMeet, setOpenToMeet] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  /** Outcome of the last checkout (from the browser session, or from the `amora://events/:id?checkout=` deep link). */
  const [paid, setPaid] = useState<CheckoutOutcome | null>(null);

  useEffect(() => {
    if (e) analytics.track('event_viewed', { eventId: e.id });
  }, [e?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arriving through the checkout return link: show the outcome and re-read the registration.
  useEffect(() => {
    const outcome = checkoutOutcome(checkout ? `?checkout=${checkout}` : null);
    if (!outcome) return;
    setPaid(outcome);
    event.reload();
  }, [checkout]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async (checkoutUrl: string) => {
    const res = await WebBrowser.openAuthSessionAsync(checkoutUrl, `amora://events/${encodeURIComponent(id!)}`);
    // Dismissed without a return link: the payment may still have gone through, so the server decides.
    setPaid(res.type === 'success' ? (checkoutOutcome(res.url) ?? null) : null);
    event.reload();
  };

  const register = useAction(async () => {
    setNotice(null);
    setPaid(null);
    try {
      const r = await eventsApi.register(id!, { openToMeet, ...(e?.price ? checkoutReturnUrls(id!) : {}) });
      analytics.track('event_registered', { status: r.status });
      if (r.status === 'payment_required') return await pay(r.checkoutUrl);
      if (r.status === 'waitlisted') setNotice(t('events.waitlistedNotice'));
      event.reload();
    } catch (err) {
      const g = gateFor(err);
      if (g?.kind === 'paywall') return openPaywall('events', g.entitlement);
      throw err;
    }
  });
  const leave = useAction(async () => {
    await eventsApi.unregister(id!);
    setNotice(null);
    event.reload();
  });

  const status = e?.myStatus ?? null;
  // `interested` on a paid event = checkout started but not confirmed by the payment provider yet.
  const awaitingPayment = status === 'interested' && !!e?.price;
  const active = !!status && status !== 'cancelled' && status !== 'removed' && !awaitingPayment;
  const canRegister = e?.status === 'published' && !active && !e.isOrganizer;

  return (
    <Screen title={e?.title} subtitle={e ? formatDateTime(e.startsAt) : undefined} status={e ? 'ready' : event.status} error={event.error} onRetry={event.reload} testID="event-screen">
      {e ? (
        <View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }}>
            {e.status !== 'published' ? <Badge tone="warning" label={t(`events.status.${e.status}`)} /> : null}
            {status ? <Badge tone="primary" label={t(`events.myStatus.${status}`)} testID="event-my-status" /> : null}
            {e.isOrganizer ? <Badge label={t('events.organizer')} /> : null}
          </View>
          <Text style={{ marginBottom: spacing.lg }}>{e.description}</Text>
          <ListItem label={t('events.when')} value={`${formatDateTime(e.startsAt)} – ${formatDateTime(e.endsAt)}`} />
          <ListItem label={t('events.where')} value={e.isOnline ? t('events.online') : [e.venue.name, e.venue.address, e.city].filter(Boolean).join(', ')} />
          <ListItem label={t('events.attending')} value={e.capacity ? t('events.attendingOf', { count: formatNumber(e.attending), capacity: formatNumber(e.capacity) }) : formatNumber(e.attending)} />
          <ListItem label={t('events.price')} value={e.price ? formatPrice(e.price) : t('events.free')} />

          {notice ? <Notice tone="info" title={notice} testID="event-notice" /> : null}
          {paid === 'cancel' && !ATTENDING.has(status ?? '') ? <Notice title={t('events.checkout.cancelled')} testID="event-checkout-cancelled" /> : null}
          {awaitingPayment ? (
            <View testID="event-payment-pending">
              <Notice tone="warning" title={t(paid === 'success' ? 'events.checkout.confirming' : 'events.checkout.pending')} body={t('events.checkout.pendingBody')} />
              <Button variant="secondary" label={t('events.checkout.refresh')} onPress={event.reload} loading={event.status === 'loading'} testID="event-payment-refresh" />
            </View>
          ) : null}
          {paid === 'success' && ATTENDING.has(status ?? '') ? <Notice tone="success" title={t('events.checkout.confirmed')} testID="event-checkout-confirmed" /> : null}
          {status === 'waitlisted' && !notice ? <Notice title={t('events.waitlistedNotice')} /> : null}

          {e.myCheckInCode && ATTENDING.has(status ?? '') ? (
            <View testID="event-checkin-code" style={{ backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', marginVertical: spacing.lg }}>
              <Text variant="label">{t('events.checkInCode')}</Text>
              <Text variant="display" color="primary" accessibilityLabel={t('events.checkInCodeA11y', { code: e.myCheckInCode.split('').join(' ') })}>
                {e.myCheckInCode}
              </Text>
              <Text variant="caption" color="textMuted" align="center">{t('events.checkInHint')}</Text>
            </View>
          ) : null}

          <FormError error={register.error ?? leave.error} />
          {canRegister ? (
            <View>
              {e.preEventMatching ? <ToggleRow testID="event-open-to-meet" label={t('events.openToMeet')} description={t('events.openToMeetHint')} value={openToMeet} onChange={setOpenToMeet} /> : null}
              {e.price ? <Text variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>{t('events.checkout.note')}</Text> : null}
              <Button
                testID="event-register"
                label={e.price ? t(awaitingPayment ? 'events.checkout.continue' : 'events.checkout.buy', { price: formatPrice(e.price) }) : e.spotsLeft === 0 ? t('events.joinWaitlist') : t('events.register')}
                onPress={() => void register.run()}
                loading={register.pending}
                disabled={!!e.price && e.spotsLeft === 0}
                style={{ marginTop: spacing.md }}
              />
              {e.price && e.spotsLeft === 0 ? <Text variant="caption" color="textMuted">{t('events.full')}</Text> : null}
            </View>
          ) : null}
          {e.isOrganizer ? (
            <Button
              testID="event-organizer-checkin"
              label={t('events.checkIn.open')}
              onPress={() => router.push({ pathname: '/events/check-in', params: { id: e.id, title: e.title } })}
              style={{ marginTop: spacing.md }}
            />
          ) : null}
          {active && status !== 'checked_in' && !e.isOrganizer ? (
            <Button testID="event-leave" variant="secondary" label={status === 'waitlisted' ? t('events.leaveWaitlist') : t('events.cancelRegistration')} onPress={() => void leave.run()} loading={leave.pending} style={{ marginTop: spacing.md }} />
          ) : null}
          {e.conversationId ? <Button variant="ghost" label={t('events.chat')} onPress={() => router.push({ pathname: '/chats/[id]', params: { id: e.conversationId!, name: e.title } })} style={{ marginTop: spacing.sm }} /> : null}
          <ListItem label={t('safety.reportEvent')} onPress={() => router.push({ pathname: '/safety/report', params: { targetType: 'event', targetId: e.id, name: e.title } })} />
        </View>
      ) : null}
    </Screen>
  );
}
