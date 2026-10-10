import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { activeMatch, blockedEitherWay } from '../../common/db/relations';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../../common/http/cursor';
import type { ClientContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/outbox/outbox.service';
import { EntitlementsService } from '../platform/entitlements.service';
import { UserFactsService } from '../platform/user-facts.service';
import { RecommendationsService } from './recommendations.service';

const REWIND_WINDOW_MS = 24 * 3_600_000;

@Injectable()
export class SwipesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly entitlements: EntitlementsService,
    private readonly facts: UserFactsService,
    private readonly recs: RecommendationsService,
    private readonly outbox: OutboxService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
  ) {}

  private async assertCanAct(userId: string): Promise<void> {
    const r = await this.db.selectFrom('account_restrictions').select('kind').where('user_id', '=', userId).where('kind', 'in', ['no_likes', 'no_discovery']).where('lifted_at', 'is', null)
      .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', new Date())])).executeTakeFirst();
    if (r) throw new AppError('FORBIDDEN', 'Likes are restricted on this account');
    const u = await this.db.selectFrom('users').select('status').where('id', '=', userId).executeTakeFirstOrThrow();
    if (u.status !== 'active') throw new AppError('FORBIDDEN', 'Verify your account first');
  }

  /**
   * like / pass / super_like. Likes are metered server-side (free-tier allowance or entitlement); super likes spend
   * a consumable balance first, then the periodic allowance. A mutual like creates the match + conversation atomically.
   */
  async act(userId: string, input: { targetId: string; action: 'like' | 'pass' | 'super_like'; surface: string; candidateRowId?: string; comment?: string; likedItem?: { type: string; id: string } }) {
    if (input.targetId === userId) throw new AppError('VALIDATION_FAILED', 'Cannot act on yourself');
    await this.assertCanAct(userId);
    const target = await this.db.selectFrom('users as u').innerJoin('user_profiles as p', 'p.user_id', 'u.id').select(['u.status', 'p.is_discoverable']).where('u.id', '=', input.targetId).executeTakeFirst();
    if (!target || target.status !== 'active' || (await blockedEitherWay(this.db, userId, input.targetId))) throw new AppError('NOT_FOUND');
    const likedMe = await this.activeLike(input.targetId, userId);
    if (!target.is_discoverable && !likedMe) throw new AppError('NOT_FOUND');
    if (input.comment && input.action === 'pass') throw new AppError('VALIDATION_FAILED', 'Comments only accompany likes');
    const facts = await this.facts.load(userId);

    const result = await this.db.transaction().execute(async (trx) => {
      // Serialize actions on the same pair so two simultaneous mutual likes cannot both miss the match.
      const pair = userId < input.targetId ? `${userId}:${input.targetId}` : `${input.targetId}:${userId}`;
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${pair}, 0))`.execute(trx);
      const existing = await trx.selectFrom('swipe_actions').select(['id', 'action']).where('actor_id', '=', userId).where('target_id', '=', input.targetId).where('rewound_at', 'is', null).forUpdate().executeTakeFirst();
      if (existing) throw new AppError('CONFLICT', 'Already acted on this profile', { action: existing.action });

      if (input.action === 'like') await this.entitlements.consume(trx, userId, 'likes', facts.countryCode);
      if (input.action === 'super_like') await this.spendSuperLike(trx, userId, facts.countryCode);

      const swipe = await trx.insertInto('swipe_actions').values({
        actor_id: userId, target_id: input.targetId, action: input.action, surface: input.surface, candidate_id: input.candidateRowId ?? null,
        comment: input.comment ?? null, liked_item: input.likedItem ? JSON.stringify(input.likedItem) : null,
      }).returning('id').executeTakeFirstOrThrow();
      await trx.updateTable('match_candidates').set({ acted_at: new Date() }).where('user_id', '=', userId).where('candidate_id', '=', input.targetId).where('acted_at', 'is', null).execute();
      await trx.insertInto('recommendation_feedback').values({ user_id: userId, candidate_id: input.targetId, candidate_row_id: input.candidateRowId ?? null, outcome: input.action === 'pass' ? 'rejected' : 'accepted' }).execute();

      let match: { id: string; conversationId: string } | null = null;
      if (input.action !== 'pass' && (await this.activeLike(input.targetId, userId, trx))) match = await this.createMatch(trx, userId, input.targetId, input.surface);
      if (input.action !== 'pass') {
        await this.outbox.enqueue(trx, match ? 'match.created' : 'like.received', match ? { matchId: match.id, userIds: [userId, input.targetId] } : { fromUserId: userId, toUserId: input.targetId, superLike: input.action === 'super_like' }, { aggregateId: input.targetId });
      }
      return { swipeId: swipe.id, match };
    });

    const name = input.action === 'like' ? 'like_sent' : input.action === 'pass' ? 'pass_sent' : 'super_like_sent';
    await this.analytics.track(name, { userId, properties: { surface: input.surface } });
    await this.analytics.track(input.action === 'pass' ? 'recommendation_rejected' : 'recommendation_accepted', { userId, properties: { surface: input.surface } });
    if (result.match) await this.analytics.track('match_created', { userId, properties: { surface: input.surface } });
    return { action: input.action, matched: !!result.match, matchId: result.match?.id ?? null, conversationId: result.match?.conversationId ?? null };
  }

  private async spendSuperLike(trx: Tx, userId: string, countryCode: string | null): Promise<void> {
    const bal = await trx.updateTable('consumable_balances').set((eb) => ({ balance: eb('balance', '-', 1), updated_at: new Date() }))
      .where('user_id', '=', userId).where('item_key', '=', 'super_like').where('balance', '>', 0).returning('balance').executeTakeFirst();
    if (bal) {
      await trx.insertInto('consumable_ledger').values({ user_id: userId, item_key: 'super_like', delta: -1, reason: 'consume' }).execute();
      return;
    }
    await this.entitlements.consume(trx, userId, 'super_likes', countryCode);
  }

  private activeLike(actor: string, target: string, trx: Tx | Database = this.db) {
    return trx.selectFrom('swipe_actions').select('id').where('actor_id', '=', actor).where('target_id', '=', target).where('action', 'in', ['like', 'super_like']).where('rewound_at', 'is', null).executeTakeFirst();
  }

  private async createMatch(trx: Tx, a: string, b: string, surface: string) {
    const [low, high] = a < b ? [a, b] : [b, a];
    const rec = await trx.selectFrom('match_candidates').select('compatibility').where((eb) => eb.or([eb.and([eb('user_id', '=', a), eb('candidate_id', '=', b)]), eb.and([eb('user_id', '=', b), eb('candidate_id', '=', a)])])).orderBy('computed_at', 'desc').limit(1).executeTakeFirst();
    const match = await trx.insertInto('matches').values({ user_low_id: low, user_high_id: high, surface, compatibility: rec?.compatibility ?? null }).returning('id').executeTakeFirstOrThrow();
    const conv = await trx.insertInto('conversations').values({ kind: 'match', match_id: match.id }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('conversation_members').values([{ conversation_id: conv.id, user_id: low }, { conversation_id: conv.id, user_id: high }]).execute();
    await trx.insertInto('relationship_journeys').values({ match_id: match.id }).execute();
    return { id: match.id, conversationId: conv.id };
  }

  /** Undo the most recent swipe within 24h (premium `rewind` or free-tier `rewinds` allowance). Never undoes a match. */
  async rewind(userId: string) {
    const facts = await this.facts.load(userId);
    return this.db.transaction().execute(async (trx) => {
      const last = await trx.selectFrom('swipe_actions').select(['id', 'target_id', 'action', 'created_at']).where('actor_id', '=', userId).where('rewound_at', 'is', null).orderBy('created_at', 'desc').limit(1).forUpdate().executeTakeFirst();
      if (!last || Date.now() - new Date(last.created_at).getTime() > REWIND_WINDOW_MS) throw new AppError('NOT_FOUND', 'Nothing to rewind');
      if (await activeMatch(trx, userId, last.target_id)) throw new AppError('CONFLICT', 'Cannot rewind a match; unmatch instead');
      if (!(await this.entitlements.has(userId, 'rewind'))) await this.entitlements.consume(trx, userId, 'rewinds', facts.countryCode);
      await trx.updateTable('swipe_actions').set({ rewound_at: new Date() }).where('id', '=', last.id).execute();
      if (last.action === 'like') await this.entitlements.refund(trx, userId, 'likes');
      // Put the card back at the top of the swipe feed.
      await trx.updateTable('match_candidates').set({ acted_at: null, served_at: null, expires_at: new Date(Date.now() + 86_400_000), rank: -1 }).where('user_id', '=', userId).where('candidate_id', '=', last.target_id).where('surface', '=', 'swipe').execute();
      await this.analytics.track('rewind_used', { userId }, trx);
      return { rewoundTargetId: last.target_id, action: last.action };
    });
  }

  async feedback(userId: string, candidateId: string, outcome: 'accepted' | 'rejected' | 'hidden', reasonKey?: string) {
    await this.db.insertInto('recommendation_feedback').values({ user_id: userId, candidate_id: candidateId, outcome, reason_key: reasonKey ?? null }).execute();
    if (outcome === 'hidden') await this.db.updateTable('match_candidates').set({ acted_at: new Date() }).where('user_id', '=', userId).where('candidate_id', '=', candidateId).where('acted_at', 'is', null).execute();
    await this.analytics.track(outcome === 'accepted' ? 'recommendation_accepted' : 'recommendation_rejected', { userId, properties: { reason: reasonKey ?? null } });
  }

  /** People who liked me. Full cards need `see_who_liked`; otherwise only a count + blurred placeholders. */
  async likesReceived(userId: string, locale: string, limit: number, cursor?: string) {
    const base = this.db
      .selectFrom('swipe_actions as s')
      .innerJoin('users as u', 'u.id', 's.actor_id')
      .where('s.target_id', '=', userId)
      .where('s.action', 'in', ['like', 'super_like'])
      .where('s.rewound_at', 'is', null)
      .where('u.status', '=', 'active')
      .where((eb) => eb.not(eb.exists(eb.selectFrom('swipe_actions as mine').select(sql`1`.as('x')).where('mine.actor_id', '=', userId).whereRef('mine.target_id', '=', 's.actor_id').where('mine.rewound_at', 'is', null))))
      .where((eb) => eb.not(eb.exists(eb.selectFrom('blocks as b').select(sql`1`.as('x')).where((x) => x.or([x.and([x('b.blocker_id', '=', userId), x('b.blocked_id', '=', x.ref('s.actor_id'))]), x.and([x('b.blocked_id', '=', userId), x('b.blocker_id', '=', x.ref('s.actor_id'))])])))));
    const { total } = await base.select(sql<number>`count(*)::int`.as('total')).executeTakeFirstOrThrow();
    if (!(await this.entitlements.has(userId, 'see_who_liked'))) return { total, items: [], nextCursor: null, locked: true };

    const c = decodeCursor<[string, string]>(cursor, 2);
    let qb = base.select(['s.id', 's.actor_id', 's.action', 's.comment', 's.created_at']).orderBy('s.created_at', 'desc').orderBy('s.id', 'desc').limit(limit + 1);
    if (c) qb = qb.where((eb) => eb.or([eb('s.created_at', '<', new Date(c[0])), eb.and([eb('s.created_at', '=', new Date(c[0])), eb('s.id', '<', c[1])])]));
    const rows = await qb.execute();
    const page = rows.slice(0, limit);
    const cards = await this.recs.cards(userId, page.map((r) => ({ id: r.id, candidate_id: r.actor_id, compatibility: 0, confidence: 0, factor_scores: {}, top_factors: [], differences: [], surface: 'likes' })), locale, false);
    return {
      total,
      locked: false,
      items: page.map((r, i) => ({ likeId: r.id, superLike: r.action === 'super_like', comment: r.comment, likedAt: new Date(r.created_at).toISOString(), profile: { ...cards[i]!, compatibility: null, confidence: null, topFactors: [] } })),
      nextCursor: rows.length > limit ? encodeCursor([new Date(page.at(-1)!.created_at).toISOString(), page.at(-1)!.id]) : null,
    };
  }

  /** Profiles the member liked or super-liked (not rewound), newest first, with whether each became a match. */
  async likesSent(userId: string, locale: string, limit: number, cursor?: string) {
    const c = decodeCursor<[string, string]>(cursor, 2);
    let qb = this.db
      .selectFrom('swipe_actions as s')
      .innerJoin('users as u', 'u.id', 's.target_id')
      .select(['s.id', 's.target_id', 's.action', 's.created_at'])
      .where('s.actor_id', '=', userId)
      .where('s.action', 'in', ['like', 'super_like'])
      .where('s.rewound_at', 'is', null)
      .where('u.status', '=', 'active')
      .where((eb) => eb.not(eb.exists(eb.selectFrom('blocks as b').select(sql`1`.as('x')).where((x) => x.or([x.and([x('b.blocker_id', '=', userId), x('b.blocked_id', '=', x.ref('s.target_id'))]), x.and([x('b.blocked_id', '=', userId), x('b.blocker_id', '=', x.ref('s.target_id'))])])))))
      .orderBy('s.created_at', 'desc')
      .orderBy('s.id', 'desc')
      .limit(limit + 1);
    if (c) qb = qb.where((eb) => eb.or([eb('s.created_at', '<', new Date(c[0])), eb.and([eb('s.created_at', '=', new Date(c[0])), eb('s.id', '<', c[1])])]));
    const rows = await qb.execute();
    const page = rows.slice(0, limit);
    const targets = page.map((r) => r.target_id);
    const [cards, matches, favorites] = await Promise.all([
      this.recs.cards(userId, page.map((r) => ({ id: r.id, candidate_id: r.target_id, compatibility: 0, confidence: 0, factor_scores: {}, top_factors: [], differences: [], surface: 'likes' })), locale, false),
      targets.length
        ? this.db.selectFrom('matches as m').innerJoin('conversations as cv', 'cv.match_id', 'm.id').select(['m.id', 'm.user_low_id', 'm.user_high_id', 'cv.id as conversation_id']).where('m.status', '=', 'active')
            .where((eb) => eb.or([eb.and([eb('m.user_low_id', '=', userId), eb('m.user_high_id', 'in', targets)]), eb.and([eb('m.user_high_id', '=', userId), eb('m.user_low_id', 'in', targets)])])).execute()
        : Promise.resolve([]),
      this.favoriteSet(userId, targets),
    ]);
    return {
      items: page.map((r, i) => {
        const m = matches.find((x) => x.user_low_id === r.target_id || x.user_high_id === r.target_id);
        return {
          likeId: r.id, superLike: r.action === 'super_like', likedAt: new Date(r.created_at).toISOString(),
          matched: !!m, matchId: m?.id ?? null, conversationId: m?.conversation_id ?? null, favorited: favorites.has(r.target_id),
          profile: { ...cards[i]!, compatibility: null, confidence: null, topFactors: [] },
        };
      }),
      nextCursor: rows.length > limit ? encodeCursor([new Date(page.at(-1)!.created_at).toISOString(), page.at(-1)!.id]) : null,
    };
  }

  // -------------------------------------------------------------------------------------------- favourites

  /** The member's private favourites list (never shown to the favourited person), newest first. */
  async listFavorites(userId: string, locale: string, limit: number, cursor?: string) {
    const c = decodeCursor<[string, string]>(cursor, 2);
    let qb = this.db
      .selectFrom('user_favorites as f')
      .innerJoin('users as u', 'u.id', 'f.target_id')
      .select(['f.target_id', 'f.created_at'])
      .where('f.user_id', '=', userId)
      .where('u.status', '=', 'active')
      .where((eb) => eb.not(eb.exists(eb.selectFrom('blocks as b').select(sql`1`.as('x')).where((x) => x.or([x.and([x('b.blocker_id', '=', userId), x('b.blocked_id', '=', x.ref('f.target_id'))]), x.and([x('b.blocked_id', '=', userId), x('b.blocker_id', '=', x.ref('f.target_id'))])])))))
      .orderBy('f.created_at', 'desc')
      .orderBy('f.target_id', 'desc')
      .limit(limit + 1);
    if (c) qb = qb.where((eb) => eb.or([eb('f.created_at', '<', new Date(c[0])), eb.and([eb('f.created_at', '=', new Date(c[0])), eb('f.target_id', '<', c[1])])]));
    const rows = await qb.execute();
    const page = rows.slice(0, limit);
    const targets = page.map((r) => r.target_id);
    const [cards, liked, matched] = await Promise.all([
      this.recs.cards(userId, page.map((r) => ({ id: r.target_id, candidate_id: r.target_id, compatibility: 0, confidence: 0, factor_scores: {}, top_factors: [], differences: [], surface: 'favorites' })), locale, false),
      targets.length ? this.db.selectFrom('swipe_actions').select('target_id').where('actor_id', '=', userId).where('target_id', 'in', targets).where('action', 'in', ['like', 'super_like']).where('rewound_at', 'is', null).execute() : Promise.resolve([]),
      targets.length
        ? this.db.selectFrom('matches').select(['user_low_id', 'user_high_id']).where('status', '=', 'active').where((eb) => eb.or([eb.and([eb('user_low_id', '=', userId), eb('user_high_id', 'in', targets)]), eb.and([eb('user_high_id', '=', userId), eb('user_low_id', 'in', targets)])])).execute()
        : Promise.resolve([]),
    ]);
    const likedSet = new Set(liked.map((l) => l.target_id));
    const matchedSet = new Set(matched.flatMap((m) => [m.user_low_id, m.user_high_id]));
    return {
      items: page.map((r, i) => ({
        favoritedAt: new Date(r.created_at).toISOString(), liked: likedSet.has(r.target_id), matched: matchedSet.has(r.target_id),
        profile: { ...cards[i]!, compatibility: null, confidence: null, topFactors: [] },
      })),
      nextCursor: rows.length > limit ? encodeCursor([new Date(page.at(-1)!.created_at).toISOString(), page.at(-1)!.target_id]) : null,
    };
  }

  /** Idempotent. Unknown, inactive or blocked (either way) targets are NOT_FOUND, so a block is never revealed. */
  async addFavorite(userId: string, targetId: string): Promise<void> {
    if (targetId === userId) throw new AppError('VALIDATION_FAILED', 'You cannot favourite yourself');
    const target = await this.db.selectFrom('users').select('status').where('id', '=', targetId).executeTakeFirst();
    if (!target || target.status !== 'active' || (await blockedEitherWay(this.db, userId, targetId))) throw new AppError('NOT_FOUND');
    await this.db.insertInto('user_favorites').values({ user_id: userId, target_id: targetId }).onConflict((oc) => oc.columns(['user_id', 'target_id']).doNothing()).execute();
  }

  /** Idempotent: removing something that is not a favourite is not an error. */
  async removeFavorite(userId: string, targetId: string): Promise<void> {
    await this.db.deleteFrom('user_favorites').where('user_id', '=', userId).where('target_id', '=', targetId).execute();
  }

  async favoriteSet(userId: string, targetIds: string[]): Promise<Set<string>> {
    if (!targetIds.length) return new Set();
    const rows = await this.db.selectFrom('user_favorites').select('target_id').where('user_id', '=', userId).where('target_id', 'in', targetIds).execute();
    return new Set(rows.map((r) => r.target_id));
  }

  async listMatches(userId: string, locale: string, limit: number, cursor?: string) {
    const c = decodeCursor<[string, string]>(cursor, 2);
    let qb = this.db
      .selectFrom('matches as m')
      .innerJoin('conversations as cv', 'cv.match_id', 'm.id')
      .leftJoin('relationship_journeys as j', 'j.match_id', 'm.id')
      .select(['m.id', 'm.user_low_id', 'm.user_high_id', 'm.created_at', 'm.compatibility', 'cv.id as conversation_id', 'cv.last_message_at', 'j.stage'])
      .where('m.status', '=', 'active')
      .where((eb) => eb.or([eb('m.user_low_id', '=', userId), eb('m.user_high_id', '=', userId)]))
      .orderBy(sql`coalesce(cv.last_message_at, m.created_at)`, 'desc')
      .orderBy('m.id', 'desc')
      .limit(limit + 1);
    if (c) qb = qb.where((eb) => eb.or([eb(sql`coalesce(cv.last_message_at, m.created_at)`, '<', new Date(c[0])), eb.and([eb(sql`coalesce(cv.last_message_at, m.created_at)`, '=', new Date(c[0])), eb('m.id', '<', c[1])])]));
    const rows = await qb.execute();
    const page = rows.slice(0, limit);
    const partner = (r: (typeof page)[number]) => (r.user_low_id === userId ? r.user_high_id : r.user_low_id);
    const cards = await this.recs.cards(userId, page.map((r) => ({ id: r.id, candidate_id: partner(r), compatibility: r.compatibility ?? 0, confidence: 0, factor_scores: {}, top_factors: [], differences: [], surface: 'match' })), locale, false);
    const last = page.length
      ? await this.db.selectFrom('messages').select(['conversation_id', 'body', 'kind', 'sender_id', 'created_at']).distinctOn('conversation_id').where('conversation_id', 'in', page.map((p) => p.conversation_id)).where('deleted_at', 'is', null).where('moderation_status', 'in', ['clean', 'pending']).orderBy('conversation_id').orderBy('created_at', 'desc').execute()
      : [];
    const sortKey = (r: (typeof page)[number]) => new Date(r.last_message_at ?? r.created_at).toISOString();
    return {
      items: page.map((r, i) => {
        const lm = last.find((l) => l.conversation_id === r.conversation_id);
        return {
          matchId: r.id, conversationId: r.conversation_id, matchedAt: new Date(r.created_at).toISOString(), stage: r.stage, compatibility: r.compatibility === null ? null : Number(r.compatibility),
          partner: { userId: cards[i]!.userId, displayName: cards[i]!.displayName, age: cards[i]!.age, photo: cards[i]!.photos[0] ?? null, verified: cards[i]!.verified },
          lastMessage: lm ? { kind: lm.kind, preview: lm.kind === 'text' ? (lm.body ?? '').slice(0, 120) : null, fromMe: lm.sender_id === userId, at: new Date(lm.created_at).toISOString() } : null,
        };
      }),
      nextCursor: rows.length > limit ? encodeCursor([sortKey(page.at(-1)!), page.at(-1)!.id]) : null,
    };
  }

  async unmatch(userId: string, matchId: string, client: ClientContext) {
    const m = await this.db.selectFrom('matches').selectAll().where('id', '=', matchId).where('status', '=', 'active').where((eb) => eb.or([eb('user_low_id', '=', userId), eb('user_high_id', '=', userId)])).executeTakeFirst();
    if (!m) throw new AppError('NOT_FOUND');
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('matches').set({ status: 'unmatched', ended_at: new Date(), ended_by: userId }).where('id', '=', matchId).execute();
      await trx.updateTable('conversations').set({ status: 'closed' }).where('match_id', '=', matchId).execute();
      await trx.updateTable('relationship_journeys').set({ stage: 'ended', ended_at: new Date() }).where('match_id', '=', matchId).execute();
      await this.outbox.enqueue(trx, 'match.ended', { matchId, by: userId }, { aggregateId: matchId });
      await this.audit.record({ actorType: 'user', actorId: userId, action: 'match.unmatched', targetType: 'match', targetId: matchId, client }, trx);
    });
    await this.analytics.track('unmatched', { userId });
  }
}
