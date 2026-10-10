import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import * as Router from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { analytics } from '../../analytics';
import { client } from '../../api';
import { routeForDeepLink } from '../../notifications/deepLink';
import { registerForPush } from '../../notifications/push';
import { user } from '../../test/fixtures';
import { apiError, mockApi } from '../../test/mockApi';
import { renderWithProviders, seedSession, testConfig } from '../../test/render';
import InboxScreen from '../notifications/InboxScreen';
import NotificationSettingsScreen from '../notifications/NotificationSettingsScreen';
import PremiumScreen from '../premium/PremiumScreen';
import DataPrivacyScreen from '../settings/DataPrivacyScreen';
import DeleteAccountScreen from '../settings/DeleteAccountScreen';

jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn(), openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));

const router = (Router as unknown as { __router: { push: jest.Mock } }).__router;
const params = (Router as unknown as { __params: Record<string, string> }).__params;
const base = () => ({ 'GET /users/me': { body: user({ onboardingCompleted: true }) }, 'GET /users/me/consents': { body: [] } });
const me = (over = {}) => ({ subscriptions: [], entitlements: [], allowances: { likes: { unlimited: false, limit: 50, used: 10, remaining: 40, period: 'day', resetsAt: '2026-10-09T00:00:00Z' } }, balances: {}, recentPayments: [], ...over });
const price = (over = {}) => ({ productKey: 'premium', kind: 'subscription', tier: 'premium', rank: 1, name: 'Premium', description: 'All the extras', priceId: 'p1', provider: 'apple', providerPriceId: 'app.amora.premium.month', currency: 'GBP', amountMinor: 999, interval: 'month', intervalCount: 1, trialDays: 7, consumable: null, entitlements: [{ key: 'see_who_liked', limit: null, period: null }], ...over });

beforeEach(async () => {
  await seedSession();
  router.push.mockClear();
  for (const k of Object.keys(params)) delete params[k];
});

