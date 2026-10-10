import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Router from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import { analytics } from '../../analytics';
import { formatDateTime } from '../../i18n/format';
import { uuid } from '../../test/builders';
import { user } from '../../test/fixtures';
import { apiError, mockApi } from '../../test/mockApi';
import { flushAsync, renderWithProviders, seedSession, testConfig } from '../../test/render';
import BlockedUsersScreen from '../safety/BlockedUsersScreen';
import DateSafetyScreen, { SESSION_KEY } from '../safety/DateSafetyScreen';
import ReportScreen from '../safety/ReportScreen';
import SafetyCenterScreen from '../safety/SafetyCenterScreen';
import TrustedContactsScreen from '../safety/TrustedContactsScreen';
import VerificationScreen from '../safety/VerificationScreen';

const router = (Router as unknown as { __router: { push: jest.Mock; back: jest.Mock } }).__router;
const params = (Router as unknown as { __params: Record<string, string> }).__params;
const base = () => ({ 'GET /users/me': { body: user({ onboardingCompleted: true }) }, 'GET /users/me/consents': { body: [] } });
const safetyOn = testConfig({ flags: { date_safety: true } });
const reasons = { body: [{ id: 't1', kind: 'report_reason', key: 'harassment', label: 'Harassment', description: null, parentId: null, sensitive: false }] };
const contact = (over = {}) => ({ id: uuid(11), name: 'Sis', relationship: 'Sister', phoneMasked: '•••234', emailMasked: null, confirmed: true, ...over });
const session = (over = {}) => ({ id: uuid(21), status: 'active', datePlanId: null, trustedContactId: uuid(11), startsAt: '2026-10-08T18:00:00Z', checkInDueAt: '2026-10-08T19:00:00Z', graceMinutes: 15, shareLiveLocation: false, checkedInAt: null, emergencyNumber: '999', ...over });

beforeEach(async () => {
  await seedSession();
  router.push.mockClear();
  router.back.mockClear();
  for (const k of Object.keys(params)) delete params[k];
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
  await SecureStore.deleteItemAsync(SESSION_KEY);
});

describe('SafetyCenterScreen', () => {
  it('links to every safety tool', async () => {
    mockApi(base());
    renderWithProviders(<SafetyCenterScreen />, { config: safetyOn });
    fireEvent.press(screen.getByTestId('safety-date'));
    fireEvent.press(screen.getByTestId('safety-contacts'));
    fireEvent.press(screen.getByTestId('safety-verification'));
    fireEvent.press(screen.getByTestId('safety-blocks'));
    expect(router.push.mock.calls.map((c) => c[0])).toEqual(['/safety/date', '/safety/contacts', '/safety/verification', '/safety/blocks']);
    await flushAsync();
  });
});

describe('ReportScreen', () => {
  it('reports a message with server reasons, attaches it as evidence and also blocks', async () => {
    Object.assign(params, { userId: uuid(401), name: 'Alex', targetType: 'message', targetId: uuid(901) });
    const track = jest.spyOn(analytics, 'track');
    const api = mockApi({ ...base(), 'GET /catalog/report-reasons': reasons, 'POST /reports': { status: 201, body: { reportId: 'r1', blocked: true } } });
    renderWithProviders(<ReportScreen />);
    fireEvent.press(await screen.findByTestId('report-reason'));
    fireEvent.press(screen.getByTestId('report-reason-option-harassment'));
    fireEvent.changeText(screen.getByTestId('report-details'), 'Insulting me');
    fireEvent.press(screen.getByTestId('report-submit'));
    expect(await screen.findByTestId('report-done')).toBeTruthy();
    expect(api.callsTo('POST /reports')[0]!.body).toEqual({ targetType: 'message', targetId: uuid(901), reasonKey: 'harassment', details: 'Insulting me', alsoBlock: true, messageIds: [uuid(901)] });
    expect(track).toHaveBeenCalledWith('report_submitted', { targetType: 'message', reason: 'harassment' });
    expect(track).toHaveBeenCalledWith('block_created', { surface: 'report' });
  });

  it('treats ALREADY_REPORTED as an informational outcome; shows reason load errors', async () => {
    Object.assign(params, { userId: uuid(401), name: 'Alex' });
    const api = mockApi({ ...base(), 'GET /catalog/report-reasons': apiError(500, 'INTERNAL'), 'POST /reports': apiError(409, 'ALREADY_REPORTED') });
    const { unmount } = renderWithProviders(<ReportScreen />);
    expect(await screen.findByTestId('screen-error')).toBeTruthy();
    unmount();
    api.set('GET /catalog/report-reasons', reasons);
    renderWithProviders(<ReportScreen />);
    fireEvent.press(await screen.findByTestId('report-reason'));
    fireEvent.press(screen.getByTestId('report-reason-option-harassment'));
    fireEvent.press(screen.getByTestId('report-submit'));
    expect(await screen.findByText("You've already reported this. Our team is reviewing it.")).toBeTruthy();
  });
});

