import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Router from 'expo-router';
import { card, matchItem, uuid } from '../../test/builders';
import { profile, user } from '../../test/fixtures';
import { mockApi } from '../../test/mockApi';
import { flushAsync, renderWithProviders, seedSession, testConfig } from '../../test/render';
import { completeProfileHref } from '../../features/profile/completeProfile';
import HomeScreen from '../home/HomeScreen';
import MenuScreen from '../home/MenuScreen';
import ProfileScreen from '../profile/ProfileScreen';
import DatesHubScreen from '../dates/DatesHubScreen';
import MatchmakerScreen from '../matchmaker/MatchmakerScreen';

const router = (Router as unknown as { __router: { push: jest.Mock } }).__router;
const base = (over = {}) => ({ 'GET /users/me': { body: user({ onboardingCompleted: true, ...over }) }, 'GET /users/me/consents': { body: [] }, 'GET /profiles/me': { body: profile() } });
const liked = { status: 201, body: { action: 'like', matched: false, matchId: null, conversationId: null } };

beforeEach(async () => {
  await seedSession();
  router.push.mockClear();
});

describe('HomeScreen', () => {
  it('opens the menu from the top-left avatar and chats from the top-right icon', async () => {
    mockApi({ ...base(), 'GET /recommendations': { body: { items: [], limitReached: false, resetsAt: null } } });
    renderWithProviders(<HomeScreen />);
    fireEvent.press(await screen.findByTestId('home-menu'));
    fireEvent.press(screen.getByTestId('home-chats'));
    expect(router.push.mock.calls.map((c) => c[0])).toEqual(['/menu', '/chats']);
  });

  it('shows a swipe deck; pass, super like and like send the action and advance to the next card', async () => {
    const second = card({ userId: uuid(402), displayName: 'Blake', candidateRowId: uuid(302) });
    const third = card({ userId: uuid(403), displayName: 'Casey', candidateRowId: uuid(303) });
    const api = mockApi({ ...base(), 'GET /recommendations': { body: { items: [card(), second, third], limitReached: false, resetsAt: null } }, 'POST /likes': liked });
    renderWithProviders(<HomeScreen />);
    await screen.findByTestId('home-deck-card');
    fireEvent.press(screen.getByTestId('home-deck-like'));
    await waitFor(() => expect(api.callsTo('POST /likes')).toHaveLength(1));
    expect(api.callsTo('POST /likes')[0]!.body).toEqual({ targetId: card().userId, action: 'like', surface: 'swipe', candidateRowId: card().candidateRowId });
    await screen.findByTestId(`card-${second.userId}`);
    fireEvent.press(screen.getByTestId('home-deck-super'));
    await waitFor(() => expect(api.callsTo('POST /likes')).toHaveLength(2));
    expect(api.callsTo('POST /likes')[1]!.body).toMatchObject({ targetId: second.userId, action: 'super_like' });
    fireEvent.press(await screen.findByTestId('home-deck-pass'));
    await waitFor(() => expect(api.callsTo('POST /likes')).toHaveLength(3));
    expect(api.callsTo('POST /likes')[2]!.body).toMatchObject({ targetId: third.userId, action: 'pass' });
    expect(await screen.findByTestId('home-deck-empty')).toBeTruthy();
  });

  it('opens the full profile from the card so the member can decide there', async () => {
    mockApi({ ...base(), 'GET /recommendations': { body: { items: [card()], limitReached: false, resetsAt: null } } });
    renderWithProviders(<HomeScreen />);
    fireEvent.press(await screen.findByTestId('deck-card-open'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/users/[id]', params: { id: card().userId, surface: 'swipe' } });
  });

  it('shows the match celebration when a like matches', async () => {
    mockApi({ ...base(), 'GET /recommendations': { body: { items: [card()], limitReached: false, resetsAt: null } }, 'POST /likes': { status: 201, body: { action: 'like', matched: true, matchId: uuid(701), conversationId: uuid(801) } } });
    renderWithProviders(<HomeScreen />);
    fireEvent.press(await screen.findByTestId('home-deck-like'));
    fireEvent.press(await screen.findByTestId('match-message'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/chats/[id]', params: { id: uuid(801) } });
  });

  it('offers restore while the account is scheduled for deletion', async () => {
    mockApi(base({ status: 'deactivated' }));
    renderWithProviders(<HomeScreen />);
    fireEvent.press(await screen.findByTestId('home-restore'));
    expect(router.push).toHaveBeenCalledWith('/settings/data');
    expect(screen.queryByTestId('home-deck')).toBeNull();
  });
});

describe('MenuScreen', () => {
  it('links to every member feature and hides flag-gated ones when off', async () => {
    mockApi(base());
    const { unmount } = renderWithProviders(<MenuScreen />);
    await flushAsync();
    expect(screen.queryByTestId('menu-events')).toBeNull();
    for (const id of ['menu-profile', 'menu-discover', 'menu-matches', 'menu-chats', 'menu-premium', 'menu-safety', 'menu-settings']) fireEvent.press(screen.getByTestId(id));
    expect(router.push.mock.calls.map((c) => c[0])).toEqual(['/profile', '/discover', '/matches', '/chats', '/premium', '/safety', '/settings']);
    unmount();
    renderWithProviders(<MenuScreen />, { config: testConfig({ flags: { events: true, travel_mode: true, 'ai.profile_coach': true } }) });
    await flushAsync();
    expect(screen.getByTestId('menu-events')).toBeTruthy();
    expect(screen.getByTestId('menu-travel')).toBeTruthy();
    expect(screen.getByTestId('menu-coach')).toBeTruthy();
  });

  it('sends an unfinished member back into the original onboarding flow', async () => {
    mockApi(base({ onboardingCompleted: false }));
    renderWithProviders(<MenuScreen />);
    fireEvent.press(await screen.findByTestId('menu-complete-profile'));
    expect(router.push).toHaveBeenCalledWith('/onboarding');
  });
});

describe('Complete profile', () => {
  it('My profile shows the button below 100% and leads to the first missing section', async () => {
    mockApi(base());
    renderWithProviders(<ProfileScreen />);
    fireEvent.press(await screen.findByTestId('profile-complete'));
    expect(router.push).toHaveBeenCalledWith(completeProfileHref(profile() as never, true));
  });

  it('is hidden once the profile is complete', async () => {
    mockApi({ ...base(), 'GET /profiles/me': { body: profile({ completeness: 100 }) } });
    renderWithProviders(<ProfileScreen />);
    await screen.findByTestId('completeness');
    expect(screen.queryByTestId('profile-complete')).toBeNull();
  });

  it('routes onboarding first, then the first missing section', () => {
    const p = profile() as never;
    expect(completeProfileHref(p, false)).toBe('/onboarding');
    expect(completeProfileHref(p, true)).toBe('/profile/media');
  });
});

describe('MatchmakerScreen', () => {
  it('shows the estimate disclaimer, server reasons, and likes from the smart surface', async () => {
    const api = mockApi({ ...base(), 'GET /recommendations': { body: { items: [card()], limitReached: false, resetsAt: null } }, 'POST /likes': liked });
    renderWithProviders(<MatchmakerScreen />);
    expect(await screen.findByTestId('mm-disclaimer')).toBeTruthy();
    expect(await screen.findByText('• You share core values')).toBeTruthy();
    expect(api.callsTo('GET /recommendations')[0]!.query.get('surface')).toBe('smart');
    fireEvent.press(screen.getByTestId(`mm-like-${card().userId}`));
    await waitFor(() => expect(api.callsTo('POST /likes')[0]!.body).toMatchObject({ targetId: card().userId, action: 'like', surface: 'smart' }));
    expect(await screen.findByTestId('mm-empty')).toBeTruthy();
  });

  it('offers the paywall for the full breakdown when the server withholds it', async () => {
    mockApi({ ...base(), 'GET /recommendations': { body: { items: [card({ breakdown: null })], limitReached: false, resetsAt: null } } });
    renderWithProviders(<MatchmakerScreen />);
    fireEvent.press(await screen.findByTestId(`mm-unlock-${card().userId}`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/premium', params: { surface: 'compatibility_insights', entitlement: 'compatibility_insights' } });
  });
});

describe('DatesHubScreen', () => {
  it('plans a date with a match', async () => {
    const m = matchItem();
    mockApi({ ...base(), 'GET /matches': { body: { items: [m], nextCursor: null } }, 'GET /dates/ideas': { body: [] } });
    renderWithProviders(<DatesHubScreen />);
    fireEvent.press(await screen.findByTestId(`dates-plan-${m.matchId}`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/dates/match/[matchId]', params: { matchId: m.matchId, name: m.partner.displayName ?? '' } });
    fireEvent.press(screen.getByTestId('dates-safety'));
    expect(router.push).toHaveBeenCalledWith('/safety/date');
  });

  it('points to Discover when there are no matches yet', async () => {
    mockApi({ ...base(), 'GET /matches': { body: { items: [], nextCursor: null } }, 'GET /dates/ideas': { body: [] } });
    renderWithProviders(<DatesHubScreen />);
    expect(await screen.findByTestId('dates-no-matches')).toBeTruthy();
  });
});
