import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  it('degrades to per-instance memory limits (still enforcing them) when Redis is unreachable', async () => {
    const s = new RedisThrottlerStorage('redis://127.0.0.1:1');
    try {
      const a = await s.increment('ip:1', 60_000, 2, 60_000, 'default');
      await s.increment('ip:1', 60_000, 2, 60_000, 'default');
      const c = await s.increment('ip:1', 60_000, 2, 60_000, 'default');
      expect(a).toMatchObject({ totalHits: 1, isBlocked: false });
      expect(c.isBlocked).toBe(true);
      expect(c.timeToBlockExpire).toBeGreaterThan(0);
    } finally {
      await s.onModuleDestroy();
    }
  });
});
