import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Router from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { analytics } from '../../analytics';
import { uuid } from '../../test/builders';
import { user } from '../../test/fixtures';
import { apiError, mockApi } from '../../test/mockApi';
import { flushAsync, renderWithProviders, seedSession, testConfig } from '../../test/render';
import InsightsScreen from '../ai/InsightsScreen';
import ProfileCoachScreen from '../ai/ProfileCoachScreen';
import DatePlannerScreen, { toStartsAt } from '../dates/DatePlannerScreen';
import type { RosterEntry } from '../../api/experiences';
import EventCheckInScreen from '../events/EventCheckInScreen';
import EventDetailScreen from '../events/EventDetailScreen';
import EventsScreen from '../events/EventsScreen';
import TravelScreen from '../travel/TravelScreen';

jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn(), openAuthSessionAsync: jest.fn(async () => ({ type: 'dismiss' })) }));
const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;

const router = (Router as unknown as { __router: { push: jest.Mock } }).__router;
const params = (Router as unknown as { __params: Record<string, string> }).__params;
const base = () => ({ 'GET /users/me': { body: user({ onboardingCompleted: true }) }, 'GET /users/me/consents': { body: [] } });
const flags = (f: Record<string, boolean>) => testConfig({ flags: f });
const EID = uuid(61);
const listItem = (over = {}) => ({ id: EID, title: 'Board games night', category: { key: 'games', label: 'Games' }, city: 'London', countryCode: 'GB', startsAt: '2030-10-10T18:00:00Z', endsAt: '2030-10-10T21:00:00Z', timezone: 'Europe/London', isOnline: false, capacity: 20, attending: 5, spotsLeft: 15, price: null, preEventMatching: true, status: 'published', myStatus: null, fit: 70, sharedInterestCount: 1, ...over });
const detail = (over = {}) => ({ ...listItem(), category: 'games', description: 'Bring a friend.', chatEnabled: true, venue: { name: 'The Pub', address: null }, isOrganizer: false, myCheckInCode: null, conversationId: null, moderationNote: null, ...over });

beforeEach(async () => {
  await seedSession();
  router.push.mockClear();
  for (const k of Object.keys(params)) delete params[k];
});

describe('ProfileCoachScreen', () => {
  it('requests tips for a focus and shows suggestions', async () => {
    const api = mockApi({ ...base(), 'POST /ai/profile-coach': { body: { score: 72, suggestions: [{ area: 'bio', tip: 'Mention your hobbies.' }], bioSuggestion: 'Climber, coffee nerd.' } } });
    renderWithProviders(<ProfileCoachScreen />, { config: flags({ 'ai.profile_coach': true }) });
    fireEvent.press(screen.getByTestId('coach-focus-bio'));
    fireEvent.press(screen.getByTestId('coach-run'));
    expect(await screen.findByText('Mention your hobbies.')).toBeTruthy();
    expect(screen.getByText('Profile score: 72 / 100')).toBeTruthy();
    expect(api.callsTo('POST /ai/profile-coach')[0]!.body).toEqual({ focus: 'bio' });
  });

  it('handles AI_UNAVAILABLE gracefully and is hidden behind its flag', async () => {
    mockApi({ ...base(), 'POST /ai/profile-coach': apiError(503, 'AI_UNAVAILABLE') });
    const { unmount } = renderWithProviders(<ProfileCoachScreen />, { config: flags({ 'ai.profile_coach': true }) });
    fireEvent.press(screen.getByTestId('coach-run'));
    expect(await screen.findByText('AI is temporarily unavailable')).toBeTruthy();
    unmount();
    renderWithProviders(<ProfileCoachScreen />);
    expect(screen.getByTestId('screen-empty')).toBeTruthy();
    await flushAsync();
  });
});