describe('BlockedUsersScreen', () => {
  it('lists blocked people and unblocks after confirmation', async () => {
    const api = mockApi({ ...base(), 'GET /blocks': { body: [{ userId: uuid(401), displayName: 'Alex', blockedAt: '2026-10-01T00:00:00Z' }] }, [`DELETE /blocks/${uuid(401)}`]: { status: 204 } });
    renderWithProviders(<BlockedUsersScreen />);
    fireEvent.press(await screen.findByTestId(`unblock-${uuid(401)}`));
    await flushAsync();
    expect(api.callsTo(`DELETE /blocks/${uuid(401)}`)).toHaveLength(1);
    expect(await screen.findByTestId('screen-empty')).toBeTruthy();
  });
});

describe('VerificationScreen', () => {
  it('asks for biometric consent, then runs start → evidence upload → submit', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'https://local.test/selfie.jpg', mimeType: 'image/jpeg' }] });
    let consented = false;
    const api = mockApi({
      ...base(),
      'GET /verification': { body: { level: 'none', history: [] } },
      'POST /verification': () => (consented ? { status: 201, body: { requestId: 'vr1', kind: 'selfie', poseChallenge: 'wave', status: 'pending' } } : apiError(400, 'CONSENT_REQUIRED', { consentType: 'biometric_verification' })),
      'POST /users/me/consents': () => {
        consented = true;
        return { body: [] };
      },
      'GET /selfie.jpg': { body: 'x'.repeat(20), headers: { 'content-type': 'image/jpeg' } },
      'POST /verification/vr1/evidence': { status: 201, body: { uploadUrl: 'https://storage.test/ver/1', method: 'PUT', headers: { 'Content-Type': 'image/jpeg' } } },
      'PUT /ver/1': { status: 200 },
      'POST /verification/vr1/submit': { body: { level: 'none', history: [{ id: 'vr1', kind: 'selfie', status: 'processing', poseChallenge: null, rejectionReasonKey: null, submittedAt: '2026-10-08T00:00:00Z', decidedAt: null, expiresAt: null }] } },
    });
    renderWithProviders(<VerificationScreen />);
    fireEvent.press(await screen.findByTestId('verification-start-selfie'));
    fireEvent.press(await screen.findByTestId('verification-consent-check'));
    fireEvent.press(screen.getByTestId('verification-consent-continue'));
    expect(await screen.findByText('Wave at the camera')).toBeTruthy();
    expect(api.callsTo('POST /users/me/consents')[0]!.body).toEqual({ consentType: 'biometric_verification', granted: true });
    fireEvent.press(screen.getByTestId('verification-capture-btn'));
    fireEvent.press(await screen.findByTestId('verification-submit'));
    expect(await screen.findByText('Checking your photos…')).toBeTruthy();
    expect(api.callsTo('POST /verification').map((c) => c.body)).toEqual([{ kind: 'selfie' }, { kind: 'selfie' }]);
    expect(api.callsTo('POST /verification/vr1/evidence')[0]!.body).toEqual({ mimeType: 'image/jpeg', byteSize: 22 });
    expect(api.callsTo('PUT /ver/1')).toHaveLength(1);
  });

  it('records the consent type the API asked for (identity), then proceeds', async () => {
    let consented = false;
    const api = mockApi({
      ...base(),
      'GET /verification': { body: { level: 'none', history: [] } },
      'POST /verification': () => (consented ? { status: 201, body: { requestId: 'vr2', kind: 'identity', poseChallenge: null, status: 'pending' } } : apiError(400, 'CONSENT_REQUIRED', { consentType: 'identity_verification' })),
      'POST /users/me/consents': (req) => {
        consented = req.body.consentType === 'identity_verification';
        return { body: [] };
      },
    });
    renderWithProviders(<VerificationScreen />);
    fireEvent.press(await screen.findByTestId('verification-start-identity'));
    expect(await screen.findByText("We'll check your ID document and a selfie to confirm your identity. These are used only for verification.")).toBeTruthy();
    expect(screen.getByTestId('verification-consent-continue').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('verification-consent-check'));
    fireEvent.press(screen.getByTestId('verification-consent-continue'));
    expect(await screen.findByTestId('verification-capture')).toBeTruthy();
    expect(api.callsTo('POST /users/me/consents').map((c) => c.body)).toEqual([{ consentType: 'identity_verification', granted: true }]);
    expect(api.callsTo('POST /verification').map((c) => c.body)).toEqual([{ kind: 'identity' }, { kind: 'identity' }]);
  });

  it('shows NOT_AVAILABLE_IN_COUNTRY for ID verification', async () => {
    mockApi({ ...base(), 'GET /verification': { body: { level: 'none', history: [] } }, 'POST /verification': apiError(403, 'NOT_AVAILABLE_IN_COUNTRY') });
    renderWithProviders(<VerificationScreen />);
    fireEvent.press(await screen.findByTestId('verification-start-identity'));
    expect(await screen.findByText("This isn't available in your country.")).toBeTruthy();
  });
});

