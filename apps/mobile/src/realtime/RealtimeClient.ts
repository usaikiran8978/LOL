/**
 * Chat realtime transport: raw WebSocket at `/v1/ws` (apps/api/src/modules/chat/chat.gateway.ts).
 *
 * Protocol: the first client frame must be `{type:'auth', token}` (within 10s); the server answers
 * `{event:'ready', data:{userId}}`. Server frames are `{event, data}`. The token is only checked at connect, so an
 * expired token means "reconnect with a fresh one" (close code 4401 + reason = error code). Presence expires after
 * 70s without a ping. Reconnects use exponential backoff with jitter; callers fall back to polling while not open.
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed';
export type RealtimeHandler = (data: unknown) => void;

export interface RealtimeOptions {
  url: string;
  /** A currently valid access token (null = signed out; stay closed). */
  getToken: () => Promise<string | null>;
  /** The server rejected `used` (4401 TOKEN_EXPIRED/TOKEN_INVALID): obtain a fresh token via the serialized refresh. */
  refreshToken: (used: string | null) => Promise<string | null>;
  WebSocketImpl?: typeof WebSocket;
  pingIntervalMs?: number;
  maxBackoffMs?: number;
  random?: () => number;
}

const AUTH_CLOSE = 4401;
const REFRESHABLE = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID']);

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private status: RealtimeStatus = 'idle';
  private handlers = new Map<string, Set<RealtimeHandler>>();
  private statusHandlers = new Set<(s: RealtimeStatus) => void>();
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastToken: string | null = null;
  private needsRefresh = false;

  constructor(private readonly opts: RealtimeOptions) {}

  get state(): RealtimeStatus {
    return this.status;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onopen = null;
      ws.onerror = null;
      try {
        ws.close(1000);
      } catch {
        /* already closed */
      }
    }
    this.setStatus('idle');
  }

  /** Reconnect now (e.g. app returned to the foreground) instead of waiting for the backoff timer. */
  wake(): void {
    if (!this.running || this.status === 'open' || this.status === 'connecting') return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempts = 0;
    void this.connect();
  }

  on(event: string, handler: RealtimeHandler): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  onStatus(handler: (s: RealtimeStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /** Fire-and-forget client frame (typing / delivered / ping). Dropped while not connected. */
  send(frame: { type: 'ping' } | { type: 'typing'; conversationId: string; isTyping: boolean } | { type: 'delivered'; conversationId: string; messageId: string }): boolean {
    if (this.status !== 'open' || !this.ws) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  private setStatus(s: RealtimeStatus) {
    if (s === this.status) return;
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }

  private clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    this.setStatus('connecting');
    let token: string | null;
    try {
      token = this.needsRefresh ? await this.opts.refreshToken(this.lastToken) : await this.opts.getToken();
    } catch {
      token = null;
    }
    this.needsRefresh = false;
    if (!this.running) return;
    if (!token) return this.scheduleReconnect();
    this.lastToken = token;

    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    let ws: WebSocket;
    try {
      ws = new Impl(this.opts.url);
    } catch {
      return this.scheduleReconnect();
    }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onmessage = (e: { data: unknown }) => this.handleFrame(e.data);
    ws.onerror = () => undefined; // onclose follows and drives the reconnect
    ws.onclose = (e: { code: number; reason: string }) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (e.code === AUTH_CLOSE && REFRESHABLE.has(e.reason)) this.needsRefresh = true;
      this.scheduleReconnect();
    };
  }

  private handleFrame(raw: unknown) {
    let frame: { event?: unknown; data?: unknown };
    try {
      frame = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }
    if (typeof frame.event !== 'string') return;
    if (frame.event === 'ready') {
      this.attempts = 0;
      this.setStatus('open');
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), this.opts.pingIntervalMs ?? 30_000);
    }
    for (const h of this.handlers.get(frame.event) ?? []) h(frame.data);
  }

  private scheduleReconnect() {
    this.setStatus('closed');
    if (!this.running) return;
    const base = Math.min(this.opts.maxBackoffMs ?? 30_000, 1000 * 2 ** this.attempts);
    this.attempts += 1;
    const delay = Math.round(base / 2 + (this.opts.random ?? Math.random)() * (base / 2));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
