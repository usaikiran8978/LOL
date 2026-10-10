import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Atomic fixed-window counter with a block key. Returns [hits, windowTtlMs, blocked(0|1), blockTtlMs].
 * When the limit is first exceeded the window counter is dropped, so counting restarts after the block lapses.
 */
const SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return {tonumber(redis.call('GET', KEYS[1]) or '0') + 1, redis.call('PTTL', KEYS[1]), 1, blockTtl}
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  local block = tonumber(ARGV[3])
  if block <= 0 then return {hits, ttl, 1, ttl} end
  redis.call('SET', KEYS[2], '1', 'PX', block)
  redis.call('DEL', KEYS[1])
  return {hits, ttl, 1, block}
end
return {hits, ttl, 0, 0}
`;

/**
 * Rate-limit counters shared by all API instances (TECH §15). If Redis is unreachable the request is counted in the
 * per-instance memory store instead, so an outage degrades limits to per-instance rather than disabling them or
 * failing requests.
 */
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis;
  private readonly fallback = new ThrottlerStorageService();
  private lastWarn = 0;

  constructor(url: string, private readonly prefix = 'amora:rl:') {
    this.redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.redis.on('error', (err) => this.warn(err));
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}${throttlerName}:${key}`;
    try {
      const [hits, ttlMs, blocked, blockMs] = (await this.redis.eval(SCRIPT, 2, `${base}:h`, `${base}:b`, ttl, limit, blockDuration)) as number[];
      return {
        totalHits: hits!,
        timeToExpire: Math.max(0, Math.ceil(ttlMs! / 1000)),
        isBlocked: blocked === 1,
        timeToBlockExpire: blocked === 1 ? Math.max(1, Math.ceil(blockMs! / 1000)) : 0,
      };
    } catch (err) {
      this.warn(err as Error);
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.fallback.onApplicationShutdown();
    if (this.redis.status === 'ready') await this.redis.quit().catch(() => this.redis.disconnect());
    else this.redis.disconnect();
  }

  private warn(err: Error): void {
    if (Date.now() - this.lastWarn < 60_000) return;
    this.lastWarn = Date.now();
    this.logger.warn(`rate-limit store degraded to per-instance memory: ${err.message}`);
  }
}
