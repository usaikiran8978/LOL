import { ANALYTICS_EVENTS, SERVER_ONLY_ANALYTICS_EVENTS, type AnalyticsEventName } from '@amora/shared';
import { ApiError } from '../api/errors';

/** Events only the server may emit (server-verified facts); the ingestion endpoint rejects them from clients. */
export const SERVER_ONLY_EVENTS = SERVER_ONLY_ANALYTICS_EVENTS;
type ServerOnly = 'signup_completed' | 'login_succeeded' | 'login_failed' | 'match_created' | 'subscription_started' | 'subscription_cancelled' | 'subscription_renewed' | 'purchase_completed' | 'verification_completed' | 'account_deleted' | 'recommendation_served';
export type ClientAnalyticsEvent = Exclude<AnalyticsEventName, ServerOnly>;
export type EventProps = Record<string, string | number | boolean | null>;

const CLIENT_ALLOWED = new Set<string>(ANALYTICS_EVENTS.filter((e) => !(SERVER_ONLY_EVENTS as readonly string[]).includes(e)));

interface QueuedEvent {
  name: ClientAnalyticsEvent;
  occurredAt: string;
  properties: EventProps;
}

export interface Batch {
  events: QueuedEvent[];
  platform: 'ios' | 'android' | 'web';
  appVersion?: string;
}

export interface AnalyticsOptions {
  send: (batch: Batch) => Promise<unknown>;
  platform: Batch['platform'];
  appVersion?: string;
  /** Server cap is 50 per batch. */
  maxBatch?: number;
  /** Flush as soon as this many events are waiting. */
  flushAt?: number;
  flushIntervalMs?: number;
  /** Oldest events are dropped beyond this (offline protection). */
  maxQueue?: number;
}

/** Contract limits from `clientAnalyticsBatch`: <= 20 properties, keys <= 64 chars, strings <= 256 chars. */
function clean(props: EventProps): EventProps {
  const out: EventProps = {};
  for (const [k, v] of Object.entries(props).slice(0, 20)) out[k.slice(0, 64)] = typeof v === 'string' ? v.slice(0, 256) : v;
  return out;
}

/**
 * Batched, offline-tolerant client analytics. The ingestion endpoint requires a signed-in user, so events queue
 * until there is a session and the user has not withdrawn analytics consent.
 */
export class Analytics {
  private queue: QueuedEvent[] = [];
  private authenticated = false;
  private consented = true;
  private flushing: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: AnalyticsOptions) {}

  track(name: ClientAnalyticsEvent, properties: EventProps = {}): void {
    if (!this.consented || !CLIENT_ALLOWED.has(name)) return;
    this.queue.push({ name, occurredAt: new Date().toISOString(), properties: clean(properties) });
    const max = this.opts.maxQueue ?? 500;
    if (this.queue.length > max) this.queue.splice(0, this.queue.length - max);
    if (this.queue.length >= (this.opts.flushAt ?? 20)) void this.flush();
  }

  setAuthenticated(v: boolean): void {
    this.authenticated = v;
    if (v) void this.flush();
  }

  /** Withdrawn consent drops anything not yet sent. */
  setConsent(granted: boolean): void {
    this.consented = granted;
    if (!granted) this.queue = [];
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.flush(), this.opts.flushIntervalMs ?? 15_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get pending(): number {
    return this.queue.length;
  }

  /**
   * Single-flight: a flush requested while one is running piggybacks on it, and the running flush drains once more
   * so events queued in the meantime are included before the shared promise resolves.
   */
  flush(): Promise<void> {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.again = false;
        if (!(await this.drain())) break;
      } while (this.again);
    })().finally(() => (this.flushing = null));
    return this.flushing;
  }

  /** Returns false when sending failed (stop retrying until the next scheduled flush). */
  private async drain(): Promise<boolean> {
    while (this.authenticated && this.consented && this.queue.length) {
      const batch = this.queue.splice(0, this.opts.maxBatch ?? 50);
      try {
        await this.opts.send({ events: batch, platform: this.opts.platform, appVersion: this.opts.appVersion });
      } catch (e) {
        // A 4xx other than auth/rate-limit means the batch itself is unacceptable; retrying would loop forever.
        const permanent = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;
        if (!permanent) this.queue.unshift(...batch);
        return false;
      }
    }
    return true;
  }
}