describe('TrustedContactsScreen', () => {
  it('invites a contact and shows the confirmation status; removes one', async () => {
    const api = mockApi({
      ...base(),
      'GET /dates/safety/contacts': { body: [contact()] },
      'POST /dates/safety/contacts': (req) => ({ status: 201, body: [contact(), contact({ id: uuid(12), name: req.body.name, confirmed: false })] }),
      [`DELETE /dates/safety/contacts/${uuid(11)}`]: { status: 204 },
    });
    renderWithProviders(<TrustedContactsScreen />, { config: safetyOn });
    fireEvent.press(await screen.findByTestId('contact-add'));
    fireEvent.changeText(screen.getByTestId('contact-name'), 'Mo');
    fireEvent.changeText(screen.getByTestId('contact-phone'), '12345');
    expect(screen.getByTestId('contact-save').props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('contact-phone'), '+447700900123');
    fireEvent.press(screen.getByTestId('contact-save'));
    expect(await screen.findByText('Waiting for confirmation')).toBeTruthy();
    expect(api.callsTo('POST /dates/safety/contacts')[0]!.body).toEqual({ name: 'Mo', phone: '+447700900123' });
    fireEvent.press(screen.getByTestId(`contact-remove-${uuid(11)}`));
    await flushAsync();
    expect(screen.queryByTestId(`contact-${uuid(11)}`)).toBeNull();
  });

  it('resends an unconfirmed invite; shows the cooldown and the already-confirmed case', async () => {
    const pending = contact({ id: uuid(12), name: 'Mo', confirmed: false });
    const api = mockApi({ ...base(), 'GET /dates/safety/contacts': { body: [contact(), pending] }, [`POST /dates/safety/contacts/${uuid(12)}/resend`]: { body: [contact(), pending] } });
    renderWithProviders(<TrustedContactsScreen />, { config: safetyOn });
    fireEvent.press(await screen.findByTestId(`contact-resend-${uuid(12)}`));
    expect(screen.queryByTestId(`contact-resend-${uuid(11)}`)).toBeNull();
    expect(await screen.findByText('Invite sent again to Mo.')).toBeTruthy();
    expect(api.callsTo(`POST /dates/safety/contacts/${uuid(12)}/resend`)).toHaveLength(1);

    api.set(`POST /dates/safety/contacts/${uuid(12)}/resend`, apiError(429, 'RATE_LIMITED', { retryAfterMin: 10 }));
    fireEvent.press(screen.getByTestId(`contact-resend-${uuid(12)}`));
    expect(await screen.findByText('You can resend this invite in 10 min.')).toBeTruthy();

    api.set(`POST /dates/safety/contacts/${uuid(12)}/resend`, apiError(409, 'CONFLICT'));
    api.set('GET /dates/safety/contacts', { body: [contact(), { ...pending, confirmed: true }] });
    fireEvent.press(screen.getByTestId(`contact-resend-${uuid(12)}`));
    expect(await screen.findByText('Mo has already confirmed.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId(`contact-resend-${uuid(12)}`)).toBeNull());
  });

  it('shows the admin-set maximum when adding is refused with LIMIT_REACHED', async () => {
    const api = mockApi({ ...base(), 'GET /dates/safety/contacts': { body: [contact()] }, 'POST /dates/safety/contacts': apiError(429, 'LIMIT_REACHED', { limit: 1 }) });
    renderWithProviders(<TrustedContactsScreen />, { config: safetyOn });
    fireEvent.press(await screen.findByTestId('contact-add'));
    fireEvent.changeText(screen.getByTestId('contact-name'), 'Mo');
    fireEvent.changeText(screen.getByTestId('contact-email'), 'mo@example.com');
    fireEvent.press(screen.getByTestId('contact-save'));
    expect(await screen.findByText("You've reached the limit of 1 trusted contacts. Remove one to add someone new.")).toBeTruthy();
    expect(screen.queryByTestId('contact-add')).toBeNull();
    expect(api.callsTo('POST /dates/safety/contacts')).toHaveLength(1);
  });

  it('is unavailable when the date_safety flag is off', async () => {
    mockApi(base());
    renderWithProviders(<TrustedContactsScreen />);
    expect(screen.getByText("Date check-ins aren't available right now.")).toBeTruthy();
    await flushAsync();
  });
});

describe('DateSafetyScreen', () => {
  it('starts a check-in shared with a confirmed contact, checks in and sends SOS', async () => {
    Object.assign(params, { datePlanId: uuid(31) });
    const track = jest.spyOn(analytics, 'track');
    const api = mockApi({
      ...base(),
      'GET /dates/safety/contacts': { body: [contact(), contact({ id: uuid(12), name: 'Pending', confirmed: false })] },
      'POST /dates/safety/sessions': { status: 201, body: { ...session(), shareLink: 'https://amora.test/safety/x' } },
      [`POST /dates/safety/sessions/${uuid(21)}/check-in`]: { body: session({ status: 'checked_in' }) },
      [`POST /dates/safety/sessions/${uuid(21)}/sos`]: { body: session({ status: 'sos' }) },
    });
    renderWithProviders(<DateSafetyScreen />, { config: safetyOn });
    expect(await screen.findByTestId(`session-contact-${uuid(11)}`)).toBeTruthy();
    expect(screen.queryByTestId(`session-contact-${uuid(12)}`)).toBeNull();
    fireEvent.press(screen.getByTestId(`session-contact-${uuid(11)}`));
    fireEvent.press(screen.getByTestId('session-checkin-after-30'));
    fireEvent.press(screen.getByTestId('session-start'));
    expect(await screen.findByText('Check-in active')).toBeTruthy();
    expect(api.callsTo('POST /dates/safety/sessions')[0]!.body).toMatchObject({ datePlanId: uuid(31), trustedContactId: uuid(11), checkInAfterMin: 30, shareLiveLocation: false });
    expect(await SecureStore.getItemAsync(SESSION_KEY)).toBe(uuid(21));
    fireEvent.press(screen.getByTestId('session-extend'));
    expect(await screen.findByText('You checked in')).toBeTruthy();
    expect(api.callsTo(`POST /dates/safety/sessions/${uuid(21)}/check-in`)[0]!.body).toEqual({ extendMin: 30 });
    fireEvent.press(screen.getByTestId('session-sos'));
    expect(await screen.findByText('SOS sent — help is being alerted')).toBeTruthy();
    expect(api.callsTo(`POST /dates/safety/sessions/${uuid(21)}/sos`)[0]!.body).toEqual({ latitude: 51.5, longitude: -0.12, accuracyM: 20 });
    expect(track).toHaveBeenCalledWith('safety_session_started', { withContact: true, shareLocation: false });
    expect(track).toHaveBeenCalledWith('sos_triggered', { withLocation: true });
  });

  it('resumes an existing open session when the API reports a conflict', async () => {
    const api = mockApi({ ...base(), 'GET /dates/safety/contacts': { body: [] }, 'POST /dates/safety/sessions': apiError(409, 'CONFLICT', { sessionId: uuid(21) }), [`GET /dates/safety/sessions/${uuid(21)}`]: { body: session({ status: 'overdue' }) } });
    renderWithProviders(<DateSafetyScreen />, { config: safetyOn });
    fireEvent.press(await screen.findByTestId('session-start'));
    expect(await screen.findByText('You missed your check-in')).toBeTruthy();
    await waitFor(() => expect(api.callsTo(`GET /dates/safety/sessions/${uuid(21)}`)).toHaveLength(1));
  });

  it('loads the escalated/SOS session the API reports (409 with sessionId) instead of erroring on start', async () => {
    const api = mockApi({
      ...base(),
      'GET /dates/safety/contacts': { body: [] },
      'GET /dates/safety/sessions/active': { body: { session: null } },
      'POST /dates/safety/sessions': apiError(409, 'CONFLICT', { sessionId: uuid(21) }),
      [`GET /dates/safety/sessions/${uuid(21)}`]: { body: session({ status: 'sos' }) },
    });
    renderWithProviders(<DateSafetyScreen />, { config: safetyOn });
    fireEvent.press(await screen.findByTestId('safety-start') && screen.getByTestId('session-start'));
    expect(await screen.findByText('SOS sent — help is being alerted')).toBeTruthy();
    expect(screen.queryByTestId('form-error')).toBeNull();
    expect(screen.getByTestId('session-sos')).toBeTruthy();
    expect(await SecureStore.getItemAsync(SESSION_KEY)).toBe(uuid(21));
    expect(api.callsTo(`GET /dates/safety/sessions/${uuid(21)}`)).toHaveLength(1);
  });

  it('restores the open session from the server after a restart (no local id needed)', async () => {
    const api = mockApi({ ...base(), 'GET /dates/safety/contacts': { body: [] }, 'GET /dates/safety/sessions/active': { body: { session: session({ status: 'checked_in' }) } } });
    renderWithProviders(<DateSafetyScreen />, { config: safetyOn });
    expect(await screen.findByText('You checked in')).toBeTruthy();
    expect(await SecureStore.getItemAsync(SESSION_KEY)).toBe(uuid(21));
    expect(api.callsTo(`GET /dates/safety/sessions/${uuid(21)}`)).toHaveLength(0);
  });

  it('clears a stale cached id when the server has no open session; falls back to the cache when offline', async () => {
    await SecureStore.setItemAsync(SESSION_KEY, uuid(21));
    const api = mockApi({ ...base(), 'GET /dates/safety/contacts': { body: [] }, 'GET /dates/safety/sessions/active': { body: { session: null } } });
    const { unmount } = renderWithProviders(<DateSafetyScreen />, { config: safetyOn });
    expect(await screen.findByTestId('safety-start')).toBeTruthy();
    expect(await SecureStore.getItemAsync(SESSION_KEY)).toBeNull();
    unmount();

    await SecureStore.setItemAsync(SESSION_KEY, uuid(21));
    api.set('GET /dates/safety/sessions/active', apiError(503, 'INTERNAL'));
    api.set(`GET /dates/safety/sessions/${uuid(21)}`, { body: session() });
    renderWithProviders(<DateSafetyScreen />, { config: safetyOn });
    expect(await screen.findByText('Check-in active')).toBeTruthy();
  });

  it('asks for precise-location consent before sharing live location, records it and retries', async () => {
    let consented = false;
    const api = mockApi({
      ...base(),
      'GET /dates/safety/contacts': { body: [] },
      'GET /dates/safety/sessions/active': { body: { session: null } },
      'POST /dates/safety/sessions': () => (consented ? { status: 201, body: session({ shareLiveLocation: true }) } : apiError(400, 'CONSENT_REQUIRED', { consentType: 'precise_location' })),
      'POST /users/me/consents': (req) => {
        consented = req.body.consentType === 'precise_location' && req.body.granted === true;
        return { body: [] };
      },
      [`POST /dates/safety/sessions/${uuid(21)}/location`]: { status: 204 },
    });
    renderWithProviders(<DateSafetyScreen />, { config: safetyOn });
    fireEvent(await screen.findByTestId('session-share-location'), 'valueChange', true);
    fireEvent.press(screen.getByTestId('session-start'));
    expect(await screen.findByTestId('precise-location-consent')).toBeTruthy();
    expect(screen.queryByTestId('form-error')).toBeNull();
    fireEvent.press(screen.getByTestId('precise-location-allow'));
    expect(await screen.findByText('Check-in active')).toBeTruthy();
    expect(api.callsTo('POST /users/me/consents')[0]!.body).toEqual({ consentType: 'precise_location', granted: true });
    expect(api.callsTo('POST /dates/safety/sessions').map((c) => c.body.shareLiveLocation)).toEqual([true, true]);
    await waitFor(() => expect(api.callsTo(`POST /dates/safety/sessions/${uuid(21)}/location`)).toHaveLength(1));
    expect(screen.getByTestId('session-ping')).toBeTruthy();
  });

  it('continues without live location when precise-location consent is declined', async () => {
    const api = mockApi({
      ...base(),
      'GET /dates/safety/contacts': { body: [] },
      'GET /dates/safety/sessions/active': { body: { session: null } },
      'POST /dates/safety/sessions': (req) => (req.body.shareLiveLocation ? apiError(400, 'CONSENT_REQUIRED', { consentType: 'precise_location' }) : { status: 201, body: session() }),
    });
    renderWithProviders(<DateSafetyScreen />, { config: safetyOn });
    fireEvent(await screen.findByTestId('session-share-location'), 'valueChange', true);
    fireEvent.press(screen.getByTestId('session-start'));
    fireEvent.press(await screen.findByTestId('precise-location-decline'));
    expect(await screen.findByText('Check-in active')).toBeTruthy();
    expect(api.callsTo('POST /dates/safety/sessions').map((c) => c.body.shareLiveLocation)).toEqual([true, false]);
    expect(api.callsTo('POST /users/me/consents')).toHaveLength(0);
    expect(screen.queryByTestId('session-ping')).toBeNull();
  });

  it('asks for consent when a live location ping is refused', async () => {
    let consented = false;
    const api = mockApi({
      ...base(),
      'GET /dates/safety/contacts': { body: [] },
      'GET /dates/safety/sessions/active': { body: { session: session({ shareLiveLocation: true }) } },
      [`POST /dates/safety/sessions/${uuid(21)}/location`]: () => (consented ? { status: 204 } : apiError(400, 'CONSENT_REQUIRED', { consentType: 'precise_location' })),
      'POST /users/me/consents': () => {
        consented = true;
        return { body: [] };
      },
    });
    renderWithProviders(<DateSafetyScreen />, { config: safetyOn });
    fireEvent.press(await screen.findByTestId('session-ping'));
    fireEvent.press(await screen.findByTestId('precise-location-allow'));
    await waitFor(() => expect(api.callsTo(`POST /dates/safety/sessions/${uuid(21)}/location`)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByTestId('precise-location-consent')).toBeNull());
  });

  it('shows the fresh check-in window after checking in late', async () => {
    const later = '2026-10-08T20:30:00.000Z';
    mockApi({
      ...base(),
      'GET /dates/safety/contacts': { body: [] },
      'GET /dates/safety/sessions/active': { body: { session: session({ status: 'overdue' }) } },
      [`POST /dates/safety/sessions/${uuid(21)}/check-in`]: { body: session({ status: 'checked_in', checkedInAt: '2026-10-08T20:00:00.000Z', checkInDueAt: later }) },
    });
    renderWithProviders(<DateSafetyScreen />, { config: safetyOn });
    expect(await screen.findByText('You missed your check-in')).toBeTruthy();
    expect(screen.getByText(`Check in by ${formatDateTime('2026-10-08T19:00:00Z')}`)).toBeTruthy();
    fireEvent.press(screen.getByTestId('session-checkin'));
    expect(await screen.findByText('You checked in')).toBeTruthy();
    expect(screen.getByText(`Check in by ${formatDateTime(later)}`)).toBeTruthy();
  });
});