describe('PremiumScreen', () => {
  it('shows plans from the API and entitlements, with buying disabled and explained; never purchases', async () => {
    Object.assign(params, { surface: 'likes_received', entitlement: 'see_who_liked' });
    const track = jest.spyOn(analytics, 'track');
    const api = mockApi({ ...base(), 'GET /billing/me': { body: me({ entitlements: ['incognito'] }) }, 'GET /billing/products': { body: [price(), price({ priceId: 'p2', interval: 'year', amountMinor: 5999 })] } });
    renderWithProviders(<PremiumScreen />, { config: testConfig({ flags: { subscriptions: true } }) });
    expect(await screen.findByTestId('plan-premium')).toBeTruthy();
    expect(screen.getByTestId('premium-store-unavailable')).toBeTruthy();
    expect(screen.getByTestId('buy-p1').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Incognito mode')).toBeTruthy();
    expect(screen.getByText('40 of 50 left')).toBeTruthy();
    expect(screen.getAllByText('7-day free trial')).toHaveLength(2);
    expect(api.callsTo('GET /billing/products')[0]!.query.get('platform')).toBe('ios');
    expect(track).toHaveBeenCalledWith('paywall_viewed', { surface: 'likes_received', entitlement: 'see_who_liked', variant: null });
    fireEvent.press(screen.getByTestId('buy-p1'));
    expect(api.calls.filter((c) => c.path.startsWith('/billing/receipts'))).toHaveLength(0);
  });

  it('restore rebuilds entitlements server-side (POST /billing/restore); disabled flag shows unavailable; errors retry', async () => {
    const api = mockApi({ ...base(), 'GET /billing/me': { body: me() }, 'GET /billing/products': { body: [] }, 'POST /billing/restore': { body: { refreshed: 0, ...me({ entitlements: ['incognito'] }) } } });
    const { unmount } = renderWithProviders(<PremiumScreen />);
    expect(await screen.findByTestId('premium-unavailable')).toBeTruthy();
    fireEvent.press(screen.getByTestId('premium-restore'));
    expect(await screen.findByTestId('premium-restored')).toBeTruthy();
    expect(api.callsTo('POST /billing/restore')).toHaveLength(1);
    expect(api.callsTo('GET /billing/me')).toHaveLength(1);
    expect(screen.getByText('Incognito mode')).toBeTruthy();
    // iOS: the copy stays honest that App Store purchases need the device to re-send them.
    expect(screen.getByText(/App Store purchases can only be re-linked from this device/)).toBeTruthy();
    unmount();
    api.set('GET /billing/me', apiError(500, 'INTERNAL'));
    renderWithProviders(<PremiumScreen />);
    expect(await screen.findByTestId('screen-error')).toBeTruthy();
  });

  it('shows restore failures inline', async () => {
    mockApi({ ...base(), 'GET /billing/me': { body: me() }, 'GET /billing/products': { body: [] }, 'POST /billing/restore': apiError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED') });
    renderWithProviders(<PremiumScreen />);
    fireEvent.press(await screen.findByTestId('premium-restore'));
    expect(await screen.findByTestId('form-error')).toBeTruthy();
    expect(screen.queryByTestId('premium-restored')).toBeNull();
  });
});

describe('Notifications', () => {
  it('inbox marks a notification read and follows its deep link; mark all read', async () => {
    const api = mockApi({
      ...base(),
      'GET /notifications': { body: { unread: 2, nextCursor: null, items: [{ id: 'n1', category: 'match', title: 'New match!', body: 'Say hi to Alex', deepLink: 'amora://chat/c-1', read: false, createdAt: '2026-10-08T00:00:00Z' }, { id: 'n2', category: 'like', title: null, body: null, deepLink: null, read: false, createdAt: '2026-10-08T00:00:00Z' }] } },
      'POST /notifications/n1/read': { status: 204 },
      'POST /notifications/read-all': { status: 204 },
    });
    renderWithProviders(<InboxScreen />);
    fireEvent.press(await screen.findByTestId('notification-n1'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/chats/[id]', params: { id: 'c-1' } }));
    expect(api.callsTo('POST /notifications/n1/read')).toHaveLength(1);
    expect(screen.getByText('Likes')).toBeTruthy();
    fireEvent.press(screen.getByTestId('inbox-read-all'));
    await waitFor(() => expect(api.callsTo('POST /notifications/read-all')).toHaveLength(1));
  });

  it('maps server deep links to routes', () => {
    expect(routeForDeepLink('amora://settings/subscription')).toBe('/premium');
    expect(routeForDeepLink('amora://likes')).toBe('/discover/likes');
    expect(routeForDeepLink('amora://unknown/x')).toBeNull();
  });

  it('saves preferences (except locked ones) with quiet hours', async () => {
    const api = mockApi({
      ...base(),
      'GET /notifications/preferences': { body: { quietHours: null, preferences: [{ category: 'message', channel: 'push', enabled: true, locked: false }, { category: 'safety', channel: 'push', enabled: true, locked: true }] } },
      'PUT /notifications/preferences': (req) => ({ body: { quietHours: req.body.quietHours, preferences: [{ category: 'message', channel: 'push', enabled: false, locked: false }, { category: 'safety', channel: 'push', enabled: true, locked: true }] } }),
    });
    renderWithProviders(<NotificationSettingsScreen />);
    fireEvent(await screen.findByTestId('notif-message-push'), 'valueChange', false);
    expect(screen.getByTestId('notif-safety-push').props.disabled).toBe(true);
    fireEvent(screen.getByTestId('notif-quiet'), 'valueChange', true);
    fireEvent.changeText(screen.getByTestId('notif-quiet-start'), '23:00');
    fireEvent.press(screen.getByTestId('notif-save'));
    await waitFor(() => expect(api.callsTo('PUT /notifications/preferences')).toHaveLength(1));
    expect(api.callsTo('PUT /notifications/preferences')[0]!.body).toEqual({ preferences: [{ category: 'message', channel: 'push', enabled: false }], quietHours: { start: '23:00', end: '08:00', timezone: 'Europe/London' } });
  });

  it('registers the native device token with the API after permission', async () => {
    const api = mockApi({ ...base(), 'POST /devices/push-token': { status: 204 } });
    expect(await registerForPush({ prompt: false })).toBe('denied');
    expect(await registerForPush({ prompt: true })).toBe('registered');
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    const body = api.callsTo('POST /devices/push-token')[0]!.body;
    expect(body).toMatchObject({ provider: 'apns', token: 'apns-device-token-0123456789' });
    expect(body.installationId.length).toBeGreaterThanOrEqual(8);
  });
});

describe('Data & account', () => {
  it('requests a data export and offers the download link', async () => {
    const track = jest.spyOn(analytics, 'track');
    let requested = false;
    const api = mockApi({
      ...base(),
      'GET /users/me/privacy/requests': () => ({ body: requested ? [{ id: 'x1', kind: 'export', status: 'completed', requestedAt: '2026-10-01T00:00:00Z', completedAt: '2026-10-01T01:00:00Z', downloadUrl: 'https://dl.test/x1', scheduledFor: null }] : [] }),
      'POST /users/me/privacy/export': () => {
        requested = true;
        return { status: 201, body: { requestId: 'x1', status: 'received' } };
      },
    });
    renderWithProviders(<DataPrivacyScreen />);
    fireEvent.press(await screen.findByTestId('export-request'));
    fireEvent.press(await screen.findByTestId('export-download-x1'));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://dl.test/x1');
    expect(api.callsTo('POST /users/me/privacy/export')).toHaveLength(1);
    expect(track).toHaveBeenCalledWith('data_export_requested', {});
  });

  it('shows a scheduled deletion and restores the account', async () => {
    const api = mockApi({ ...base(), 'GET /users/me/privacy/requests': { body: [{ id: 'd1', kind: 'delete', status: 'in_progress', requestedAt: '2026-10-01T00:00:00Z', completedAt: null, downloadUrl: null, scheduledFor: '2026-10-15T00:00:00Z' }] }, 'DELETE /users/me/privacy/delete-account': { status: 204 } });
    renderWithProviders(<DataPrivacyScreen />);
    fireEvent.press(await screen.findByTestId('deletion-restore'));
    await waitFor(() => expect(api.callsTo('DELETE /users/me/privacy/delete-account')).toHaveLength(1));
  });

  it('deletes the account with password re-auth, explains the grace period, then signs out', async () => {
    const api = mockApi({ ...base(), 'POST /users/me/privacy/delete-account': (req) => (req.body.password === 'right-password' ? { body: { status: 'scheduled', purgeAt: '2026-10-22T00:00:00Z' } } : apiError(401, 'INVALID_CREDENTIALS')), 'POST /auth/logout': apiError(401, 'TOKEN_INVALID') });
    renderWithProviders(<DeleteAccountScreen />);
    expect(screen.getByText('You have 14 days to change your mind', { exact: false })).toBeTruthy();
    expect(screen.getByTestId('delete-submit').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('delete-confirm'));
    fireEvent.changeText(screen.getByTestId('delete-password'), 'wrong');
    fireEvent.press(screen.getByTestId('delete-submit'));
    expect(await screen.findByText("Those details don't match our records.")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('delete-password'), 'right-password');
    fireEvent.press(screen.getByTestId('delete-submit'));
    expect(await screen.findByTestId('delete-scheduled')).toBeTruthy();
    expect(api.callsTo('POST /users/me/privacy/delete-account').at(-1)!.body).toEqual({ password: 'right-password' });
    fireEvent.press(screen.getByTestId('delete-signout'));
    await waitFor(async () => expect(await client.hasSession()).toBe(false));
  });
});
