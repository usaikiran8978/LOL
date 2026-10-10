import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'react-native';
import * as Router from 'expo-router';
import { analytics } from '../../analytics';
import { RealtimeProvider } from '../../realtime/RealtimeProvider';
import { conversation, message, uuid } from '../../test/builders';
import { user } from '../../test/fixtures';
import { apiError, mockApi } from '../../test/mockApi';
import { flushAsync, renderWithProviders, seedSession, testConfig } from '../../test/render';
import CallScreen from '../calls/CallScreen';
import ChatScreen from '../chat/ChatScreen';
import ChatsScreen from '../chat/ChatsScreen';
import { POLL_MS } from '../../features/chat/useChatThread';

const router = (Router as unknown as { __router: { push: jest.Mock; back: jest.Mock } }).__router;
const params = (Router as unknown as { __params: Record<string, string> }).__params;
const ME = user().id;
const CID = uuid(801);
const base = () => ({ 'GET /users/me': { body: user({ onboardingCompleted: true }) }, 'GET /users/me/consents': { body: [] } });
const convs = (over = {}) => ({ body: { items: [conversation(over)], nextCursor: null } });
const one = (over = {}) => ({ body: conversation(over) });
const page = (items = [message()], nextCursor: string | null = null) => ({ body: { items, nextCursor } });
const sentEcho = (req: { body: Record<string, unknown> }) => ({ status: 201, body: message({ id: uuid(950), senderId: ME, clientMessageId: req.body.clientMessageId as string, body: (req.body.body as string) ?? null, kind: req.body.kind as 'text' }) });

beforeEach(async () => {
  await seedSession();
  router.push.mockClear();
  for (const k of Object.keys(params)) delete params[k];
  params.id = CID;
});

