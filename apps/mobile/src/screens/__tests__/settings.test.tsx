import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { privacy, user } from '../../test/fixtures';
import { apiError, mockApi } from '../../test/mockApi';
import { flushAsync, renderWithProviders, seedSession, testConfig } from '../../test/render';
import ConsentsScreen from '../settings/ConsentsScreen';
import ContentScreen from '../settings/ContentScreen';
import PrivacyScreen from '../settings/PrivacyScreen';
import SessionsScreen from '../settings/SessionsScreen';
import SettingsScreen from '../settings/SettingsScreen';

const base = () => ({ 'GET /users/me': { body: user() }, 'GET /users/me/consents': { body: [] } });
const session = (id: string, current: boolean) => ({ id, current, platform: 'ios', model: 'iPhone', osVersion: '18.0', appVersion: '1.0.0', createdAt: '2026-10-01T10:00:00Z', lastUsedAt: '2026-10-08T10:00:00Z' });

beforeEach(async () => {
  await seedSession();
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
});

describe('SessionsScreen', () => {
  it('lists sessions, revokes one and then all others', async () => {
    const api = mockApi({
      ...base(),
      'GET /users/me/sessions': { body: [session('s1', true), session('s2', false), session('s3', false)] },
      'DELETE /users/me/sessions/s2': { status: 204 },
      'POST /users/me/sessions/revoke-others': { status: 204 },
    });
    renderWithProviders(<SessionsScreen />);
    expect(await screen.findByText('This device')).toBeTruthy();
    fireEvent.press(screen.getByTestId('revoke-s2'));
    await flushAsync();
    expect(screen.queryByTestId('session-s2')).toBeNull();
    fireEvent.press(screen.getByTestId('revoke-others'));
    await flushAsync();
    expect(screen.queryByTestId('session-s3')).toBeNull();
    expect(api.callsTo('DELETE /users/me/sessions/s2')).toHaveLength(1);
    expect(api.callsTo('POST /users/me/sessions/revoke-others')).toHaveLength(1);
    expect(screen.getByTestId('session-s1')).toBeTruthy();
  });
});

describe('PrivacyScreen', () => {
  it('saves toggles immediately and offers the paywall when incognito needs premium', async () => {
    const api = mockApi({
      ...base(),
      'GET /profiles/me/privacy': { body: privacy() },
      'PUT /profiles/me/privacy': (req) => (req.body.incognito ? apiError(402, 'ENTITLEMENT_REQUIRED', { entitlement: 'incognito' }) : { body: { ...privacy(), ...req.body } }),
    });
    renderWithProviders(<PrivacyScreen />);
    fireEvent(await screen.findByTestId('privacy-showAge'), 'valueChange', false);
    await waitFor(() => expect(screen.getByTestId('privacy-showAge').props.value).toBe(false));
    fireEvent(screen.getByTestId('privacy-incognito'), 'valueChange', true);
    expect(await screen.findByTestId('upsell')).toBeTruthy();
    expect(screen.getByTestId('privacy-incognito').props.value).toBe(false);
    expect(api.callsTo('PUT /profiles/me/privacy').map((c) => c.body)).toEqual([{ showAge: false }, { incognito: true }]);
  });
});

describe('ConsentsScreen', () => {
  it('hides flag-gated consents unless the flag is on, and records changes', async () => {
    const api = mockApi({ ...base(), 'POST /users/me/consents': (req) => ({ body: [{ consentType: req.body.consentType, granted: req.body.granted, legalDocumentId: null, updatedAt: '2026-10-08T00:00:00Z' }] }) });
    const { unmount } = renderWithProviders(<ConsentsScreen />);
    expect(await screen.findByTestId('consent-location')).toBeTruthy();
    expect(screen.queryByTestId('consent-crossed_paths')).toBeNull();
    fireEvent(screen.getByTestId('consent-marketing_email'), 'valueChange', true);
    await waitFor(() => expect(api.callsTo('POST /users/me/consents')).toHaveLength(1));
    expect(api.callsTo('POST /users/me/consents')[0]!.body).toEqual({ consentType: 'marketing_email', granted: true });
    unmount();

    renderWithProviders(<ConsentsScreen />, { config: testConfig({ flags: { crossed_paths: true } }) });
    expect(await screen.findByTestId('consent-crossed_paths')).toBeTruthy();
  });
});

describe('SettingsScreen', () => {
  it('links account/privacy features and signs out via the API', async () => {
    const api = mockApi({ ...base(), 'POST /auth/logout': { status: 204 } });
    renderWithProviders(<SettingsScreen />);
    const router = (jest.requireMock('expo-router') as { __router: { push: jest.Mock } }).__router;
    fireEvent.press(screen.getByTestId('settings-delete'));
    expect(router.push).toHaveBeenCalledWith('/settings/delete-account');
    fireEvent.press(screen.getByTestId('settings-notifications'));
    expect(router.push).toHaveBeenCalledWith('/settings/notifications');
    expect(screen.getByText('support@example.com')).toBeTruthy();
    await waitFor(() => expect(api.callsTo('GET /users/me')).toHaveLength(1));
    fireEvent.press(screen.getByTestId('settings-logout'));
    await waitFor(() => expect(api.callsTo('POST /auth/logout')).toHaveLength(1));
  });
});

describe('ContentScreen', () => {
  it('loads FAQ entries for the kind and expands an answer', async () => {
    const Router = jest.requireMock('expo-router') as { __params: Record<string, string> };
    Router.__params.kind = 'faq';
    const api = mockApi({
      ...base(),
      'GET /content': { body: [{ id: 'c1', key: 'faq.delete', kind: 'faq', category: null, locale: 'en', title: 'How do I delete?', bodyMarkdown: 'Go to **Settings**.', publishedAt: null }] },
    });
    renderWithProviders(<ContentScreen />);
    fireEvent.press(await screen.findByTestId('content-faq.delete'));
    expect(screen.getByTestId('content-body-faq.delete')).toBeTruthy();
    expect(api.callsTo('GET /content')[0]!.query.get('kind')).toBe('faq');
  });
});
