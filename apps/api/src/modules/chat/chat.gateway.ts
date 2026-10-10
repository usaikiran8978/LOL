import { Inject, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import { wsClientFrame } from '@amora/shared';
import type { WebSocket } from 'ws';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { RealtimeBus } from '../../common/realtime/realtime-bus';
import { assertUserCanAuthenticate, TokenService } from '../auth/token.service';
import { ChatService } from './chat.service';

const AUTH_TIMEOUT_MS = 10_000;
const MAX_FRAME_BYTES = 4096;

type AuthedSocket = WebSocket & { userId?: string; sessionId?: string; frames?: number[] };

/**
 * Realtime gateway (TECH §10). The first frame must be `{type:"auth", token}` — tokens are never put in URLs so they
 * cannot leak into proxy logs. Session validity is re-checked on connect; per-socket frame rate is capped.
 */
@WebSocketGateway({ path: '/v1/ws' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly bus: RealtimeBus,
    private readonly chat: ChatService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  handleConnection(socket: AuthedSocket): void {
    const timer = setTimeout(() => socket.close(4401, 'auth timeout'), AUTH_TIMEOUT_MS);
    socket.on('message', (raw: Buffer) => void this.onFrame(socket, raw, timer));
  }

  handleDisconnect(socket: AuthedSocket): void {
    if (socket.userId) this.bus.unregister(socket.userId, socket);
  }

  private send(socket: WebSocket, event: string, data: unknown): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ event, data }));
  }

  private async onFrame(socket: AuthedSocket, raw: Buffer, timer: NodeJS.Timeout): Promise<void> {
    if (raw.length > MAX_FRAME_BYTES) return socket.close(1009, 'frame too large');
    const now = Date.now();
    socket.frames = (socket.frames ?? []).filter((t) => now - t < 10_000);
    socket.frames.push(now);
    if (socket.frames.length > 50) return socket.close(4429, 'rate limited');

    let frame: unknown;
    try {
      frame = JSON.parse(raw.toString('utf8'));
    } catch {
      return this.send(socket, 'error', { code: 'VALIDATION_FAILED' });
    }

    if (!socket.userId) {
      const f = frame as { type?: string; token?: string };
      if (f.type !== 'auth' || typeof f.token !== 'string') return socket.close(4401, 'auth required');
      try {
        const claims = await this.tokens.verifyAccess(f.token);
        const row = await this.db.selectFrom('user_sessions as s').innerJoin('users as u', 'u.id', 's.user_id')
          .select(['s.revoked_at', 's.expires_at', 'u.status', 'u.status_until', 'u.token_version']).where('s.id', '=', claims.sessionId).where('s.user_id', '=', claims.userId).executeTakeFirst();
        if (!row || row.revoked_at || new Date(row.expires_at) <= new Date() || row.token_version !== claims.tokenVersion) throw new AppError('TOKEN_INVALID');
        assertUserCanAuthenticate(row.status, row.status_until);
        clearTimeout(timer);
        socket.userId = claims.userId;
        socket.sessionId = claims.sessionId;
        this.bus.register(claims.userId, socket);
        return this.send(socket, 'ready', { userId: claims.userId });
      } catch (err) {
        return socket.close(4401, err instanceof AppError ? err.code : 'auth failed');
      }
    }

    const parsed = wsClientFrame.safeParse(frame);
    if (!parsed.success) return this.send(socket, 'error', { code: 'VALIDATION_FAILED' });
    try {
      switch (parsed.data.type) {
        case 'ping':
          await this.bus.touch(socket.userId);
          return this.send(socket, 'pong', { at: new Date().toISOString() });
        case 'typing':
          return await this.chat.typing(socket.userId, parsed.data.conversationId, parsed.data.isTyping);
        case 'delivered':
          return await this.chat.markDelivered(socket.userId, parsed.data.conversationId, parsed.data.messageId);
      }
    } catch (err) {
      this.send(socket, 'error', { code: err instanceof AppError ? err.code : 'INTERNAL' });
      if (!(err instanceof AppError)) this.logger.warn(`ws frame failed: ${(err as Error).message}`);
    }
  }
}
