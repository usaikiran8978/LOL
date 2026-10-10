import { randomUUID } from 'node:crypto';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { SignJWT } from 'jose';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { DATABASE, type Database } from '../../common/db/database';
import { blockedEitherWay } from '../../common/db/relations';
import { AppError } from '../../common/errors/app-error';
import { JobScheduler } from '../../common/jobs/scheduler';
import { RealtimeBus } from '../../common/realtime/realtime-bus';
import { NotificationsService } from '../notifications/notifications.service';
import { FlagsService } from '../platform/flags.service';
import { UserFactsService } from '../platform/user-facts.service';

const RING_TIMEOUT_MS = 45_000;
const TOKEN_TTL_S = 2 * 3600;

/**
 * Voice & video calling between matches (BRD §11 "where enabled"). Media flows through a LiveKit-compatible SFU; the API
 * only authorizes, issues short-lived room tokens and signals ringing over the realtime channel. Calls never reveal
 * phone numbers; either side can end at any time; blocked/unmatched pairs cannot call.
 */
@Injectable()
export class CallsService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly bus: RealtimeBus,
    private readonly flags: FlagsService,
    private readonly facts: UserFactsService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
    private readonly jobs: JobScheduler,
  ) {}

  onModuleInit(): void {
    this.jobs.register('calls.missed', 30, async () => {
      const missed = await this.db.updateTable('calls').set({ status: 'missed', ended_at: new Date() }).where('status', '=', 'ringing').where('created_at', '<', new Date(Date.now() - RING_TIMEOUT_MS)).returning(['id', 'conversation_id']).execute();
      for (const c of missed) await this.signal(c.conversation_id, 'call.missed', { callId: c.id });
    });
  }

  private async members(conversationId: string) {
    return (await this.db.selectFrom('conversation_members').select('user_id').where('conversation_id', '=', conversationId).where('left_at', 'is', null).execute()).map((m) => m.user_id);
  }

  private async signal(conversationId: string, event: string, data: Record<string, unknown>) {
    // 'notification' frames are a generic channel the clients already listen on.
    await this.bus.publish(await this.members(conversationId), 'notification', { type: event, ...data });
  }

  private async token(userId: string, room: string, video: boolean): Promise<string> {
    const key = new TextEncoder().encode(this.cfg.LIVEKIT_API_SECRET!);
    return new SignJWT({ video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishSources: video ? ['camera', 'microphone'] : ['microphone'] }, name: userId })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer(this.cfg.LIVEKIT_API_KEY!).setSubject(userId).setNotBefore('0s').setExpirationTime(`${TOKEN_TTL_S}s`).setJti(randomUUID()).sign(key);
  }

  async start(userId: string, conversationId: string, kind: 'voice' | 'video') {
    await this.flags.assertEnabled(kind === 'video' ? 'video_calls' : 'voice_calls', await this.facts.load(userId));
    if (!this.cfg.LIVEKIT_URL || !this.cfg.LIVEKIT_API_KEY || !this.cfg.LIVEKIT_API_SECRET) throw new AppError('CALL_PROVIDER_NOT_CONFIGURED');
    const conv = await this.db.selectFrom('conversations as c').leftJoin('matches as m', 'm.id', 'c.match_id').select(['c.kind', 'c.status', 'm.status as match_status'])
      .where('c.id', '=', conversationId).executeTakeFirst();
    const members = await this.members(conversationId);
    if (!conv || !members.includes(userId) || conv.kind !== 'match') throw new AppError('NOT_FOUND');
    if (conv.status !== 'active' || conv.match_status !== 'active') throw new AppError('CONVERSATION_CLOSED');
    const other = members.find((m) => m !== userId)!;
    if (await blockedEitherWay(this.db, userId, other)) throw new AppError('CONVERSATION_CLOSED');
    const live = await this.db.selectFrom('calls').select('id').where('conversation_id', '=', conversationId).where('status', 'in', ['ringing', 'active']).executeTakeFirst();
    if (live) throw new AppError('CONFLICT', 'A call is already in progress', { callId: live.id });
    const room = `call_${randomUUID()}`;
    const call = await this.db.insertInto('calls').values({ conversation_id: conversationId, initiator_id: userId, kind, provider: 'livekit', provider_room_id: room }).returning('id').executeTakeFirstOrThrow();
    await this.signal(conversationId, 'call.incoming', { callId: call.id, conversationId, kind, from: userId });
    const name = (await this.db.selectFrom('user_profiles').select('display_name').where('user_id', '=', userId).executeTakeFirst())?.display_name ?? '';
    await this.notifications.notify(other, 'call.incoming', { name, kind }, { dedupeKey: `call:${call.id}`, deepLinkVars: { conversationId } });
    await this.analytics.track('call_started', { userId, properties: { kind } });
    return { callId: call.id, url: this.cfg.LIVEKIT_URL, token: await this.token(userId, room, kind === 'video') };
  }

  private async callFor(userId: string, callId: string) {
    const c = await this.db.selectFrom('calls').selectAll().where('id', '=', callId).executeTakeFirst();
    if (!c || !(await this.members(c.conversation_id)).includes(userId)) throw new AppError('NOT_FOUND');
    return c;
  }

  async accept(userId: string, callId: string) {
    const c = await this.callFor(userId, callId);
    if (c.initiator_id === userId) throw new AppError('CONFLICT', 'You started this call');
    if (c.status !== 'ringing') throw new AppError('CONFLICT', `Call is ${c.status}`);
    await this.db.updateTable('calls').set({ status: 'active', started_at: new Date() }).where('id', '=', callId).execute();
    // First voice/video contact is a journey milestone (BRD §16).
    const conv = await this.db.selectFrom('conversations').select('match_id').where('id', '=', c.conversation_id).executeTakeFirstOrThrow();
    if (conv.match_id) {
      await this.db.updateTable('relationship_journeys').set((eb) => ({ voice_video_at: new Date(), stage: eb.case().when('stage', 'in', ['matched', 'conversation']).then('voice_video').else(eb.ref('stage')).end() }))
        .where('match_id', '=', conv.match_id).where('voice_video_at', 'is', null).execute();
    }
    await this.signal(c.conversation_id, 'call.accepted', { callId });
    return { callId, url: this.cfg.LIVEKIT_URL, token: await this.token(userId, c.provider_room_id!, c.kind === 'video') };
  }

  async decline(userId: string, callId: string) {
    const c = await this.callFor(userId, callId);
    if (c.status !== 'ringing') throw new AppError('CONFLICT', `Call is ${c.status}`);
    await this.db.updateTable('calls').set({ status: 'declined', ended_at: new Date() }).where('id', '=', callId).execute();
    await this.signal(c.conversation_id, 'call.declined', { callId });
  }

  async end(userId: string, callId: string) {
    const c = await this.callFor(userId, callId);
    if (!['ringing', 'active'].includes(c.status)) return;
    await this.db.updateTable('calls').set({ status: c.status === 'ringing' ? 'missed' : 'ended', ended_at: new Date() }).where('id', '=', callId).execute();
    await this.signal(c.conversation_id, 'call.ended', { callId, by: userId });
  }
}