describe('InsightsScreen', () => {
  it('offers the paywall when the premium AI entitlement is missing', async () => {
    mockApi({ ...base(), 'POST /ai/relationship-insights': apiError(402, 'ENTITLEMENT_REQUIRED', { entitlement: 'ai_coach_advanced' }) });
    renderWithProviders(<InsightsScreen />, { config: flags({ 'ai.profile_coach': true }) });
    fireEvent.press(screen.getByTestId('insights-run'));
    expect(await screen.findByTestId('ai-status-limit')).toBeTruthy();
  });

  it('shows insights', async () => {
    const track = jest.spyOn(analytics, 'track');
    mockApi({ ...base(), 'POST /ai/relationship-insights': { body: { insights: [{ title: 'You open with questions', detail: 'Keep it up.' }, { title: 'Weekends', detail: 'Most of your dates are on Saturdays.' }] } } });
    renderWithProviders(<InsightsScreen />, { config: flags({ 'ai.profile_coach': true }) });
    fireEvent.press(screen.getByTestId('insights-run'));
    expect(await screen.findByText('You open with questions')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('ai_feature_used', { feature: 'relationship_insights' });
  });
});

describe('Events', () => {
  it('lists events, switches to "mine" and opens one', async () => {
    const api = mockApi({ ...base(), 'GET /events': { body: { items: [listItem()], nextCursor: null } } });
    renderWithProviders(<EventsScreen />, { config: flags({ events: true }) });
    fireEvent.press(await screen.findByTestId(`event-${EID}`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/events/[id]', params: { id: EID } });
    fireEvent.press(screen.getByTestId('events-tab-mine'));
    await waitFor(() => expect(api.callsTo('GET /events').at(-1)!.query.get('mine')).toBe('true'));
  });

  it('registers, then shows the check-in code and lets the user cancel', async () => {
    params.id = EID;
    let state: Record<string, unknown> = {};
    const api = mockApi({
      ...base(),
      [`GET /events/${EID}`]: () => ({ body: detail(state) }),
      [`POST /events/${EID}/registration`]: () => {
        state = { myStatus: 'registered', myCheckInCode: 'AB12CD' };
        return { status: 201, body: { status: 'registered', checkInCode: 'AB12CD' } };
      },
      [`DELETE /events/${EID}/registration`]: () => {
        state = { myStatus: 'cancelled' };
        return { status: 204 };
      },
    });
    renderWithProviders(<EventDetailScreen />, { config: flags({ events: true }) });
    fireEvent(await screen.findByTestId('event-open-to-meet'), 'valueChange', false);
    fireEvent.press(screen.getByTestId('event-register'));
    expect(await screen.findByText('AB12CD')).toBeTruthy();
    expect(api.callsTo(`POST /events/${EID}/registration`)[0]!.body).toEqual({ openToMeet: false });
    fireEvent.press(screen.getByTestId('event-leave'));
    await waitFor(() => expect(screen.getByTestId('event-my-status').props.accessibilityLabel).toBe('Cancelled'));
    expect(screen.queryByTestId('event-checkin-code')).toBeNull();
    expect(api.callsTo(`DELETE /events/${EID}/registration`)).toHaveLength(1);
  });

  it('shows EVENT_NOT_OPEN errors', async () => {
    params.id = EID;
    mockApi({ ...base(), [`GET /events/${EID}`]: { body: detail() }, [`POST /events/${EID}/registration`]: apiError(409, 'EVENT_NOT_OPEN') });
    renderWithProviders(<EventDetailScreen />, { config: flags({ events: true }) });
    fireEvent.press(await screen.findByTestId('event-register'));
    expect(await screen.findByText("Registration for this event isn't open.")).toBeTruthy();
  });

  it('buys a paid ticket through hosted checkout with amora:// return links and re-reads the seat from the server', async () => {
    params.id = EID;
    const price = { amountMinor: 1500, currency: 'GBP' };
    let state: Record<string, unknown> = { price };
    openAuthSession.mockImplementationOnce(async () => {
      // The payment webhook confirms the seat server-side while the browser is open.
      state = { price, myStatus: 'registered', myCheckInCode: 'PAID01' };
      return { type: 'success', url: `amora://events/${EID}?checkout=success` };
    });
    const api = mockApi({
      ...base(),
      [`GET /events/${EID}`]: () => ({ body: detail(state) }),
      [`POST /events/${EID}/registration`]: () => {
        state = { price, myStatus: 'interested' };
        return { status: 201, body: { status: 'payment_required', checkoutUrl: 'https://checkout.stripe.test/c/1' } };
      },
    });
    renderWithProviders(<EventDetailScreen />, { config: flags({ events: true }) });
    fireEvent.press(await screen.findByTestId('event-register'));
    expect(await screen.findByTestId('event-checkout-confirmed')).toBeTruthy();
    expect(screen.getByText('PAID01')).toBeTruthy();
    expect(api.callsTo(`POST /events/${EID}/registration`)[0]!.body).toEqual({ openToMeet: true, successUrl: `amora://events/${EID}?checkout=success`, cancelUrl: `amora://events/${EID}?checkout=cancel` });
    expect(openAuthSession).toHaveBeenCalledWith('https://checkout.stripe.test/c/1', `amora://events/${EID}`);
    expect(api.callsTo(`GET /events/${EID}`).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a paid seat pending until the server confirms it; cancelled checkout says nothing was charged', async () => {
    params.id = EID;
    const price = { amountMinor: 1500, currency: 'GBP' };
    let state: Record<string, unknown> = { price };
    openAuthSession.mockResolvedValueOnce({ type: 'success', url: `amora://events/${EID}?checkout=success` });
    const api = mockApi({
      ...base(),
      [`GET /events/${EID}`]: () => ({ body: detail(state) }),
      [`POST /events/${EID}/registration`]: () => {
        state = { price, myStatus: 'interested' };
        return { status: 201, body: { status: 'payment_required', checkoutUrl: 'https://checkout.stripe.test/c/2' } };
      },
    });
    const { unmount } = renderWithProviders(<EventDetailScreen />, { config: flags({ events: true }) });
    fireEvent.press(await screen.findByTestId('event-register'));
    expect(await screen.findByText('Payment received — confirming your place')).toBeTruthy();
    expect(screen.queryByTestId('event-checkin-code')).toBeNull();
    state = { price, myStatus: 'registered', myCheckInCode: 'PAID02' };
    fireEvent.press(screen.getByTestId('event-payment-refresh'));
    expect(await screen.findByText('PAID02')).toBeTruthy();
    unmount();

    // Returning through the cancel deep link.
    state = { price, myStatus: 'interested' };
    params.checkout = 'cancel';
    renderWithProviders(<EventDetailScreen />, { config: flags({ events: true }) });
    expect(await screen.findByTestId('event-checkout-cancelled')).toBeTruthy();
    expect(screen.getByText('Continue to payment · £15.00')).toBeTruthy();
    expect(api.callsTo(`POST /events/${EID}/registration`)).toHaveLength(1);
  });

  it('shows the check-in entry point to the organizer only', async () => {
    params.id = EID;
    mockApi({ ...base(), [`GET /events/${EID}`]: { body: detail({ isOrganizer: true }) } });
    renderWithProviders(<EventDetailScreen />, { config: flags({ events: true }) });
    fireEvent.press(await screen.findByTestId('event-organizer-checkin'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/events/check-in', params: { id: EID, title: 'Board games night' } });
    expect(screen.queryByTestId('event-register')).toBeNull();
  });
});

describe('EventCheckInScreen', () => {
  const A = uuid(65);
  const B = uuid(66);
  const C = uuid(67);
  const entry = (userId: string, over: Partial<RosterEntry> = {}): RosterEntry => ({ userId, displayName: 'Guest', verificationLevel: 'none', status: 'registered', checkedInAt: null, registeredAt: '2026-10-01T10:00:00.000Z', ...over });
  beforeEach(() => {
    Object.assign(params, { id: EID, title: 'Board games night' });
  });

  it('checks in by code alone and shows who was checked in', async () => {
    let roster = [entry(A, { displayName: 'Ana', verificationLevel: 'selfie' }), entry(B, { displayName: 'Ben' }), entry(C, { displayName: 'Cy', status: 'waitlisted' })];
    const api = mockApi({
      ...base(),
      [`GET /events/${EID}/attendees`]: () => ({ body: roster }),
      [`POST /events/${EID}/check-in`]: (req) => {
        if (req.body.code !== 'AB12CD') return apiError(400, 'VALIDATION_FAILED');
        roster = roster.map((r) => (r.userId === A ? { ...r, status: 'checked_in' as const, checkedInAt: '2026-10-09T18:05:00.000Z' } : r));
        return { status: 204 };
      },
    });
    renderWithProviders(<EventCheckInScreen />);
    expect(await screen.findByText('0 of 2 checked in')).toBeTruthy();
    expect(screen.getByTestId(`roster-status-${C}`).props.accessibilityLabel).toBe('Waitlisted');
    expect(screen.getByTestId('checkin-submit').props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('checkin-code'), 'zz-9999');
    fireEvent.press(screen.getByTestId('checkin-submit'));
    expect(await screen.findByText("That code isn't valid for this event.")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('checkin-code'), 'ab12cd');
    fireEvent.press(screen.getByTestId('checkin-submit'));
    expect(await screen.findByText('Ana is checked in.')).toBeTruthy();
    expect(screen.getByText('1 of 2 checked in')).toBeTruthy();
    expect(screen.getByTestId(`roster-status-${A}`).props.accessibilityLabel).toBe('Checked in');
    expect(api.callsTo(`POST /events/${EID}/check-in`).map((c) => c.body)).toEqual([{ code: 'ZZ9999' }, { code: 'AB12CD' }]);
    // Same code again: the API says the attendee is already in (409), shown as its own message.
    api.set(`POST /events/${EID}/check-in`, apiError(409, 'CONFLICT', { alreadyCheckedIn: true }));
    const rosterCalls = api.callsTo(`GET /events/${EID}/attendees`).length;
    fireEvent.changeText(screen.getByTestId('checkin-code'), 'AB12CD');
    fireEvent.press(screen.getByTestId('checkin-submit'));
    expect(await screen.findByText('This attendee is already checked in.')).toBeTruthy();
    expect(screen.queryByText("That code isn't valid for this event.")).toBeNull();
    await waitFor(() => expect(api.callsTo(`GET /events/${EID}/attendees`).length).toBeGreaterThan(rosterCalls));
  });

  it('asks the organizer to pick the attendee when a code is ambiguous, then sends userId + code', async () => {
    let roster = [entry(A, { displayName: 'Ana' }), entry(B, { displayName: 'Ben' })];
    const api = mockApi({
      ...base(),
      [`GET /events/${EID}/attendees`]: () => ({ body: roster }),
      [`POST /events/${EID}/check-in`]: (req) => {
        if (!req.body.userId) return apiError(400, 'VALIDATION_FAILED', { ambiguous: true });
        roster = roster.map((r) => (r.userId === req.body.userId ? { ...r, status: 'checked_in' as const, checkedInAt: '2026-10-09T18:05:00.000Z' } : r));
        return { status: 204 };
      },
    });
    renderWithProviders(<EventCheckInScreen />);
    fireEvent.changeText(await screen.findByTestId('checkin-code'), 'QQ11QQ');
    fireEvent.press(screen.getByTestId('checkin-submit'));
    expect(await screen.findByTestId('checkin-ambiguous')).toBeTruthy();
    fireEvent.press(screen.getByTestId(`checkin-pick-${B}`));
    expect(await screen.findByText('Ben is checked in.')).toBeTruthy();
    expect(api.callsTo(`POST /events/${EID}/check-in`).map((c) => c.body)).toEqual([{ code: 'QQ11QQ' }, { userId: B, code: 'QQ11QQ' }]);
    expect(screen.queryByTestId('checkin-ambiguous')).toBeNull();
  });

  it('explains when check-in is not open yet; shows roster errors with retry and the empty state', async () => {
    const api = mockApi({ ...base(), [`GET /events/${EID}/attendees`]: apiError(500, 'INTERNAL'), [`POST /events/${EID}/check-in`]: apiError(409, 'EVENT_NOT_OPEN') });
    const { unmount } = renderWithProviders(<EventCheckInScreen />);
    expect(await screen.findByTestId('screen-error')).toBeTruthy();
    api.set(`GET /events/${EID}/attendees`, { body: [] });
    fireEvent.press(screen.getByTestId('screen-retry'));
    expect(await screen.findByTestId('roster-empty')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('checkin-code'), 'AB12CD');
    fireEvent.press(screen.getByTestId('checkin-submit'));
    expect(await screen.findByText('Check-in opens 2 hours before the start and closes when the event ends.')).toBeTruthy();
    unmount();
  });
});

describe('DatePlannerScreen', () => {
  const plan = (over = {}) => ({ id: uuid(71), matchId: uuid(701), status: 'proposed', proposedBy: uuid(401), title: 'Coffee', activityType: 'coffee', stage: null, budget: null, notes: null, venue: { name: 'Bean', address: null, provider: null, placeId: null, city: null, latitude: null, longitude: null }, startsAt: '2030-10-12T10:00:00Z', expectedDurationMin: 60, aiGenerated: false, myResponse: 'pending', reminders: [60], participants: [], ...over });

  it('proposes a date from an idea with the right body', async () => {
    Object.assign(params, { matchId: uuid(701), name: 'Alex' });
    const track = jest.spyOn(analytics, 'track');
    const api = mockApi({ ...base(), [`GET /dates/match/${uuid(701)}`]: { body: [] }, 'GET /dates/ideas': { body: [{ key: 'picnic', title: 'Picnic in the park', description: '', activityType: 'outdoors', budget: 'free', indoor: false, durationMin: 120, sharedInterestMatch: 1 }] }, 'POST /dates': (req) => ({ status: 201, body: plan({ ...req.body, id: uuid(72), proposedBy: user().id, status: 'proposed' }) }) });
    renderWithProviders(<DatePlannerScreen />);
    fireEvent.press(await screen.findByTestId('idea-picnic'));
    fireEvent.changeText(screen.getByTestId('date-day-day'), '12');
    fireEvent.changeText(screen.getByTestId('date-day-month'), '10');
    fireEvent.changeText(screen.getByTestId('date-day-year'), '2030');
    fireEvent.changeText(screen.getByTestId('date-time'), '18:30');
    fireEvent.press(screen.getByTestId('date-create'));
    await waitFor(() => expect(api.callsTo('POST /dates')).toHaveLength(1));
    expect(api.callsTo('POST /dates')[0]!.body).toEqual({ matchId: uuid(701), title: 'Picnic in the park', activityType: 'outdoors', startsAt: toStartsAt('2030-10-12', '18:30'), aiGenerated: false });
    expect(track).toHaveBeenCalledWith('date_planned', { aiGenerated: false });
  });

  it('accepts a proposed date and links to date safety', async () => {
    Object.assign(params, { matchId: uuid(701), name: 'Alex' });
    const api = mockApi({ ...base(), [`GET /dates/match/${uuid(701)}`]: { body: [plan()] }, 'GET /dates/ideas': { body: [] }, [`POST /dates/${uuid(71)}/response`]: { body: plan({ status: 'accepted', myResponse: 'accepted' }) } });
    renderWithProviders(<DatePlannerScreen />);
    fireEvent.press(await screen.findByTestId(`plan-accept-${uuid(71)}`));
    await waitFor(() => expect(api.callsTo(`POST /dates/${uuid(71)}/response`)[0]?.body).toEqual({ response: 'accepted' }));
    fireEvent.press(screen.getByTestId(`plan-safety-${uuid(71)}`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/safety/date', params: { datePlanId: uuid(71) } });
  });
});

describe('TravelScreen', () => {
  const trip = (over = {}) => ({ id: uuid(91), cityId: uuid(81), cityName: 'Paris', countryCode: 'FR', startsOn: '2030-11-01', endsOn: '2030-11-05', visibleToLocals: true, isActive: true, ...over });

  it('lists camelCase plans, adds the created plan from the POST response and cancels one', async () => {
    const api = mockApi({
      ...base(),
      'GET /travel-plans': { body: [trip()] },
      'GET /catalog/cities': { body: [{ id: uuid(82), countryCode: 'ES', name: 'Madrid', region: null, timezone: 'Europe/Madrid' }] },
      'POST /travel-plans': (req) => ({ status: 201, body: trip({ id: uuid(92), cityId: req.body.cityId, cityName: 'Madrid', countryCode: 'ES', startsOn: req.body.startsOn, endsOn: req.body.endsOn, visibleToLocals: req.body.visibleToLocals }) }),
      [`DELETE /travel-plans/${uuid(91)}`]: { status: 204 },
    });
    renderWithProviders(<TravelScreen />, { config: flags({ travel_mode: true }) });
    expect(await screen.findByText('Paris')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('travel-city'), 'Mad');
    fireEvent.press(await screen.findByTestId(`travel-city-${uuid(82)}`), {});
    for (const [id, v] of [['travel-from-day', '10'], ['travel-from-month', '12'], ['travel-from-year', '2030'], ['travel-to-day', '12'], ['travel-to-month', '12'], ['travel-to-year', '2030']] as const) fireEvent.changeText(screen.getByTestId(id), v);
    fireEvent.press(screen.getByTestId('travel-save'));
    expect(await screen.findByTestId(`trip-${uuid(92)}`)).toBeTruthy();
    expect(api.callsTo('GET /travel-plans')).toHaveLength(1);
    fireEvent.press(screen.getByTestId(`trip-cancel-${uuid(91)}`));
    await flushAsync(50);
    expect(screen.queryAllByTestId(/^trip-0/).map((n) => n.props.testID)).toEqual([`trip-${uuid(92)}`]);
    expect(api.callsTo(`DELETE /travel-plans/${uuid(91)}`)).toHaveLength(1);
  });

  it('adds a trip via city search and routes missing entitlement to the paywall', async () => {
    const api = mockApi({
      ...base(),
      'GET /travel-plans': { body: [] },
      'GET /catalog/cities': { body: [{ id: uuid(81), countryCode: 'FR', name: 'Paris', region: null, timezone: 'Europe/Paris' }] },
      'POST /travel-plans': apiError(402, 'ENTITLEMENT_REQUIRED', { entitlement: 'travel_mode' }),
    });
    renderWithProviders(<TravelScreen />, { config: flags({ travel_mode: true }) });
    expect(await screen.findByTestId('travel-empty')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('travel-city'), 'Par');
    fireEvent.press(await screen.findByTestId(`travel-city-${uuid(81)}`), {});
    for (const [id, v] of [['travel-from-day', '01'], ['travel-from-month', '11'], ['travel-from-year', '2030'], ['travel-to-day', '05'], ['travel-to-month', '11'], ['travel-to-year', '2030']] as const) fireEvent.changeText(screen.getByTestId(id), v);
    fireEvent.press(screen.getByTestId('travel-save'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/premium', params: { surface: 'travel', entitlement: 'travel_mode' } }));
    expect(api.callsTo('POST /travel-plans')[0]!.body).toEqual({ cityId: uuid(81), startsOn: '2030-11-01', endsOn: '2030-11-05', visibleToLocals: true });
  });
});
