import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useSession } from '../../auth/SessionProvider';
import { apiError, mockApi } from '../../test/mockApi';
import { tokens, user } from '../../test/fixtures';
import { renderWithProviders, signOutForTest } from '../../test/render';
import LoginScreen from '../auth/LoginScreen';
import RegisterScreen from '../auth/RegisterScreen';
import WelcomeScreen from '../auth/WelcomeScreen';

function SessionProbe() {
  const { state } = useSession();
  return <Text testID="session-status">{state.status}</Text>;
}

beforeEach(async () => {
  await signOutForTest();
});

describe('LoginScreen', () => {
  it('validates locally before calling the API', async () => {
    const api = mockApi({});
    renderWithProviders(<LoginScreen />);
    fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByText('Enter your email or a phone number with country code.')).toBeTruthy();
    expect(api.callsTo('POST /auth/login')).toHaveLength(0);
  });

  it('signs in with device info and starts a session', async () => {
    const api = mockApi({
      'POST /auth/login': { body: { user: user(), tokens: tokens(), isNewUser: false } },
      'GET /users/me/consents': { body: [] },
    });
    renderWithProviders(
      <>
        <LoginScreen />
        <SessionProbe />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('session-status').props.children).toBe('signedOut'));
    fireEvent.changeText(screen.getByTestId('login-identifier'), 'Sam@Example.com');
    fireEvent.changeText(screen.getByTestId('login-password'), 'correct horse');
    fireEvent.press(screen.getByTestId('login-submit'));
    await waitFor(() => expect(screen.getByTestId('session-status').props.children).toBe('signedIn'));
    const body = api.callsTo('POST /auth/login')[0]!.body;
    expect(body).toMatchObject({ identifier: 'Sam@Example.com', password: 'correct horse', device: { platform: 'ios', appVersion: '1.0.0' } });
    expect(body.device.installationId.length).toBeGreaterThanOrEqual(8);
  });

  it('shows the localized server error', async () => {
    mockApi({ 'POST /auth/login': apiError(401, 'INVALID_CREDENTIALS') });
    renderWithProviders(<LoginScreen />);
    fireEvent.changeText(screen.getByTestId('login-identifier'), '+447700900123');
    fireEvent.changeText(screen.getByTestId('login-password'), 'nope');
    fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByText("Those details don't match our records.")).toBeTruthy();
    expect(screen.getByText('Reference: req-test-1')).toBeTruthy();
  });
});

describe('RegisterScreen', () => {
  const routes = () => ({
    'GET /catalog/countries': { body: [{ code: 'GB', name: 'United Kingdom', defaultLocale: 'en', currency: 'GBP', measurement: 'metric' }] },
    'GET /legal/terms': { body: { id: '33333333-3333-4333-8333-333333333333', type: 'terms', version: 2, locale: 'en', countryCode: null, title: 'Terms', bodyMarkdown: '# T', effectiveAt: null } },
    'GET /legal/privacy': { body: { id: '44444444-4444-4444-8444-444444444444', type: 'privacy', version: 1, locale: 'en', countryCode: null, title: 'Privacy', bodyMarkdown: '# P', effectiveAt: null } },
  });

  async function fill(dobYear: string) {
    await screen.findByTestId('accept-terms');
    fireEvent.changeText(screen.getByTestId('register-email'), 'new@example.com');
    fireEvent.changeText(screen.getByTestId('register-password'), 'a-long-passphrase');
    fireEvent.changeText(screen.getByTestId('dob-day'), '01');
    fireEvent.changeText(screen.getByTestId('dob-month'), '02');
    fireEvent.changeText(screen.getByTestId('dob-year'), dobYear);
    fireEvent.press(screen.getByTestId('accept-terms'));
    fireEvent.press(screen.getByTestId('accept-privacy'));
    fireEvent.press(screen.getByTestId('confirm-age'));
  }

  it('blocks under-18 dates of birth on the client', async () => {
    const api = mockApi(routes());
    renderWithProviders(<RegisterScreen />);
    await fill(String(new Date().getFullYear() - 10));
    fireEvent.press(screen.getByTestId('register-submit'));
    expect(await screen.findByText('You must be at least 18 to use this service.')).toBeTruthy();
    expect(api.callsTo('POST /auth/register')).toHaveLength(0);
  });

  it('sends version-pinned legal acceptance and handles AGE_INELIGIBLE from the server', async () => {
    const api = mockApi({ ...routes(), 'POST /auth/register': apiError(403, 'AGE_INELIGIBLE', { minAge: 21 }) });
    renderWithProviders(<RegisterScreen />);
    await fill('2006');
    fireEvent.press(screen.getByTestId('register-submit'));
    expect(await screen.findByTestId('register-ineligible')).toBeTruthy();
    expect(screen.getByText('You must be at least 21 to use this service in your country.')).toBeTruthy();
    expect(api.callsTo('POST /auth/register')[0]!.body).toMatchObject({
      email: 'new@example.com',
      dateOfBirth: '2006-02-01',
      countryCode: 'GB',
      acceptedTermsVersionId: '33333333-3333-4333-8333-333333333333',
      acceptedPrivacyVersionId: '44444444-4444-4444-8444-444444444444',
      confirmsMinimumAge: true,
      marketingOptIn: false,
      locale: 'en',
    });
  });
});

describe('WelcomeScreen', () => {
  it('marks social providers without client configuration as unavailable instead of offering dead buttons', async () => {
    mockApi({});
    renderWithProviders(<WelcomeScreen />);
    expect(await screen.findByTestId('social-google-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('social-google')).toBeNull();
  });
});
