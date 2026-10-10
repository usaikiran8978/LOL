import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Router from 'expo-router';
import { Alert } from 'react-native';
import { analytics } from '../../analytics';
import { card, matchItem, uuid } from '../../test/builders';
import { user } from '../../test/fixtures';
import { apiError, mockApi } from '../../test/mockApi';
import { flushAsync, renderWithProviders, seedSession } from '../../test/render';
import DiscoverScreen from '../discovery/DiscoverScreen';
import LikesReceivedScreen from '../discovery/LikesReceivedScreen';
import MatchesScreen from '../discovery/MatchesScreen';
import SearchScreen from '../discovery/SearchScreen';
import UserProfileScreen from '../discovery/UserProfileScreen';

const router = (Router as unknown as { __router: { push: jest.Mock; replace: jest.Mock; back: jest.Mock } }).__router;
const params = (Router as unknown as { __params: Record<string, string> }).__params;
const base = (over = {}) => ({ 'GET /users/me': { body: user({ onboardingCompleted: true, ...over }) }, 'GET /users/me/consents': { body: [] } });
const feed = (items = [card(), card({ userId: uuid(402), displayName: 'Blake', candidateRowId: uuid(302) })]) => ({ body: { items, limitReached: false, resetsAt: null } });

beforeEach(async () => {
  await seedSession();
  router.push.mockClear();
  router.replace.mockClear();
  for (const k of Object.keys(params)) delete params[k];
});

