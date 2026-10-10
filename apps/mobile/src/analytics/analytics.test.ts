import { ApiError } from '../api/errors';
import { Analytics, SERVER_ONLY_EVENTS, type Batch } from './analytics';

describe('Analytics queue', () => {
  const make = (send: (b: Batch) => Promise<unknown>) => new Analytics({ send, platform: 'ios', appVersion: '1.0.0', flushAt: 1000 });

  it('holds events until signed in, then sends them in batches of at most 50', async () => {
    const send = jest.fn(async (_b: Batch) => ({}));
    const a = make(send);
    for (let i = 0; i < 120; i++) a.track('paywall_viewed', { i });
    await a.flush();
    expect(send).not.toHaveBeenCalled();
    a.setAuthenticated(true);
    await a.flush();
    expect(send.mock.calls.map(([b]) => b.events.length)).toEqual([50, 50, 20]);
    expect(send.mock.calls[0]![0]).toMatchObject({ platform: 'ios', appVersion: '1.0.0' });
    expect(a.pending).toBe(0);
  });

  it('never sends server-only or unknown events', async () => {
    const send = jest.fn(async (_b: Batch) => ({}));
    const a = make(send);
    a.setAuthenticated(true);
    for (const e of SERVER_ONLY_EVENTS) a.track(e as never);
    a.track('not_an_event' as never);
    a.track('signup_started');
    await a.flush();
    expect(send.mock.calls.flatMap(([b]) => b.events.map((e) => e.name))).toEqual(['signup_started']);
  });

  it('requeues on transient failure and drops batches the server rejects as invalid', async () => {
    const send = jest.fn().mockRejectedValueOnce(new ApiError('NETWORK', 0)).mockResolvedValueOnce({});
    const a = make(send);
    a.setAuthenticated(true);
    a.track('signup_started');
    await a.flush();
    expect(a.pending).toBe(1);
    await a.flush();
    expect(a.pending).toBe(0);

    const bad = make(jest.fn().mockRejectedValue(new ApiError('VALIDATION_FAILED', 400)));
    bad.setAuthenticated(true);
    bad.track('signup_started');
    await bad.flush();
    expect(bad.pending).toBe(0);
  });

  it('clips properties to the contract limits and respects withdrawn consent', async () => {
    const send = jest.fn(async (_b: Batch) => ({}));
    const a = make(send);
    a.setAuthenticated(true);
    const props = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, 'v'.repeat(300)]));
    a.track('paywall_viewed', props);
    await a.flush();
    const sent = send.mock.calls[0]![0].events[0]!.properties;
    expect(Object.keys(sent)).toHaveLength(20);
    expect(String(sent.k0)).toHaveLength(256);

    a.setConsent(false);
    a.track('paywall_viewed');
    expect(a.pending).toBe(0);
  });
});
