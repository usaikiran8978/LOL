import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Router from 'expo-router';
import { card, uuid } from '../../test/builders';
import { user } from '../../test/fixtures';
import { mockApi } from '../../test/mockApi';
import { renderWithProviders, seedSession } from '../../test/render';
import LikedScreen from '../discovery/LikedScreen';
import UserProfileScreen from '../discovery/UserProfileScreen';

const router = (Router as unknown as { __router: { push: jest.Mock } }).__router;
const params = (Router as unknown as { __params: Record<string, string> }).__params;
const base = () => ({ 'GET /users/me': { body: user({ onboardingCompleted: true }) }, 'GET /users/me/consents': { body: [] } });
const blake = card({ userId: uuid(402), displayName: 'Blake', candidateRowId: uuid(302) });
const sent = {
  items: [
    { likeId: uuid(901), superLike: false, likedAt: '2026-10-09T10:00:00Z', matched: true, matchId: uuid(701), conversationId: uuid(801), favorited: false, profile: card() },
    { likeId: uuid(902), superLike: true, likedAt: '2026-10-08T10:00:00Z', matched: false, matchId: null, conversationId: null, favorited: true, profile: blake },
  ],
  nextCursor: null,
};

beforeEach(async () => {
  await seedSession();
  router.push.mockClear();
  for (const k of Object.keys(params)) delete params[k];
});

describe('LikedScreen', () => {
  it('lists liked profiles with match / super-like state and opens chat for a match', async () => {
    mockApi({ ...base(), 'GET /likes/sent': { body: sent }, 'GET /favorites': { body: { items: [], nextCursor: null } } });
    renderWithProviders(<LikedScreen />);
    expect(await screen.findByTestId(`liked-tile-${card().userId}`)).toBeTruthy();
    expect(screen.getByText('Matched')).toBeTruthy();
    expect(screen.getByText('Super like')).toBeTruthy();
    fireEvent.press(screen.getByTestId(`liked-msg-${card().userId}`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/chats/[id]', params: { id: uuid(801) } });
  });

  it('favourites a liked profile and shows it on the Favourites tab', async () => {
    const api = mockApi({ ...base(), 'GET /likes/sent': { body: sent }, 'GET /favorites': { body: { items: [], nextCursor: null } }, [`PUT /favorites/${card().userId}`]: { status: 204 } });
    renderWithProviders(<LikedScreen />);
    fireEvent.press(await screen.findByTestId(`liked-fav-${card().userId}`));
    await waitFor(() => expect(api.callsTo(`PUT /favorites/${card().userId}`)).toHaveLength(1));
    fireEvent.press(screen.getByTestId('liked-tab-favorites'));
    expect(await screen.findByTestId(`liked-tile-${card().userId}`)).toBeTruthy();
  });

  it('opens on the Favourites tab and explains the empty state', async () => {
    Object.assign(params, { tab: 'favorites' });
    mockApi({ ...base(), 'GET /likes/sent': { body: sent }, 'GET /favorites': { body: { items: [], nextCursor: null } } });
    renderWithProviders(<LikedScreen />);
    expect(await screen.findByTestId('liked-empty-favorites')).toBeTruthy();
  });
});

describe('UserProfileScreen favourites', () => {
  it('toggles the star on and off', async () => {
    Object.assign(params, { id: uuid(401) });
    const profile = { id: uuid(401), displayName: 'Alex', age: 31, bio: 'Hi', city: 'London', distance: null, gender: null, orientation: null, datingIntent: null, relationshipGoal: null, relationshipStatus: null, educationLevel: null, profession: null, employer: null, school: null, heightCm: null, verified: true, recentlyActive: null, attributes: {}, interests: [], prompts: [], media: [], matched: false, favorited: false };
    const api = mockApi({ ...base(), [`GET /profiles/${uuid(401)}`]: { body: profile }, [`PUT /favorites/${uuid(401)}`]: { status: 204 }, [`DELETE /favorites/${uuid(401)}`]: { status: 204 } });
    renderWithProviders(<UserProfileScreen />);
    fireEvent.press(await screen.findByTestId('profile-favorite'));
    await waitFor(() => expect(api.callsTo(`PUT /favorites/${uuid(401)}`)).toHaveLength(1));
    expect(screen.getByLabelText('Remove Alex from favourites')).toBeTruthy();
    fireEvent.press(screen.getByTestId('profile-favorite'));
    await waitFor(() => expect(api.callsTo(`DELETE /favorites/${uuid(401)}`)).toHaveLength(1));
  });
});