describe('DiscoverScreen', () => {
  it('shows the card with compatibility explanation, and likes with the right body', async () => {
    const track = jest.spyOn(analytics, 'track');
    const api = mockApi({ ...base(), 'GET /recommendations': feed(), 'POST /likes': { status: 201, body: { action: 'like', matched: false, matchId: null, conversationId: null } } });
    renderWithProviders(<DiscoverScreen />);
    expect(await screen.findByText('Alex, 31')).toBeTruthy();
    expect(screen.getByText('87% compatible')).toBeTruthy();
    expect(screen.getByText('• You share core values')).toBeTruthy();
    expect(screen.getByText('• Your lifestyles differ')).toBeTruthy();
    expect(screen.getByText('2–5 km away', { exact: false })).toBeTruthy();
    expect(api.callsTo('GET /recommendations')[0]!.query.get('surface')).toBe('swipe');
    fireEvent.press(screen.getByTestId('action-like'));
    expect(await screen.findByText('Blake, 31')).toBeTruthy();
    expect(api.callsTo('POST /likes')[0]!.body).toEqual({ targetId: card().userId, action: 'like', surface: 'swipe', candidateRowId: card().candidateRowId });
    expect(track).toHaveBeenCalledWith('like_sent', { surface: 'swipe' });
  });

  it('celebrates a match with a link to the conversation', async () => {
    mockApi({ ...base(), 'GET /recommendations': feed(), 'POST /likes': { status: 201, body: { action: 'super_like', matched: true, matchId: uuid(701), conversationId: uuid(801) } } });
    renderWithProviders(<DiscoverScreen />);
    fireEvent.press(await screen.findByTestId('action-super'));
    expect(await screen.findByText("It's a match with Alex!")).toBeTruthy();
    fireEvent.press(screen.getByTestId('match-message'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/chats/[id]', params: { id: uuid(801) } });
  });

  it('routes daily-limit errors to the paywall and keeps the card', async () => {
    mockApi({ ...base(), 'GET /recommendations': feed(), 'POST /likes': apiError(429, 'LIMIT_REACHED', { key: 'likes', resetsAt: '2026-10-09T00:00:00Z' }) });
    renderWithProviders(<DiscoverScreen />);
    fireEvent.press(await screen.findByTestId('action-like'));
    expect(await screen.findByTestId('limit-reached')).toBeTruthy();
    expect(screen.getByText('Alex, 31')).toBeTruthy();
    fireEvent.press(screen.getByTestId('limit-upgrade'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/premium', params: { surface: 'discovery', entitlement: 'likes' } });
  });

  it('sends people with an incomplete profile to finish it', async () => {
    mockApi({ ...base({ onboardingCompleted: false }), 'GET /recommendations': apiError(409, 'PROFILE_INCOMPLETE') });
    renderWithProviders(<DiscoverScreen />);
    expect(await screen.findByText('Finish your profile to start discovering')).toBeTruthy();
    await flushAsync();
    fireEvent.press(screen.getByText('Finish my profile'));
    expect(router.push).toHaveBeenCalledWith('/onboarding');
  });

  it('rewinds when entitled, shows the smart-match limit and an empty deck', async () => {
    const api = mockApi({ ...base(), 'GET /recommendations': feed([card()]), 'POST /likes/rewind': { body: { rewoundTargetId: uuid(9), action: 'pass' } }, 'POST /likes': { status: 201, body: { action: 'pass', matched: false, matchId: null, conversationId: null } } });
    renderWithProviders(<DiscoverScreen />);
    fireEvent.press(await screen.findByTestId('action-pass'));
    expect(await screen.findByTestId('deck-empty')).toBeTruthy();
    fireEvent.press(screen.getByTestId('deck-refresh'));
    await waitFor(() => expect(api.callsTo('GET /recommendations')).toHaveLength(2));
    fireEvent.press(await screen.findByTestId('action-rewind'));
    await waitFor(() => expect(api.callsTo('POST /likes/rewind')).toHaveLength(1));

    api.set('GET /recommendations', { body: { items: [], limitReached: true, resetsAt: '2026-10-09T00:00:00Z' } });
    fireEvent.press(screen.getByTestId('surface-smart'));
    expect(await screen.findByTestId('feed-limit')).toBeTruthy();
    expect(api.calls.at(-1)!.query.get('surface')).toBe('smart');
  });

  it('shows an error state with retry', async () => {
    const api = mockApi({ ...base(), 'GET /recommendations': apiError(500, 'INTERNAL') });
    renderWithProviders(<DiscoverScreen />);
    expect(await screen.findByTestId('screen-error')).toBeTruthy();
    api.set('GET /recommendations', feed());
    fireEvent.press(screen.getByTestId('screen-retry'));
    expect(await screen.findByText('Alex, 31')).toBeTruthy();
  });
});

describe('SearchScreen', () => {
  it('searches with basic filters and offers the paywall for premium filters', async () => {
    const api = mockApi({ ...base(), 'GET /search/users': (req) => (req.query.get('verifiedOnly') ? apiError(402, 'ENTITLEMENT_REQUIRED', { entitlement: 'advanced_filters' }) : { body: { items: [card({ candidateRowId: null })], nextCursor: null } }) });
    renderWithProviders(<SearchScreen />);
    fireEvent.changeText(screen.getByTestId('search-age-min'), '25');
    fireEvent.changeText(screen.getByTestId('search-distance'), '10');
    fireEvent.press(screen.getByTestId('search-apply'));
    expect(await screen.findByText('Alex, 31')).toBeTruthy();
    const q = api.callsTo('GET /search/users')[0]!.query;
    expect(q.get('ageMin')).toBe('25');
    expect(q.get('maxDistanceKm')).toBe('10');
    expect(q.get('verifiedOnly')).toBeNull();

    fireEvent(screen.getByTestId('search-verified'), 'valueChange', true);
    fireEvent.press(screen.getByTestId('search-apply'));
    expect(await screen.findByTestId('search-upsell')).toBeTruthy();
  });
});

describe('LikesReceivedScreen', () => {
  it('shows only the count and an unlock button without the entitlement', async () => {
    mockApi({ ...base(), 'GET /likes/received': { body: { total: 4, locked: true, items: [], nextCursor: null } } });
    renderWithProviders(<LikesReceivedScreen />);
    expect(await screen.findByText('4 people like you')).toBeTruthy();
    fireEvent.press(screen.getByTestId('likes-unlock'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/premium', params: { surface: 'likes_received', entitlement: 'see_who_liked' } });
  });

  it('lists likes and likes back into a match', async () => {
    const api = mockApi({
      ...base(),
      'GET /likes/received': { body: { total: 1, locked: false, nextCursor: null, items: [{ likeId: 'l1', superLike: true, comment: 'Nice hike!', likedAt: '2026-10-07T00:00:00Z', profile: card({ compatibility: null, confidence: null, topFactors: [], differences: null }) }] } },
      'POST /likes': { status: 201, body: { action: 'like', matched: true, matchId: uuid(701), conversationId: uuid(801) } },
    });
    renderWithProviders(<LikesReceivedScreen />);
    expect(await screen.findByText('“Nice hike!”')).toBeTruthy();
    fireEvent.press(screen.getByTestId('like-back-l1'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/chats/[id]', params: { id: uuid(801) } }));
    expect(api.callsTo('POST /likes')[0]!.body).toMatchObject({ targetId: card().userId, action: 'like' });
  });
});

describe('MatchesScreen', () => {
  it('lists matches and opens the conversation; shows empty state', async () => {
    const api = mockApi({ ...base(), 'GET /matches': { body: { items: [matchItem()], nextCursor: null } } });
    const { unmount } = renderWithProviders(<MatchesScreen />);
    fireEvent.press(await screen.findByTestId(`match-${uuid(701)}`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/chats/[id]', params: { id: uuid(801) } });
    unmount();
    api.set('GET /matches', { body: { items: [], nextCursor: null } });
    renderWithProviders(<MatchesScreen />);
    expect(await screen.findByTestId('screen-empty')).toBeTruthy();
  });
});

describe('UserProfileScreen', () => {
  const profileBody = { id: uuid(401), displayName: 'Alex', age: 31, bio: 'Hi', city: 'London', distance: null, gender: null, orientation: null, datingIntent: null, relationshipGoal: null, relationshipStatus: null, educationLevel: null, profession: null, employer: null, school: null, heightCm: null, verified: true, recentlyActive: null, attributes: {}, interests: [], prompts: [], media: [], matched: true };

  it('likes from the full profile when not matched yet, then returns to the deck', async () => {
    Object.assign(params, { id: uuid(401), surface: 'swipe' });
    router.back.mockClear();
    const api = mockApi({ ...base(), [`GET /profiles/${uuid(401)}`]: { body: { ...profileBody, matched: false } }, 'POST /likes': { status: 201, body: { action: 'like', matched: false, matchId: null, conversationId: null } } });
    renderWithProviders(<UserProfileScreen />);
    fireEvent.press(await screen.findByTestId('profile-like'));
    await waitFor(() => expect(api.callsTo('POST /likes')[0]!.body).toEqual({ targetId: uuid(401), action: 'like', surface: 'swipe' }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('hides like / pass for someone already matched', async () => {
    Object.assign(params, { id: uuid(401), matchId: uuid(701) });
    mockApi({ ...base(), [`GET /profiles/${uuid(401)}`]: { body: profileBody } });
    renderWithProviders(<UserProfileScreen />);
    await screen.findByTestId('profile-report');
    expect(screen.queryByTestId('profile-like')).toBeNull();
  });

  it('unmatches after confirmation and reaches report/safety', async () => {
    Object.assign(params, { id: uuid(401), matchId: uuid(701), conversationId: uuid(801) });
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    const track = jest.spyOn(analytics, 'track');
    const api = mockApi({ ...base(), [`GET /profiles/${uuid(401)}`]: { body: profileBody }, [`POST /matches/${uuid(701)}/unmatch`]: { status: 204 } });
    renderWithProviders(<UserProfileScreen />);
    fireEvent.press(await screen.findByTestId('profile-report'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/safety/report', params: { userId: uuid(401), name: 'Alex', targetType: 'user', targetId: uuid(401) } });
    fireEvent.press(screen.getByTestId('profile-unmatch'));
    await flushAsync();
    expect(api.callsTo(`POST /matches/${uuid(701)}/unmatch`)).toHaveLength(1);
    expect(router.replace).toHaveBeenCalledWith('/matches');
    expect(track).toHaveBeenCalledWith('unmatched', {});
  });

  it('blocks a user', async () => {
    Object.assign(params, { id: uuid(401) });
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    const api = mockApi({ ...base(), [`GET /profiles/${uuid(401)}`]: { body: profileBody }, 'POST /blocks': { status: 204 } });
    renderWithProviders(<UserProfileScreen />);
    fireEvent.press(await screen.findByTestId('profile-block'));
    await flushAsync();
    expect(api.callsTo('POST /blocks')[0]!.body).toEqual({ userId: uuid(401) });
    expect(router.back).toHaveBeenCalled();
  });
});
