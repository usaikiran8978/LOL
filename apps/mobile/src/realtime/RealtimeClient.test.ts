import { RealtimeClient } from './RealtimeClient';

type Fake = { url: string; sent: string[]; open: () => void; receive: (e: string, d: unknown) => void; close: (code?: number, reason?: string) => void };
const FakeWS = (globalThis as unknown as { FakeWebSocket: { instances: Fake[] } & (new (url: string) => Fake) }).FakeWebSocket;
const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  FakeWS.instances.length = 0;
});
afterEach(() => jest.useRealTimers());

function make(over: Partial<ConstructorParameters<typeof RealtimeClient>[0]> = {}) {
  const getToken = jest.fn(async () => 'tok-1');
  const refreshToken = jest.fn(async () => 'tok-2');
  const rt = new RealtimeClient({ url: 'ws://api.test/v1/ws', getToken, refreshToken, WebSocketImpl: FakeWS as unknown as typeof WebSocket, random: () => 0.5, ...over });
  return { rt, getToken, refreshToken };
}

describe('RealtimeClient', () => {
  it('authenticates with the first frame and dispatches server events after ready', async () => {
    const { rt } = make();
    const statuses: string[] = [];
    rt.onStatus((s) => statuses.push(s));
    const got: unknown[] = [];
    rt.on('message.new', (d) => got.push(d));
    rt.start();
    await tick();
    const ws = FakeWS.instances[0]!;
    expect(ws.url).toBe('ws://api.test/v1/ws');
    ws.open();
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'auth', token: 'tok-1' });
    expect(rt.send({ type: 'ping' })).toBe(false); // not ready yet
    ws.receive('ready', { userId: 'u1' });
    expect(rt.state).toBe('open');
    ws.receive('message.new', { id: 'm1' });
    expect(got).toEqual([{ id: 'm1' }]);
    jest.advanceTimersByTime(30_000);
    expect(ws.sent.map((s) => JSON.parse(s).type)).toContain('ping');
    expect(statuses).toEqual(['connecting', 'open']);
    rt.stop();
  });

  it('reconnects with backoff and refreshes the token after a 4401 TOKEN_EXPIRED close', async () => {
    const { rt, refreshToken } = make();
    rt.start();
    await tick();
    FakeWS.instances[0]!.open();
    FakeWS.instances[0]!.close(4401, 'TOKEN_EXPIRED');
    expect(rt.state).toBe('closed');
    jest.advanceTimersByTime(749);
    await tick();
    expect(FakeWS.instances).toHaveLength(1);
    jest.advanceTimersByTime(1);
    await tick();
    expect(refreshToken).toHaveBeenCalledWith('tok-1');
    const ws2 = FakeWS.instances[1]!;
    ws2.open();
    expect(JSON.parse(ws2.sent[0]!)).toEqual({ type: 'auth', token: 'tok-2' });
    // A plain network drop backs off further (2s base → 1.5s with this jitter) without refreshing.
    ws2.receive('ready', {});
    ws2.close(1006, '');
    jest.advanceTimersByTime(750);
    await tick();
    expect(FakeWS.instances).toHaveLength(3);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    rt.stop();
  });

  it('stays closed while signed out and stops cleanly', async () => {
    const { rt } = make({ getToken: jest.fn(async () => null) });
    rt.start();
    await tick();
    expect(FakeWS.instances).toHaveLength(0);
    expect(rt.state).toBe('closed');
    rt.stop();
    jest.advanceTimersByTime(60_000);
    await tick();
    expect(FakeWS.instances).toHaveLength(0);
    expect(rt.state).toBe('idle');
  });
});
