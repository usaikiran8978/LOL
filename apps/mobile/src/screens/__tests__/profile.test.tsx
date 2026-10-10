import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Router from 'expo-router';
import { Alert } from 'react-native';
import { uploadPhoto } from '../../features/profile/MediaManager';
import { PreferencesEditor } from '../../features/profile/PreferencesEditor';
import { profile, user } from '../../test/fixtures';
import { apiError, mockApi } from '../../test/mockApi';
import { flushAsync, renderWithProviders, seedSession } from '../../test/render';
import { EditMediaScreen } from '../profile/EditScreens';
import ProfileScreen from '../profile/ProfileScreen';

const router = (Router as unknown as { __router: { push: jest.Mock } }).__router;
const base = () => ({ 'GET /users/me': { body: user() }, 'GET /users/me/consents': { body: [] } });
const media = (over: Record<string, unknown> = {}) => ({ id: 'm1', kind: 'photo', position: 0, processingStatus: 'ready', moderationStatus: 'approved', width: 1, height: 1, durationMs: null, caption: null, url: 'https://cdn.test/m1', thumbUrl: 'https://cdn.test/m1/t', ...over });

beforeEach(seedSession);

describe('ProfileScreen', () => {
  it('shows the own profile with labels resolved from the catalog', async () => {
    mockApi({
      ...base(),
      'GET /profiles/me': { body: profile({ media: [media() as never] }) },
      'GET /catalog/interests': { body: [{ id: 'c1', key: 'outdoors', icon: null, label: 'Outdoors', interests: [{ id: 'i-hiking', key: 'hiking', icon: null, categoryId: 'c1', label: 'Hiking' }] }] },
      'GET /catalog/prompts': { body: [] },
    });
    renderWithProviders(<ProfileScreen />);
    expect(await screen.findByText('Sam')).toBeTruthy();
    expect(screen.getByText('30 years old')).toBeTruthy();
    expect(await screen.findByLabelText('Hiking')).toBeTruthy();
    expect(screen.getByLabelText('Photo 1')).toBeTruthy();
    expect(screen.getByTestId('completeness').props.accessibilityValue).toMatchObject({ now: 55 });
    fireEvent.press(screen.getByTestId('profile-photo-verification'));
    expect(router.push).toHaveBeenCalledWith('/safety/verification');
  });

  it('shows an error state with retry', async () => {
    const api = mockApi({ ...base(), 'GET /profiles/me': apiError(500, 'INTERNAL'), 'GET /catalog/interests': { body: [] }, 'GET /catalog/prompts': { body: [] } });
    renderWithProviders(<ProfileScreen />);
    expect(await screen.findByTestId('screen-error')).toBeTruthy();
    api.set('GET /profiles/me', { body: profile() });
    fireEvent.press(screen.getByTestId('screen-retry'));
    expect(await screen.findByText('Sam')).toBeTruthy();
  });
});

describe('Media manager', () => {
  it('uploads through the signed-URL flow: ticket → PUT bytes → confirm', async () => {
    const api = mockApi({
      'GET /photo.jpg': { body: 'x'.repeat(10), headers: { 'content-type': 'image/jpeg' } },
      'POST /media/uploads': { body: { mediaId: 'm9', uploadUrl: 'https://storage.test/bucket/key', method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, expiresAt: '2030-01-01T00:00:00Z' } },
      'PUT /bucket/key': { status: 200 },
      'POST /media/m9/confirm': { body: media({ id: 'm9', processingStatus: 'processing', url: null, thumbUrl: null }) },
    });
    await seedSession();
    const created = await uploadPhoto({ uri: 'https://local.test/photo.jpg', mimeType: 'image/jpeg' });
    expect(created).toMatchObject({ id: 'm9', processingStatus: 'processing' });
    expect(api.callsTo('POST /media/uploads')[0]!.body).toMatchObject({ kind: 'photo', mimeType: 'image/jpeg' });
    const put = api.callsTo('PUT /bucket/key')[0]!;
    expect(put.headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('cleans up the pending row when the storage upload fails', async () => {
    const api = mockApi({
      'GET /photo.jpg': { body: 'x' },
      'POST /media/uploads': { body: { mediaId: 'm9', uploadUrl: 'https://storage.test/bucket/key', method: 'PUT', headers: {}, expiresAt: '2030-01-01T00:00:00Z' } },
      'PUT /bucket/key': { status: 403 },
      'DELETE /media/m9': { status: 204 },
    });
    await expect(uploadPhoto({ uri: 'https://local.test/photo.jpg' })).rejects.toMatchObject({ code: 'MEDIA_NOT_UPLOADED' });
    expect(api.callsTo('DELETE /media/m9')).toHaveLength(1);
  });

  it('lists photos with processing/moderation status and deletes after confirmation', async () => {
    const api = mockApi({
      ...base(),
      'GET /media': { body: [media(), media({ id: 'm2', position: 1, moderationStatus: 'pending' })] },
      'DELETE /media/m2': { status: 204 },
    });
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    renderWithProviders(<EditMediaScreen />);
    expect(await screen.findByText('Ready · awaiting review')).toBeTruthy();
    fireEvent.press(screen.getByTestId('media-delete-m2'));
    await flushAsync();
    expect(screen.queryByTestId('media-m2')).toBeNull();
    expect(api.callsTo('DELETE /media/m2')).toHaveLength(1);
  });
});

describe('Preferences', () => {
  it('handles ENTITLEMENT_REQUIRED for advanced filters with a paywall entry point', async () => {
    const api = mockApi({
      ...base(),
      'GET /preferences': { body: { ageMin: 25, ageMax: 40, maxDistanceKm: 50, distanceStrict: false, ageStrict: true, heightMinCm: null, heightMaxCm: null, globalMode: false, verifiedOnly: false, terms: {} } },
      'GET /catalog/taxonomy': { body: [] },
      'PUT /preferences': apiError(402, 'ENTITLEMENT_REQUIRED', { entitlement: 'advanced_filters' }),
    });
    const onSaved = jest.fn();
    renderWithProviders(<PreferencesEditor submitLabel="Save" onSaved={onSaved} />);
    fireEvent(await screen.findByTestId('pref-verified-only'), 'valueChange', true);
    fireEvent.press(screen.getByTestId('preferences-save'));
    expect(await screen.findByTestId('upsell')).toBeTruthy();
    fireEvent.press(screen.getByTestId('upsell-open'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/premium', params: { surface: 'preferences', entitlement: 'advanced_filters' } });
    expect(screen.getByTestId('pref-verified-only').props.value).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(api.callsTo('PUT /preferences')[0]!.body).toMatchObject({ ageMin: 25, ageMax: 40, verifiedOnly: true });
  });
});
