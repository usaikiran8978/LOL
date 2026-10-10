import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { APP_CONFIG, type AppConfig } from '../config/config';

const CHANNEL = 'amora:realtime';
const PRESENCE_TTL_S = 70;

interface Envelope {
  userIds: string[];
  event: string;
  data: unknown;
}

/**
 * Fan-out of realtime events to connected sockets (TECH §10). Each instance keeps its own socket registry; with
 * REDIS_URL set, events go through Redis pub/sub so a user connected to any instance receives them, and presence is
 * shared (used to decide whether to fall back to push).
 */
@Injectable()
export class RealtimeBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeBus.name);
  private readonly sockets = new Map<string, Set<WebSocket>>();
  private pub: Redis | null = null;
  private sub: Redis | null = null;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async onModuleInit(): Promise<void> {
    if (!this.cfg.REDIS_URL) return;
    this.pub = new Redis(this.cfg.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
    this.sub = new Redis(this.cfg.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
    await Promise.all([this.pub.connect(), this.sub.connect()]);
    await this.sub.subscribe(CHANNEL);
    this.sub.on('message', (_c, raw) => {
      try {
        this.deliverLocal(JSON.parse(raw) as Envelope);
      } catch (err) {
        this.logger.warn(`bad realtime envelope: ${(err as Error).message}`);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.pub?.quit(), this.sub?.quit()].filter(Boolean));
    for (const set of this.sockets.values()) for (const s of set) s.close(1001, 'server shutdown');
  }

  /** Readiness probe: 'disabled' in single-instance mode. */
  async ping(): Promise<'ok' | 'disabled'> {
    if (!this.pub) return 'disabled';
    await this.pub.ping();
    return 'ok';
  }

  register(userId: string, socket: WebSocket): void {
    const set = this.sockets.get(userId) ?? new Set();
    set.add(socket);
    this.sockets.set(userId, set);
    void this.touch(userId);
  }

  unregister(userId: string, socket: WebSocket): void {
    const set = this.sockets.get(userId);
    if (!set) return;
    set.delete(socket);
    if (!set.size) {
      this.sockets.delete(userId);
      void this.pub?.del(`presence:${userId}`);
    }
  }

  async touch(userId: string): Promise<void> {
    await this.pub?.set(`presence:${userId}`, '1', 'EX', PRESENCE_TTL_S);
  }

  async isOnline(userId: string): Promise<boolean> {
    if (this.sockets.has(userId)) return true;
    return this.pub ? (await this.pub.exists(`presence:${userId}`)) === 1 : false;
  }

  async publish(userIds: string[], event: string, data: unknown): Promise<void> {
    const env: Envelope = { userIds: [...new Set(userIds)], event, data };
    if (this.pub) await this.pub.publish(CHANNEL, JSON.stringify(env));
    else this.deliverLocal(env);
  }

  private deliverLocal(env: Envelope): void {
    const frame = JSON.stringify({ event: env.event, data: env.data });
    for (const uid of env.userIds) for (const s of this.sockets.get(uid) ?? []) if (s.readyState === s.OPEN) s.send(frame);
  }
}