describe('ChatsScreen', () => {
  it('lists conversations with unread counts and opens one', async () => {
    mockApi({ ...base(), 'GET /conversations': convs() });
    renderWithProviders(<ChatsScreen />);
    expect(await screen.findByTestId(`unread-${CID}`)).toBeTruthy();
    expect(screen.getByLabelText('Alex, 2 unread')).toBeTruthy();
    fireEvent.press(screen.getByTestId(`conversation-${CID}`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/chats/[id]', params: { id: CID, name: 'Alex' } });
  });

  it('shows empty and error states', async () => {
    const api = mockApi({ ...base(), 'GET /conversations': apiError(500, 'INTERNAL') });
    const { unmount } = renderWithProviders(<ChatsScreen />);
    expect(await screen.findByTestId('screen-error')).toBeTruthy();
    unmount();
    api.set('GET /conversations', { body: { items: [], nextCursor: null } });
    renderWithProviders(<ChatsScreen />);
    expect(await screen.findByTestId('screen-empty')).toBeTruthy();
  });
});

describe('ChatScreen', () => {
  it('loads the thread, marks it read and sends a text optimistically with a client message id', async () => {
    const track = jest.spyOn(analytics, 'track');
    const api = mockApi({ ...base(), [`GET /conversations/${CID}`]: one(), [`GET /conversations/${CID}/messages`]: page(), [`POST /conversations/${CID}/read`]: { status: 204 }, [`POST /conversations/${CID}/messages`]: sentEcho });
    renderWithProviders(<ChatScreen />);
    expect(await screen.findByText('Hey there')).toBeTruthy();
    await waitFor(() => expect(api.callsTo(`POST /conversations/${CID}/read`)[0]?.body).toEqual({ messageId: uuid(901) }));
    fireEvent.changeText(screen.getByTestId('chat-input'), 'Hi Alex!');
    fireEvent.press(screen.getByTestId('chat-send'));
    expect(await screen.findByText('Hi Alex!')).toBeTruthy();
    await waitFor(() => expect(api.callsTo(`POST /conversations/${CID}/messages`)).toHaveLength(1));
    const body = api.callsTo(`POST /conversations/${CID}/messages`)[0]!.body;
    expect(body).toMatchObject({ kind: 'text', body: 'Hi Alex!', aiAssisted: false });
    expect(body.clientMessageId).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(track).toHaveBeenCalledWith('message_sent', { kind: 'text', aiAssisted: false }));
  });

  it('keeps a failed message with retry, reusing the same client message id', async () => {
    const api = mockApi({ ...base(), [`GET /conversations/${CID}`]: one(), [`GET /conversations/${CID}/messages`]: page(), [`POST /conversations/${CID}/read`]: { status: 204 }, [`POST /conversations/${CID}/messages`]: apiError(500, 'INTERNAL') });
    renderWithProviders(<ChatScreen />);
    await screen.findByText('Hey there');
    fireEvent.changeText(screen.getByTestId('chat-input'), 'Are you there?');
    fireEvent.press(screen.getByTestId('chat-send'));
    const first = await waitFor(() => api.callsTo(`POST /conversations/${CID}/messages`)[0]!.body.clientMessageId as string);
    expect(await screen.findByTestId(`failed-${first}`)).toBeTruthy();
    api.set(`POST /conversations/${CID}/messages`, sentEcho);
    fireEvent.press(screen.getByTestId(`retry-${first}`));
    await waitFor(() => expect(screen.queryByTestId(`failed-${first}`)).toBeNull());
    expect(api.callsTo(`POST /conversations/${CID}/messages`).map((c) => c.body.clientMessageId)).toEqual([first, first]);
  });

  it('pages older messages with the before cursor', async () => {
    const api = mockApi({
      ...base(),
      [`GET /conversations/${CID}`]: one(),
      [`GET /conversations/${CID}/messages`]: (req) => (req.query.get('before') === 'cur-1' ? page([message({ id: uuid(902), body: 'Older one' })]) : page([message()], 'cur-1')),
      [`POST /conversations/${CID}/read`]: { status: 204 },
    });
    renderWithProviders(<ChatScreen />);
    fireEvent.press(await screen.findByTestId('chat-older'));
    expect(await screen.findByText('Older one')).toBeTruthy();
    expect(api.callsTo(`GET /conversations/${CID}/messages`).at(-1)!.query.get('before')).toBe('cur-1');
  });

  it('shows the closed state and switches to it when a send is rejected', async () => {
    const api = mockApi({ ...base(), [`GET /conversations/${CID}`]: one({ status: 'closed' }), [`GET /conversations/${CID}/messages`]: page(), [`POST /conversations/${CID}/read`]: { status: 204 } });
    const { unmount } = renderWithProviders(<ChatScreen />);
    expect(await screen.findByTestId('chat-closed')).toBeTruthy();
    expect(screen.queryByTestId('chat-input')).toBeNull();
    unmount();

    api.set(`GET /conversations/${CID}`, one());
    api.set(`POST /conversations/${CID}/messages`, apiError(409, 'CONVERSATION_CLOSED'));
    renderWithProviders(<ChatScreen />);
    await screen.findByText('Hey there');
    fireEvent.changeText(screen.getByTestId('chat-input'), 'hello?');
    fireEvent.press(screen.getByTestId('chat-send'));
    expect(await screen.findByTestId('chat-closed')).toBeTruthy();
  });

  it('reacts to a message and sends icebreakers in an empty conversation', async () => {
    const api = mockApi({ ...base(), [`GET /conversations/${CID}`]: one(), [`GET /conversations/${CID}/messages`]: page(), [`POST /conversations/${CID}/read`]: { status: 204 }, [`POST /messages/${uuid(901)}/reactions`]: { status: 204 } });
    const { unmount } = renderWithProviders(<ChatScreen />);
    fireEvent.press(await screen.findByLabelText('Alex: Hey there'));
    fireEvent.press(screen.getByTestId(`react-${uuid(901)}-❤️`));
    await waitFor(() => expect(api.callsTo(`POST /messages/${uuid(901)}/reactions`)[0]?.body).toEqual({ emoji: '❤️' }));
    unmount();

    api.set(`GET /conversations/${CID}/messages`, page([]));
    api.set(`GET /conversations/${CID}/icebreakers`, { body: [{ key: 'travel', text: 'Best trip ever?' }] });
    api.set(`POST /conversations/${CID}/messages`, sentEcho);
    renderWithProviders(<ChatScreen />);
    fireEvent.press(await screen.findByTestId('icebreaker-travel'));
    await waitFor(() => expect(api.callsTo(`POST /conversations/${CID}/messages`)[0]?.body).toMatchObject({ kind: 'icebreaker', body: 'Best trip ever?' }));
  });

  it('uploads an image through an upload token before sending', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'https://local.test/photo.jpg', mimeType: 'image/jpeg' }] });
    const api = mockApi({
      ...base(),
      [`GET /conversations/${CID}`]: one(),
      [`GET /conversations/${CID}/messages`]: page(),
      [`POST /conversations/${CID}/read`]: { status: 204 },
      'GET /photo.jpg': { body: 'x'.repeat(10), headers: { 'content-type': 'image/jpeg' } },
      [`POST /conversations/${CID}/uploads`]: { status: 201, body: { uploadUrl: 'https://storage.test/chat/key', method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, uploadToken: 'upl-token-1' } },
      'PUT /chat/key': { status: 200 },
      [`POST /conversations/${CID}/messages`]: sentEcho,
    });
    renderWithProviders(<ChatScreen />);
    await screen.findByText('Hey there');
    fireEvent.press(screen.getByTestId('chat-photo'));
    await waitFor(() => expect(api.callsTo(`POST /conversations/${CID}/messages`)).toHaveLength(1));
    expect(api.callsTo(`POST /conversations/${CID}/uploads`)[0]!.body).toMatchObject({ kind: 'image', mimeType: 'image/jpeg' });
    expect(api.callsTo('PUT /chat/key')).toHaveLength(1);
    expect(api.callsTo(`POST /conversations/${CID}/messages`)[0]!.body).toMatchObject({ kind: 'image', uploadToken: 'upl-token-1' });
  });

  it('suggests AI conversation starters after consent; the user still has to tap send', async () => {
    let consented = false;
    const api = mockApi({
      ...base(),
      [`GET /conversations/${CID}`]: one(),
      [`GET /conversations/${CID}/messages`]: page(),
      [`POST /conversations/${CID}/read`]: { status: 204 },
      'POST /users/me/consents': () => {
        consented = true;
        return { body: [] };
      },
      'POST /ai/conversation-starters': () => (consented ? { body: { starters: ['Ask about the trip'], sendRequiresUserAction: true } } : apiError(400, 'CONSENT_REQUIRED', { kind: 'consent', consentType: 'ai_assistance' })),
      [`POST /conversations/${CID}/messages`]: sentEcho,
    });
    renderWithProviders(<ChatScreen />, { config: testConfig({ flags: { 'ai.conversation_starters': true } }) });
    await screen.findByText('Hey there');
    fireEvent.press(screen.getByTestId('chat-starters'));
    fireEvent.press(await screen.findByTestId('starters-allow'));
    await waitFor(() => expect(api.callsTo('POST /users/me/consents')[0]?.body).toEqual({ consentType: 'ai_assistance', granted: true }));
    fireEvent.press(await screen.findByTestId('starter-0'));
    expect(screen.getByTestId('chat-input').props.value).toBe('Ask about the trip');
    expect(api.callsTo(`POST /conversations/${CID}/messages`)).toHaveLength(0);
    fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() => expect(api.callsTo(`POST /conversations/${CID}/messages`)[0]?.body).toMatchObject({ body: 'Ask about the trip', aiAssisted: true }));
    expect(api.callsTo('POST /ai/conversation-starters')[0]!.body).toEqual({ conversationId: CID });
  });

  it('shows a graceful state when translation AI is not configured', async () => {
    mockApi({ ...base(), [`GET /conversations/${CID}`]: one(), [`GET /conversations/${CID}/messages`]: page(), [`POST /conversations/${CID}/read`]: { status: 204 }, 'POST /ai/translate': apiError(503, 'AI_NOT_CONFIGURED') });
    renderWithProviders(<ChatScreen />, { config: testConfig({ flags: { 'ai.translation': true } }) });
    fireEvent.press(await screen.findByLabelText('Alex: Hey there'));
    fireEvent.press(screen.getByTestId(`translate-${uuid(901)}`));
    expect(await screen.findByTestId('translate-unavailable')).toBeTruthy();
  });

  it('says translation is off in privacy settings (distinct from unavailable) and links there', async () => {
    mockApi({ ...base(), [`GET /conversations/${CID}`]: one(), [`GET /conversations/${CID}/messages`]: page(), [`POST /conversations/${CID}/read`]: { status: 204 }, 'POST /ai/translate': apiError(403, 'FEATURE_DISABLED', { setting: 'allowTranslation' }) });
    renderWithProviders(<ChatScreen />, { config: testConfig({ flags: { 'ai.translation': true } }) });
    fireEvent.press(await screen.findByLabelText('Alex: Hey there'));
    fireEvent.press(screen.getByTestId(`translate-${uuid(901)}`));
    expect(await screen.findByText('Translation is off in your privacy settings')).toBeTruthy();
    expect(screen.queryByTestId('translate-unavailable')).toBeNull();
    fireEvent.press(screen.getByTestId('translate-open-privacy'));
    expect(router.push).toHaveBeenCalledWith('/settings/privacy');
  });

  it('turns on a privacy setting when CONSENT_REQUIRED is of kind "setting", then retries', async () => {
    let allowed = false;
    const api = mockApi({
      ...base(),
      [`GET /conversations/${CID}`]: one(),
      [`GET /conversations/${CID}/messages`]: page(),
      [`POST /conversations/${CID}/read`]: { status: 204 },
      'PUT /profiles/me/privacy': (req) => {
        allowed = req.body.allowAiMessageAnalysis === true;
        return { body: {} };
      },
      'POST /ai/conversation-starters': () => (allowed ? { body: { starters: ['Hi'], sendRequiresUserAction: true } } : apiError(400, 'CONSENT_REQUIRED', { kind: 'setting', setting: 'allowAiMessageAnalysis' })),
    });
    renderWithProviders(<ChatScreen />, { config: testConfig({ flags: { 'ai.conversation_starters': true } }) });
    await screen.findByText('Hey there');
    fireEvent.press(screen.getByTestId('chat-starters'));
    fireEvent.press(await screen.findByTestId('starters-allow'));
    expect(await screen.findByTestId('starter-0')).toBeTruthy();
    expect(api.callsTo('PUT /profiles/me/privacy')[0]!.body).toEqual({ allowAiMessageAnalysis: true });
    expect(api.callsTo('POST /users/me/consents')).toHaveLength(0);
  });

  it('polls for new messages while the realtime socket is not connected', async () => {
    jest.useFakeTimers();
    try {
      const api = mockApi({ ...base(), [`GET /conversations/${CID}`]: one(), [`GET /conversations/${CID}/messages`]: page(), [`POST /conversations/${CID}/read`]: { status: 204 } });
      renderWithProviders(<ChatScreen />);
      await screen.findByText('Hey there');
      expect(screen.getByTestId('chat-polling')).toBeTruthy();
      api.set(`GET /conversations/${CID}/messages`, page([message({ id: uuid(905), body: 'Polled in', createdAt: '2026-10-08T10:00:00.000Z' }), message()]));
      await act(async () => {
        jest.advanceTimersByTime(POLL_MS);
      });
      expect(await screen.findByText('Polled in')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('receives realtime messages and read receipts over the WebSocket', async () => {
    const FakeWS = (globalThis as unknown as { FakeWebSocket: { instances: Array<{ open: () => void; receive: (e: string, d: unknown) => void; sent: string[] }> } }).FakeWebSocket;
    FakeWS.instances.length = 0;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
    mockApi({ ...base(), [`GET /conversations/${CID}`]: one(), [`GET /conversations/${CID}/messages`]: page([message({ id: uuid(903), senderId: ME, body: 'Mine' })]), [`POST /conversations/${CID}/read`]: { status: 204 } });
    renderWithProviders(
      <RealtimeProvider enabled>
        <ChatScreen />
      </RealtimeProvider>,
    );
    await screen.findByText('Mine');
    await waitFor(() => expect(FakeWS.instances.length).toBe(1));
    const ws = FakeWS.instances[0]!;
    act(() => {
      ws.open();
      ws.receive('ready', { userId: ME });
    });
    expect(JSON.parse(ws.sent[0]!)).toMatchObject({ type: 'auth' });
    act(() => {
      ws.receive('message.new', message({ id: uuid(904), body: 'Live hello' }));
      ws.receive('read', { conversationId: CID, userId: uuid(401), messageId: uuid(903) });
    });
    expect(await screen.findByText('Live hello')).toBeTruthy();
    expect(screen.getByTestId('read-receipt')).toBeTruthy();
    expect(ws.sent.map((s) => JSON.parse(s))).toContainEqual({ type: 'delivered', conversationId: CID, messageId: uuid(904) });
    act(() => ws.receive('match.ended', { matchId: uuid(701), conversationId: CID }));
    expect(await screen.findByTestId('chat-closed')).toBeTruthy();
    await flushAsync();
  });
});

describe('ChatScreen — single conversation + moderation events', () => {
  const FakeWS = () => (globalThis as unknown as { FakeWebSocket: { instances: Array<{ open: () => void; receive: (e: string, d: unknown) => void; sent: string[] }> } }).FakeWebSocket;
  async function connect() {
    await waitFor(() => expect(FakeWS().instances.length).toBe(1));
    const ws = FakeWS().instances[0]!;
    act(() => {
      ws.open();
      ws.receive('ready', { userId: ME });
    });
    return ws;
  }
  beforeEach(() => {
    FakeWS().instances.length = 0;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS();
  });

  it('loads its header from GET /conversations/:id, never from the list (deep link / restart)', async () => {
    const api = mockApi({ ...base(), [`GET /conversations/${CID}`]: one({ participants: [{ userId: uuid(401), displayName: 'Sam' }] }), [`GET /conversations/${CID}/messages`]: page(), [`POST /conversations/${CID}/read`]: { status: 204 } });
    renderWithProviders(<ChatScreen />);
    expect(await screen.findByText('Sam')).toBeTruthy();
    expect(screen.getByTestId('chat-plan-date')).toBeTruthy();
    expect(api.callsTo('GET /conversations')).toHaveLength(0);
  });

  it('shows an error with retry when the conversation is not found (not a member)', async () => {
    const api = mockApi({ ...base(), [`GET /conversations/${CID}`]: apiError(404, 'NOT_FOUND'), [`GET /conversations/${CID}/messages`]: apiError(404, 'NOT_FOUND') });
    renderWithProviders(<ChatScreen />);
    expect(await screen.findByTestId('screen-error')).toBeTruthy();
    expect(screen.queryByTestId('chat-input')).toBeNull();
    fireEvent.press(screen.getByTestId('screen-retry'));
    await waitFor(() => expect(api.callsTo(`GET /conversations/${CID}`)).toHaveLength(2));
  });

  it('applies message.updated (media resolved) and message.deleted (removed by moderation)', async () => {
    mockApi({
      ...base(),
      [`GET /conversations/${CID}`]: one(),
      [`GET /conversations/${CID}/messages`]: page([message({ id: uuid(906), kind: 'image', body: null, media: [] }), message({ id: uuid(907), body: 'Will vanish', createdAt: '2026-10-07T09:00:00.000Z' })]),
      [`POST /conversations/${CID}/read`]: { status: 204 },
    });
    renderWithProviders(
      <RealtimeProvider enabled>
        <ChatScreen />
      </RealtimeProvider>,
    );
    await screen.findByText('Will vanish');
    const images = () => screen.UNSAFE_queryAllByType(Image).filter((i) => (i.props.source as { uri?: string })?.uri === 'https://cdn.test/m1');
    expect(images()).toHaveLength(0);
    const ws = await connect();
    act(() => ws.receive('message.updated', message({ id: uuid(906), kind: 'image', body: null, media: [{ id: uuid(908), kind: 'image', url: 'https://cdn.test/m1', durationMs: null, width: 10, height: 10 }] })));
    await waitFor(() => expect(images()).toHaveLength(1));
    act(() => ws.receive('message.deleted', { messageId: uuid(907), conversationId: CID }));
    await waitFor(() => expect(screen.queryByText('Will vanish')).toBeNull());
    expect(screen.getByText('Message deleted')).toBeTruthy();
    // Events for other conversations are ignored.
    act(() => ws.receive('message.updated', message({ id: uuid(909), conversationId: uuid(899), body: 'Elsewhere' })));
    expect(screen.queryByText('Elsewhere')).toBeNull();
    await flushAsync();
  });

  it('closes the thread on match.ended matched by matchId (block and unmatch look the same)', async () => {
    mockApi({ ...base(), [`GET /conversations/${CID}`]: one(), [`GET /conversations/${CID}/messages`]: page(), [`POST /conversations/${CID}/read`]: { status: 204 } });
    renderWithProviders(
      <RealtimeProvider enabled>
        <ChatScreen />
      </RealtimeProvider>,
    );
    await screen.findByText('Hey there');
    const ws = await connect();
    act(() => ws.receive('match.ended', { matchId: uuid(799), conversationId: uuid(899) }));
    expect(screen.queryByTestId('chat-closed')).toBeNull();
    act(() => ws.receive('match.ended', { matchId: uuid(701), conversationId: null }));
    expect(await screen.findByTestId('chat-closed')).toBeTruthy();
    await flushAsync();
  });

  it('refreshes the conversation list on moderation events', async () => {
    const api = mockApi({ ...base(), 'GET /conversations': convs() });
    renderWithProviders(
      <RealtimeProvider enabled>
        <ChatsScreen />
      </RealtimeProvider>,
    );
    await screen.findByTestId(`conversation-${CID}`);
    const ws = await connect();
    const before = api.callsTo('GET /conversations').length;
    act(() => ws.receive('message.deleted', { messageId: uuid(907), conversationId: CID }));
    await waitFor(() => expect(api.callsTo('GET /conversations').length).toBeGreaterThan(before));
    const mid = api.callsTo('GET /conversations').length;
    act(() => ws.receive('message.updated', message()));
    await waitFor(() => expect(api.callsTo('GET /conversations').length).toBeGreaterThan(mid));
    await flushAsync();
  });
});

describe('CallScreen', () => {
  it('obtains a LiveKit token, shows the native-build state and ends the call', async () => {
    Object.assign(params, { conversationId: CID, kind: 'video', name: 'Alex' });
    const track = jest.spyOn(analytics, 'track');
    const api = mockApi({ ...base(), [`POST /conversations/${CID}/calls`]: { status: 201, body: { callId: 'call-1', url: 'wss://lk.test', token: 'jwt' } }, 'POST /calls/call-1/end': { status: 204 } });
    renderWithProviders(<CallScreen />);
    expect(await screen.findByTestId('call-native-required')).toBeTruthy();
    expect(api.callsTo(`POST /conversations/${CID}/calls`)[0]!.body).toEqual({ kind: 'video' });
    expect(track).toHaveBeenCalledWith('call_started', { kind: 'video', direction: 'outgoing' });
    fireEvent.press(screen.getByTestId('call-end'));
    await waitFor(() => expect(api.callsTo('POST /calls/call-1/end')).toHaveLength(1));
    expect(router.back).toHaveBeenCalled();
  });

  it('shows provider errors with retry', async () => {
    Object.assign(params, { conversationId: CID, kind: 'voice' });
    mockApi({ ...base(), [`POST /conversations/${CID}/calls`]: apiError(503, 'CALL_PROVIDER_NOT_CONFIGURED') });
    renderWithProviders(<CallScreen />);
    expect(await screen.findByText("Calls aren't available right now.")).toBeTruthy();
    expect(screen.getByTestId('call-retry')).toBeTruthy();
  });
});
