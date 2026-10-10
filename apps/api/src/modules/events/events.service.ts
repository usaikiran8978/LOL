import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { z } from 'zod';
import type { adminEventCreate, adminEventUpdate, eventCreate, eventFeedback, eventsQuery } from '@amora/shared';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { AuditService } from '../../common/audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { hmac } from '../../common/crypto/tokens';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { geohashEncode } from '../../common/geo/geo';
import { decodeCursor, encodeCursor, iso, keysetPage } from '../../common/http/cursor';
import { localeChain } from '../../common/i18n/translations';
import { JobScheduler } from '../../common/jobs/scheduler';
import { OutboxService } from '../../common/outbox/outbox.service';
import { RealtimeBus } from '../../common/realtime/realtime-bus';
import { ageOn } from '../auth/age';
import { AiGatewayService } from '../ai/ai-gateway.service';
import { BillingService } from '../billing/billing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EntitlementsService } from '../platform/entitlements.service';
import { FlagsService } from '../platform/flags.service';
import { UserFactsService } from '../platform/user-facts.service';
import { TextModerationService } from '../safety/text-moderation';

const CHECK_IN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Events & real-world experiences (BRD §13). */
@Injectable()
export class EventsService implements OnModuleInit {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly flags: FlagsService,
    private readonly facts: UserFactsService,
    private readonly entitlements: EntitlementsService,
    private readonly billing: BillingService,
    private readonly moderation: TextModerationService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly bus: RealtimeBus,
    private readonly jobs: JobScheduler,
    private readonly ai: AiGatewayService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('billing.event_ticket_paid', async (p) => {
      if (!p.paid) return;
      await this.confirmPaidRegistration(String(p.eventId), String(p.userId), String(p.paymentIntent), Number(p.amountMinor), String(p.currency));
    });
    this.jobs.register('events.reminders', 900, () => this.reminders());
    this.jobs.register('events.complete', 3600, async () => {
      const done = await this.db.updateTable('events').set({ status: 'completed' }).where('status', '=', 'published').where('ends_at', '<', new Date()).returning('id').execute();
      if (done.length) {
        await this.db.updateTable('event_attendees').set({ status: 'no_show' }).where('event_id', 'in', done.map((d) => d.id)).where('status', '=', 'registered').execute();
        await this.db.updateTable('conversations').set({ status: 'closed' }).where('event_id', 'in', done.map((d) => d.id)).execute();
      }
    });
  }

  private async gate(userId: string) {
    await this.flags.assertEnabled('events', await this.facts.load(userId));
  }

  /**
   * Per-attendee check-in code derived with a server secret: nothing to store or leak, the attendee can always see it
   * (including after a waitlist promotion) and the organizer's scan is verified by recomputing it.
   */
  checkInCode(eventId: string, userId: string): string {
    const mac = hmac(this.cfg.SIGNING_SECRET, `checkin:${eventId}:${userId}`);
    return Array.from({ length: 6 }, (_, i) => CHECK_IN_ALPHABET[mac[i]! % CHECK_IN_ALPHABET.length]).join('');
  }

  async list(userId: string, q: z.infer<typeof eventsQuery>, locale: string) {
    await this.gate(userId);
    const c = decodeCursor<[string, string]>(q.cursor, 2);
    const me = await this.db.selectFrom('users as u').leftJoin('user_profiles as p', 'p.user_id', 'u.id').select(['u.date_of_birth', 'u.country_code', 'p.city_id']).where('u.id', '=', userId).executeTakeFirstOrThrow();
    const age = me.date_of_birth ? ageOn(String(me.date_of_birth)) : null;
    const premium = await this.entitlements.has(userId, 'advanced_filters');
    let qb = this.db.selectFrom('events as e').innerJoin('cities as c', 'c.id', 'e.city_id').innerJoin('taxonomy_terms as t', 't.id', 'e.category_term_id')
      .select(['e.id', 'e.title', 'e.description', 'e.starts_at', 'e.ends_at', 'e.timezone', 'e.capacity', 'e.price_minor', 'e.currency', 'e.is_online', 'e.visibility', 'e.pre_event_matching', 'e.organizer_type', 'e.status',
        'c.name as city', 'c.country_code', 't.key as category_key', 'e.cover_media_key',
        sql<number>`(SELECT count(*)::int FROM event_attendees a WHERE a.event_id = e.id AND a.status IN ('registered','checked_in'))`.as('attending'),
        sql<string | null>`(SELECT a.status FROM event_attendees a WHERE a.event_id = e.id AND a.user_id = ${userId})`.as('my_status')])
      .orderBy('e.starts_at').orderBy('e.id').limit(q.limit + 1);
    if (q.mine) qb = qb.where((eb) => eb.or([eb('e.organizer_user_id', '=', userId), eb.exists(eb.selectFrom('event_attendees as a').select(sql`1`.as('x')).whereRef('a.event_id', '=', 'e.id').where('a.user_id', '=', userId).where('a.status', 'not in', ['cancelled', 'removed']))]));
    else {
      qb = qb.where('e.status', '=', 'published').where('e.visibility', '<>', 'unlisted').where('e.ends_at', '>', new Date());
      if (!premium) qb = qb.where('e.visibility', '<>', 'premium_only');
      if (age !== null) qb = qb.where((eb) => eb.and([eb.or([eb('e.min_age', 'is', null), eb('e.min_age', '<=', age)]), eb.or([eb('e.max_age', 'is', null), eb('e.max_age', '>=', age)])]));
    }
    if (q.cityId) qb = qb.where('e.city_id', '=', q.cityId);
    else if (q.country) qb = qb.where('c.country_code', '=', q.country);
    else if (!q.mine && me.city_id) qb = qb.where('e.city_id', '=', me.city_id);
    if (q.categoryKey) qb = qb.where('t.key', '=', q.categoryKey);
    if (q.interestId) qb = qb.where((eb) => eb.exists(eb.selectFrom('event_interests as ei').select(sql`1`.as('x')).whereRef('ei.event_id', '=', 'e.id').where('ei.interest_id', '=', q.interestId!)));
    if (q.from) qb = qb.where('e.starts_at', '>=', new Date(q.from));
    if (q.to) qb = qb.where('e.starts_at', '<=', new Date(q.to));
    if (c) qb = qb.where((eb) => eb.or([eb('e.starts_at', '>', new Date(c[0])), eb.and([eb('e.starts_at', '=', new Date(c[0])), eb('e.id', '>', c[1])])]));
    const rows = await qb.execute();
    const page = rows.slice(0, q.limit);
    // Interest overlap gives each event a simple, explainable fit score.
    const mine = new Set((await this.db.selectFrom('user_interests').select('interest_id').where('user_id', '=', userId).execute()).map((i) => i.interest_id));
    const ei = page.length ? await this.db.selectFrom('event_interests').select(['event_id', 'interest_id']).where('event_id', 'in', page.map((p) => p.id)).execute() : [];
    const catLabels = new Map((await this.db.selectFrom('taxonomy_terms as t').innerJoin('taxonomy_term_translations as tr', 'tr.term_id', 't.id').select(['t.key', 'tr.locale', 'tr.label'])
      .where('t.kind', '=', 'event_category').where('tr.locale', 'in', localeChain(locale)).execute()).reverse().map((r) => [r.key, r.label]));
    return {
      items: page.map((e) => {
        const tags = ei.filter((x) => x.event_id === e.id);
        const overlap = tags.filter((x) => mine.has(x.interest_id)).length;
        return {
          id: e.id, title: e.title, category: { key: e.category_key, label: catLabels.get(e.category_key) ?? e.category_key }, city: e.city, countryCode: e.country_code,
          startsAt: new Date(e.starts_at).toISOString(), endsAt: new Date(e.ends_at).toISOString(), timezone: e.timezone, isOnline: e.is_online,
          capacity: e.capacity, attending: e.attending, spotsLeft: e.capacity ? Math.max(0, e.capacity - e.attending) : null,
          price: Number(e.price_minor) > 0 ? { amountMinor: Number(e.price_minor), currency: e.currency } : null, preEventMatching: e.pre_event_matching, status: e.status, myStatus: e.my_status,
          fit: tags.length ? Math.round((overlap / tags.length) * 100) : null, sharedInterestCount: overlap,
        };
      }),
      nextCursor: rows.length > q.limit ? encodeCursor([new Date(page.at(-1)!.starts_at).toISOString(), page.at(-1)!.id]) : null,
    };
  }

  /**
   * Recommended events: AI picks + one-line reasons when the event_recommendation feature is configured and the user
   * consented; otherwise (or if AI is unavailable) a transparent interest-fit ranking. Never fails because AI is down.
   */
  async recommended(userId: string, locale: string) {
    const page = await this.list(userId, { limit: 30, to: new Date(Date.now() + 30 * 86_400_000).toISOString() }, locale);
    const candidates = page.items.filter((e) => !e.myStatus);
    const byFit = [...candidates].sort((a, b) => (b.fit ?? 0) - (a.fit ?? 0) || a.startsAt.localeCompare(b.startsAt)).slice(0, 5);
    try {
      const interests = (await this.db.selectFrom('user_interests as ui').innerJoin('interest_translations as t', (j) => j.onRef('t.interest_id', '=', 'ui.interest_id').on('t.locale', '=', 'en')).select('t.label').where('ui.user_id', '=', userId).execute()).map((r) => r.label).join(', ');
      const r = await this.ai.run<{ picks: Array<{ eventId: string; reason: string }> }>('event_recommendation', {
        locale, interests, intent: '', events: candidates.map((e) => `${e.id} | ${e.title} | ${e.category.label} | ${e.startsAt}`).join('\n'),
      }, { userId, trusted: ['locale', 'interests', 'intent'] });
      const picks = r.output.picks.filter((p) => candidates.some((c) => c.id === p.eventId)); // only ids we offered
      if (picks.length) return { source: 'ai', items: picks.map((p) => ({ ...candidates.find((c) => c.id === p.eventId)!, reason: p.reason })) };
    } catch {
      // fall through to the deterministic ranking
    }
    return { source: 'interest_fit', items: byFit.map((e) => ({ ...e, reason: null })) };
  }

  async get(userId: string, eventId: string) {
    await this.gate(userId);
    const e = await this.db.selectFrom('events as e').innerJoin('cities as c', 'c.id', 'e.city_id').innerJoin('taxonomy_terms as t', 't.id', 'e.category_term_id')
      .selectAll('e').select(['c.name as city', 't.key as category_key']).where('e.id', '=', eventId).executeTakeFirst();
    if (!e) throw new AppError('NOT_FOUND');
    const mine = await this.db.selectFrom('event_attendees').selectAll().where('event_id', '=', eventId).where('user_id', '=', userId).executeTakeFirst();
    const organizer = e.organizer_user_id === userId;
    if (e.status !== 'published' && !organizer && !mine) throw new AppError('NOT_FOUND');
    const attending = mine && ['registered', 'checked_in'].includes(mine.status);
    const { n } = await this.db.selectFrom('event_attendees').select(sql<number>`count(*)::int`.as('n')).where('event_id', '=', eventId).where('status', 'in', ['registered', 'checked_in']).executeTakeFirstOrThrow();
    const conv = attending || organizer ? await this.db.selectFrom('conversations').select('id').where('event_id', '=', eventId).executeTakeFirst() : undefined;
    await this.analytics.track('event_viewed', { userId });
    return {
      id: e.id, title: e.title, description: e.description, category: e.category_key, city: e.city, startsAt: new Date(e.starts_at).toISOString(), endsAt: new Date(e.ends_at).toISOString(),
      timezone: e.timezone, isOnline: e.is_online, status: e.status, capacity: e.capacity, attending: n, spotsLeft: e.capacity ? Math.max(0, e.capacity - n) : null,
      price: Number(e.price_minor) > 0 ? { amountMinor: Number(e.price_minor), currency: e.currency } : null, preEventMatching: e.pre_event_matching, chatEnabled: e.chat_enabled,
      // Exact venue only for confirmed attendees and the organizer (BRD privacy; MP §19).
      venue: attending || organizer ? { name: e.venue_name, address: e.venue_address } : { name: e.venue_name ? e.venue_name.split(',')[0] : null, address: null },
      isOrganizer: organizer, myStatus: mine?.status ?? null, myCheckInCode: attending ? this.checkInCode(eventId, userId) : null, conversationId: conv?.id ?? null, moderationNote: organizer ? e.moderation_note : null,
    };
  }

  async create(userId: string, input: z.infer<typeof eventCreate>) {
    await this.gate(userId);
    const u = await this.db.selectFrom('users').select('status').where('id', '=', userId).executeTakeFirstOrThrow();
    if (u.status !== 'active') throw new AppError('FORBIDDEN', 'Verify your account to host events');
    const restricted = await this.db.selectFrom('account_restrictions').select('id').where('user_id', '=', userId).where('kind', '=', 'no_events').where('lifted_at', 'is', null).executeTakeFirst();
    if (restricted) throw new AppError('FORBIDDEN', 'Event hosting is restricted on this account');
    if (new Date(input.startsAt) < new Date(Date.now() + 3_600_000)) throw new AppError('VALIDATION_FAILED', 'Events must start at least an hour from now');
    const cat = await this.db.selectFrom('taxonomy_terms').select('id').where('kind', '=', 'event_category').where('key', '=', input.categoryKey).where('is_active', '=', true).executeTakeFirst();
    if (!cat) throw new AppError('VALIDATION_FAILED', 'Unknown category', [{ path: 'categoryKey', message: 'unknown' }]);
    const city = await this.db.selectFrom('cities').select(['id', 'geohash5']).where('id', '=', input.cityId).executeTakeFirst();
    if (!city) throw new AppError('VALIDATION_FAILED', 'Unknown city');
    const scan = await this.moderation.scan('event', `${input.title}\n${input.description}`);
    if (scan.action === 'hide') throw new AppError('MESSAGE_BLOCKED', 'This event violates our community guidelines');
    return this.db.transaction().execute(async (trx) => {
      // Community-created events are reviewed before they become discoverable; user events are free (paid events are platform/partner).
      const e = await trx.insertInto('events').values({
        organizer_type: 'user', organizer_user_id: userId, category_term_id: cat.id, title: input.title, description: input.description, city_id: city.id,
        venue_name: input.venueName ?? null, venue_address: input.venueAddress ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null,
        geohash5: input.latitude !== undefined && input.longitude !== undefined ? geohashEncode(input.latitude, input.longitude, 5) : city.geohash5, is_online: input.isOnline,
        starts_at: new Date(input.startsAt), ends_at: new Date(input.endsAt), timezone: input.timezone, capacity: input.capacity ?? null, min_age: input.minAge ?? null, max_age: input.maxAge ?? null,
        visibility: input.visibility === 'premium_only' ? 'public' : input.visibility, pre_event_matching: input.preEventMatching, chat_enabled: input.chatEnabled, status: 'pending_review',
        moderation_note: scan.action === 'warn' ? `auto-flag: ${scan.matchedRules.join(',')}` : null,
      }).returning('id').executeTakeFirstOrThrow();
      if (input.interestIds.length) await trx.insertInto('event_interests').values(input.interestIds.map((interest_id) => ({ event_id: e.id, interest_id }))).onConflict((oc) => oc.doNothing()).execute();
      await this.registerInTx(trx, e.id, userId, 'registered', null, true);
      return { id: e.id, status: 'pending_review' };
    });
  }

  async cancelEvent(userId: string, eventId: string) {
    const e = await this.db.selectFrom('events').select(['organizer_user_id', 'status', 'title', 'price_minor']).where('id', '=', eventId).executeTakeFirst();
    if (!e || e.organizer_user_id !== userId) throw new AppError('NOT_FOUND');
    if (['cancelled', 'completed'].includes(e.status)) throw new AppError('CONFLICT', `Event is ${e.status}`);
    await this.cancelAndNotify(eventId, e.title);
  }

  async cancelAndNotify(eventId: string, title: string) {
    const attendees = await this.db.selectFrom('event_attendees').select(['user_id', 'payment_id']).where('event_id', '=', eventId).where('status', 'in', ['registered', 'waitlisted', 'interested']).execute();
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('events').set({ status: 'cancelled' }).where('id', '=', eventId).execute();
      await trx.updateTable('event_attendees').set({ status: 'cancelled' }).where('event_id', '=', eventId).where('status', 'in', ['registered', 'waitlisted', 'interested']).execute();
      await trx.updateTable('conversations').set({ status: 'closed' }).where('event_id', '=', eventId).execute();
    });
    for (const a of attendees) {
      await this.notifications.notify(a.user_id, 'event.cancelled', { event: title, eventId }, { dedupeKey: `event-cancel:${eventId}` });
      // Paid tickets are refunded automatically.
      if (a.payment_id) {
        await this.billing.adminRefund(null, a.payment_id, undefined, 'event_cancelled').catch((err: Error) => this.logger.error(`refund for ${a.payment_id} failed: ${err.message}`));
      }
    }
  }

  // ------------------------------------------------------------------------------------ registration

  async register(userId: string, eventId: string, openToMeet: boolean, urls: { successUrl?: string; cancelUrl?: string }) {
    await this.gate(userId);
    const e = await this.db.selectFrom('events').selectAll().where('id', '=', eventId).executeTakeFirst();
    if (!e || e.status !== 'published') throw new AppError('EVENT_NOT_OPEN');
    if (new Date(e.starts_at) < new Date()) throw new AppError('EVENT_NOT_OPEN', 'Event already started');
    const u = await this.db.selectFrom('users').select(['date_of_birth', 'status']).where('id', '=', userId).executeTakeFirstOrThrow();
    if (u.status !== 'active') throw new AppError('FORBIDDEN', 'Verify your account first');
    const age = u.date_of_birth ? ageOn(String(u.date_of_birth)) : null;
    if (age !== null && ((e.min_age && age < e.min_age) || (e.max_age && age > e.max_age))) throw new AppError('FORBIDDEN', 'This event has an age range');
    if (e.visibility === 'premium_only') await this.entitlements.require(userId, 'advanced_filters');
    if (e.organizer_user_id && (await this.db.selectFrom('blocks').select('blocker_id').where((eb) => eb.or([eb.and([eb('blocker_id', '=', userId), eb('blocked_id', '=', e.organizer_user_id!)]), eb.and([eb('blocker_id', '=', e.organizer_user_id!), eb('blocked_id', '=', userId)])])).executeTakeFirst())) {
      throw new AppError('NOT_FOUND');
    }
    const existing = await this.db.selectFrom('event_attendees').select('status').where('event_id', '=', eventId).where('user_id', '=', userId).executeTakeFirst();
    if (existing && ['registered', 'checked_in', 'waitlisted'].includes(existing.status)) throw new AppError('CONFLICT', 'Already registered', { status: existing.status });

    if (Number(e.price_minor) > 0) {
      if (!this.billing.stripe) throw new AppError('PAYMENT_PROVIDER_NOT_CONFIGURED');
      if (!urls.successUrl || !urls.cancelUrl) throw new AppError('VALIDATION_FAILED', 'successUrl and cancelUrl are required for paid events');
      if (!this.cfg.CHECKOUT_RETURN_ORIGINS.some((o) => urls.successUrl!.startsWith(o) && urls.cancelUrl!.startsWith(o))) throw new AppError('VALIDATION_FAILED', 'Return URL not allowed');
      const full = await this.isFull(this.db, eventId, e.capacity);
      if (full) throw new AppError('EVENT_FULL');
      const session = await this.billing.stripe.createTicketCheckout({
        customer: await this.billing.stripeCustomer(userId), userId, eventId, name: e.title, amountMinor: Number(e.price_minor), currency: e.currency!,
        successUrl: urls.successUrl, cancelUrl: urls.cancelUrl, idem: `ticket:${eventId}:${userId}:${Math.floor(Date.now() / 60_000)}`,
      });
      await this.db.insertInto('event_attendees').values({ event_id: eventId, user_id: userId, status: 'interested', open_to_meet: openToMeet })
        .onConflict((oc) => oc.columns(['event_id', 'user_id']).doUpdateSet({ status: 'interested', open_to_meet: openToMeet })).execute();
      return { status: 'payment_required', checkoutUrl: session.url };
    }
    const status = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`event:${eventId}`}, 0))`.execute(trx);
      const full = await this.isFull(trx, eventId, e.capacity);
      return this.registerInTx(trx, eventId, userId, full ? 'waitlisted' : 'registered', null, openToMeet);
    });
    return status;
  }

  private async isFull(db: Tx | Database, eventId: string, capacity: number | null): Promise<boolean> {
    if (!capacity) return false;
    const { n } = await db.selectFrom('event_attendees').select(sql<number>`count(*)::int`.as('n')).where('event_id', '=', eventId).where('status', 'in', ['registered', 'checked_in']).executeTakeFirstOrThrow();
    return n >= capacity;
  }

  private async registerInTx(trx: Tx, eventId: string, userId: string, status: 'registered' | 'waitlisted', paymentId: string | null, openToMeet: boolean) {
    const code = this.checkInCode(eventId, userId);
    await trx.insertInto('event_attendees').values({ event_id: eventId, user_id: userId, status, payment_id: paymentId, open_to_meet: openToMeet, registered_at: new Date() })
      .onConflict((oc) => oc.columns(['event_id', 'user_id']).doUpdateSet({ status, payment_id: paymentId, open_to_meet: openToMeet, registered_at: new Date() })).execute();
    if (status === 'registered') await this.joinChat(trx, eventId, userId);
    await this.analytics.track('event_registered', { userId, properties: { status } }, trx);
    return { status, checkInCode: status === 'registered' ? code : null };
  }

  private async joinChat(trx: Tx, eventId: string, userId: string) {
    const e = await trx.selectFrom('events').select(['chat_enabled']).where('id', '=', eventId).executeTakeFirstOrThrow();
    if (!e.chat_enabled) return;
    let conv = await trx.selectFrom('conversations').select('id').where('event_id', '=', eventId).executeTakeFirst();
    conv ??= await trx.insertInto('conversations').values({ kind: 'event', event_id: eventId }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('conversation_members').values({ conversation_id: conv.id, user_id: userId, role: 'member' })
      .onConflict((oc) => oc.columns(['conversation_id', 'user_id']).doUpdateSet({ left_at: null })).execute();
  }

  async confirmPaidRegistration(eventId: string, userId: string, paymentIntent: string, amountMinor: number, currency: string) {
    await this.db.transaction().execute(async (trx) => {
      const pay = await trx.insertInto('payments').values({ user_id: userId, provider: 'stripe', provider_payment_id: paymentIntent, kind: 'event_ticket', event_id: eventId, amount_minor: amountMinor, currency, status: 'succeeded' })
        .onConflict((oc) => oc.columns(['provider', 'provider_payment_id']).doUpdateSet({ status: 'succeeded' })).returning('id').executeTakeFirstOrThrow();
      const existing = await trx.selectFrom('event_attendees').select('open_to_meet').where('event_id', '=', eventId).where('user_id', '=', userId).executeTakeFirst();
      await this.registerInTx(trx, eventId, userId, 'registered', pay.id, existing?.open_to_meet ?? true);
    });
    await this.analytics.track('purchase_completed', { userId, properties: { kind: 'event_ticket' } });
  }

  async cancelRegistration(userId: string, eventId: string) {
    const promoted = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`event:${eventId}`}, 0))`.execute(trx);
      const r = await trx.updateTable('event_attendees').set({ status: 'cancelled' }).where('event_id', '=', eventId).where('user_id', '=', userId).where('status', 'in', ['registered', 'waitlisted', 'interested']).returning('status').executeTakeFirst();
      if (!r) throw new AppError('NOT_FOUND');
      const conv = await trx.selectFrom('conversations').select('id').where('event_id', '=', eventId).executeTakeFirst();
      if (conv) await trx.updateTable('conversation_members').set({ left_at: new Date() }).where('conversation_id', '=', conv.id).where('user_id', '=', userId).execute();
      // First person on the waitlist gets the spot.
      const next = await trx.selectFrom('event_attendees').select('user_id').where('event_id', '=', eventId).where('status', '=', 'waitlisted').orderBy('registered_at').limit(1).executeTakeFirst();
      if (next) await this.registerInTx(trx, eventId, next.user_id, 'registered', null, true);
      return next?.user_id ?? null;
    });
    if (promoted) {
      const e = await this.db.selectFrom('events').select('title').where('id', '=', eventId).executeTakeFirstOrThrow();
      await this.notifications.notify(promoted, 'event.waitlist_promoted', { event: e.title, eventId }, { dedupeKey: `event-promote:${eventId}` });
    }
  }

  /** Other attendees open to meeting people; requires being registered yourself (BRD §8 event attendee discovery). */
  async attendees(userId: string, eventId: string) {
    const ev = await this.db.selectFrom('events').select('organizer_user_id').where('id', '=', eventId).executeTakeFirst();
    if (!ev) throw new AppError('NOT_FOUND');
    // The organizer needs the full roster to run check-in (it includes people who chose not to be shown to attendees).
    if (ev.organizer_user_id === userId) return this.roster(eventId);
    const me = await this.db.selectFrom('event_attendees').select('status').where('event_id', '=', eventId).where('user_id', '=', userId).executeTakeFirst();
    if (!me || !['registered', 'checked_in'].includes(me.status)) throw new AppError('FORBIDDEN', 'Register to see who is going');
    return this.db.selectFrom('event_attendees as a').innerJoin('user_profiles as p', 'p.user_id', 'a.user_id').innerJoin('users as u', 'u.id', 'a.user_id')
      .select(['a.user_id as userId', 'p.display_name as displayName', 'p.verification_level as verificationLevel', 'a.status'])
      .where('a.event_id', '=', eventId).where('a.status', 'in', ['registered', 'checked_in']).where('a.open_to_meet', '=', true).where('a.user_id', '<>', userId).where('u.status', '=', 'active')
      .where((eb) => eb.not(eb.exists(eb.selectFrom('blocks as b').select(sql`1`.as('x')).where((x) => x.or([x.and([x('b.blocker_id', '=', userId), x('b.blocked_id', '=', x.ref('a.user_id'))]), x.and([x('b.blocked_id', '=', userId), x('b.blocker_id', '=', x.ref('a.user_id'))])])))))
      .orderBy('p.display_name').limit(200).execute();
  }

  /** Organizer (or admin) verifies an attendee's check-in code at the venue. */
  /** Full event record for the admin console (edit form prefill). */
  async adminDetail(eventId: string) {
    const e = await this.db.selectFrom('events as e').innerJoin('cities as c', 'c.id', 'e.city_id').leftJoin('taxonomy_terms as t', 't.id', 'e.category_term_id')
      .selectAll('e').select(['c.name as city', 'c.country_code', 't.key as category_key']).where('e.id', '=', eventId).executeTakeFirst();
    if (!e) throw new AppError('NOT_FOUND');
    const interests = await this.db.selectFrom('event_interests').select('interest_id').where('event_id', '=', eventId).execute();
    return { ...e, interest_ids: interests.map((i) => i.interest_id) };
  }

  /** Everyone registered or checked in, with status — for the organizer and admins only. */
  roster(eventId: string) {
    return this.db.selectFrom('event_attendees as a').innerJoin('user_profiles as p', 'p.user_id', 'a.user_id')
      .select(['a.user_id as userId', 'p.display_name as displayName', 'p.verification_level as verificationLevel', 'a.status', 'a.checked_in_at as checkedInAt', 'a.registered_at as registeredAt'])
      .where('a.event_id', '=', eventId).where('a.status', 'in', ['registered', 'checked_in', 'waitlisted']).orderBy('a.status').orderBy('p.display_name').limit(10_000).execute();
  }

  async checkIn(organizerId: string | null, eventId: string, attendeeId: string | undefined, code: string, adminId?: string) {
    const e = await this.db.selectFrom('events').select(['organizer_user_id', 'starts_at', 'ends_at', 'title']).where('id', '=', eventId).executeTakeFirst();
    if (!e || (!adminId && e.organizer_user_id !== organizerId)) throw new AppError('NOT_FOUND');
    const now = Date.now();
    if (now < new Date(e.starts_at).getTime() - 2 * 3_600_000 || now > new Date(e.ends_at).getTime()) throw new AppError('EVENT_NOT_OPEN', 'Check-in is open from 2 hours before start until the end');
    if (!attendeeId) {
      // Codes are derived per attendee, so look the code up among registered attendees.
      const regs = await this.db.selectFrom('event_attendees').select('user_id').where('event_id', '=', eventId).where('status', '=', 'registered').execute();
      const hits = regs.filter((r) => this.checkInCode(eventId, r.user_id) === code);
      if (hits.length > 1) throw new AppError('VALIDATION_FAILED', 'Code matches more than one attendee; select the attendee', { ambiguous: true });
      if (!hits.length) throw new AppError('VALIDATION_FAILED', 'Invalid check-in code', { invalidCode: true });
      attendeeId = hits[0]!.user_id;
    }
    const a = await this.db.selectFrom('event_attendees').select(['status']).where('event_id', '=', eventId).where('user_id', '=', attendeeId).executeTakeFirst();
    if (!a || code !== this.checkInCode(eventId, attendeeId)) throw new AppError('VALIDATION_FAILED', 'Invalid check-in code', { invalidCode: true });
    if (a.status === 'checked_in') throw new AppError('CONFLICT', 'Already checked in', { alreadyCheckedIn: true });
    if (a.status !== 'registered') throw new AppError('VALIDATION_FAILED', 'Invalid check-in code', { invalidCode: true });
    await this.db.updateTable('event_attendees').set({ status: 'checked_in', checked_in_at: new Date() }).where('event_id', '=', eventId).where('user_id', '=', attendeeId).execute();
    await this.analytics.track('event_attended', { userId: attendeeId });
    await this.notifications.notify(attendeeId, 'event.checked_in', { event: e.title, eventId }, { dedupeKey: `event-checkin:${eventId}` });
  }

  async feedback(userId: string, eventId: string, input: z.infer<typeof eventFeedback>) {
    const a = await this.db.selectFrom('event_attendees as a').innerJoin('events as e', 'e.id', 'a.event_id').select(['a.status', 'e.starts_at']).where('a.event_id', '=', eventId).where('a.user_id', '=', userId).executeTakeFirst();
    if (!a || !['checked_in', 'registered', 'no_show'].includes(a.status)) throw new AppError('NOT_FOUND');
    if (new Date(a.starts_at) > new Date()) throw new AppError('VALIDATION_FAILED', 'Feedback opens once the event has started');
    await this.db.insertInto('event_feedback').values({ event_id: eventId, user_id: userId, rating: input.rating, met_someone: input.metSomeone ?? null, felt_safe: input.feltSafe ?? null, would_attend_again: input.wouldAttendAgain ?? null, comment: input.comment ?? null })
      .onConflict((oc) => oc.columns(['event_id', 'user_id']).doUpdateSet({ rating: input.rating, met_someone: input.metSomeone ?? null, felt_safe: input.feltSafe ?? null, would_attend_again: input.wouldAttendAgain ?? null, comment: input.comment ?? null })).execute();
    if (input.feltSafe === false) {
      await this.db.insertInto('safety_events').values({ user_id: null, signal: 'sos', source: 'event_feedback', score: 0.5, ref_type: 'event', ref_id: eventId, details: JSON.stringify({ reporter: userId }) }).execute();
    }
    await this.analytics.track('event_feedback_submitted', { userId, properties: { rating: input.rating } });
  }

  private async reminders(): Promise<void> {
    for (const [hours, key] of [[24, '24h'], [2, '2h']] as const) {
      const soon = await this.db.selectFrom('events as e').innerJoin('event_attendees as a', 'a.event_id', 'e.id').select(['e.id', 'e.title', 'e.starts_at', 'e.timezone', 'a.user_id'])
        .where('e.status', '=', 'published').where('a.status', '=', 'registered')
        .where('e.starts_at', '>', new Date(Date.now() + (hours - 0.25) * 3_600_000)).where('e.starts_at', '<=', new Date(Date.now() + hours * 3_600_000)).execute();
      for (const r of soon) {
        const time = new Intl.DateTimeFormat('en', { timeZone: r.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(r.starts_at));
        await this.notifications.notify(r.user_id, 'event.reminder', { event: r.title, time }, { dedupeKey: `event-reminder:${r.id}:${key}`, deepLinkVars: { eventId: r.id } });
      }
    }
  }

  // ------------------------------------------------------------------------------------ admin

  async adminList(status: string | undefined, countryScope: string[] | null, limit = 50, cursor?: string) {
    const c = decodeCursor<[string, string]>(cursor, 2);
    const rows = await this.db.selectFrom('events as e').innerJoin('cities as c', 'c.id', 'e.city_id')
      .select(['e.id', 'e.title', 'e.status', 'e.organizer_type', 'e.organizer_user_id', 'e.starts_at', 'e.ends_at', 'e.capacity', 'e.price_minor', 'e.currency', 'e.moderation_note', 'c.name as city', 'c.country_code',
        (eb) => eb.selectFrom('event_attendees as a').select(sql<number>`count(*) FILTER (WHERE a.status IN ('registered','checked_in'))::int`.as('n')).whereRef('a.event_id', '=', 'e.id').as('registered_count'),
        (eb) => eb.selectFrom('event_attendees as a').select(sql<number>`count(*) FILTER (WHERE a.status = 'waitlisted')::int`.as('n')).whereRef('a.event_id', '=', 'e.id').as('waitlist_count'),
        (eb) => eb.selectFrom('event_attendees as a').select(sql<number>`count(*) FILTER (WHERE a.status = 'checked_in')::int`.as('n')).whereRef('a.event_id', '=', 'e.id').as('checked_in_count')])
      .$if(!!status, (q) => q.where('e.status', '=', status!))
      .$if(!!countryScope, (q) => q.where('c.country_code', 'in', countryScope!))
      .$if(!!c, (q) => q.where((eb) => eb.or([eb('e.starts_at', '>', new Date(c![0])), eb.and([eb('e.starts_at', '=', new Date(c![0])), eb('e.id', '>', c![1])])])))
      .orderBy('e.starts_at').orderBy('e.id').limit(limit + 1).execute();
    return keysetPage(rows, limit, (r) => [iso(r.starts_at), r.id]);
  }

  async adminDecide(adminId: string, eventId: string, decision: 'publish' | 'reject' | 'cancel', note?: string) {
    const e = await this.db.selectFrom('events').select(['status', 'title', 'organizer_user_id']).where('id', '=', eventId).executeTakeFirst();
    if (!e) throw new AppError('NOT_FOUND');
    // Allowed transitions: publish ← draft/pending_review/rejected; reject ← draft/pending_review; cancel ← anything not final.
    const allowed = { publish: ['draft', 'pending_review', 'rejected'], reject: ['draft', 'pending_review'], cancel: ['draft', 'pending_review', 'published', 'rejected'] }[decision];
    if (!allowed.includes(e.status)) throw new AppError('CONFLICT', `Event is ${e.status}`);
    if (decision === 'cancel') await this.cancelAndNotify(eventId, e.title);
    else {
      await this.db.updateTable('events').set({ status: decision === 'publish' ? 'published' : 'rejected', moderation_note: note ?? null }).where('id', '=', eventId).where('status', 'in', allowed).execute();
      if (e.organizer_user_id) await this.notifications.notify(e.organizer_user_id, decision === 'publish' ? 'event.approved' : 'event.rejected', { event: e.title, eventId, note: note ?? '' }, { dedupeKey: `event-decision:${eventId}:${decision}` });
    }
    await this.audit.record({ actorType: 'admin', actorId: adminId, action: `events.${decision}`, targetType: 'event', targetId: eventId, reason: note });
  }

  async cityCountry(cityId: string): Promise<string | null> {
    return (await this.db.selectFrom('cities').select('country_code').where('id', '=', cityId).executeTakeFirst())?.country_code ?? null;
  }

  /** Country-scoped admins (ABAC) manage only events in their countries. */
  async assertEventInScope(eventId: string, countryScope: string[] | null) {
    const e = await this.db.selectFrom('events as e').innerJoin('cities as c', 'c.id', 'e.city_id').select('c.country_code').where('e.id', '=', eventId).executeTakeFirst();
    if (!e || (countryScope && !countryScope.includes(e.country_code))) throw new AppError('NOT_FOUND');
  }

  async adminUpdate(adminId: string, eventId: string, b: z.infer<typeof adminEventUpdate>) {
    const before = await this.db.selectFrom('events').selectAll().where('id', '=', eventId).executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    if (['cancelled', 'completed'].includes(before.status)) throw new AppError('CONFLICT', `Event is ${before.status}`);
    const startsAt = b.startsAt ? new Date(b.startsAt) : new Date(before.starts_at);
    const endsAt = b.endsAt ? new Date(b.endsAt) : new Date(before.ends_at);
    if (endsAt <= startsAt) throw new AppError('VALIDATION_FAILED', 'endsAt must be after startsAt');
    if (b.capacity !== undefined && b.capacity !== null) {
      const { n } = await this.db.selectFrom('event_attendees').select(sql<number>`count(*)::int`.as('n')).where('event_id', '=', eventId).where('status', 'in', ['registered', 'checked_in']).executeTakeFirstOrThrow();
      if (b.capacity < n) throw new AppError('CONFLICT', `Capacity cannot go below the ${n} people already registered`);
    }
    let geohash: string | undefined;
    if (b.cityId || b.latitude !== undefined || b.longitude !== undefined) {
      const city = await this.db.selectFrom('cities').select(['id', 'geohash5']).where('id', '=', b.cityId ?? before.city_id).executeTakeFirst();
      if (!city) throw new AppError('VALIDATION_FAILED', 'Unknown city');
      const lat = b.latitude !== undefined ? b.latitude : before.latitude; const lon = b.longitude !== undefined ? b.longitude : before.longitude;
      geohash = lat !== null && lon !== null ? geohashEncode(Number(lat), Number(lon), 5) : city.geohash5;
    }
    const set = Object.fromEntries(Object.entries({
      title: b.title, description: b.description, city_id: b.cityId, venue_name: b.venueName, venue_address: b.venueAddress, latitude: b.latitude, longitude: b.longitude, geohash5: geohash,
      is_online: b.isOnline, starts_at: b.startsAt ? startsAt : undefined, ends_at: b.endsAt ? endsAt : undefined, timezone: b.timezone, capacity: b.capacity, min_age: b.minAge, max_age: b.maxAge,
      visibility: b.visibility, pre_event_matching: b.preEventMatching, chat_enabled: b.chatEnabled, price_minor: b.priceMinor, currency: b.priceMinor !== undefined ? (b.priceMinor ? (b.currency ?? before.currency ?? 'USD') : null) : b.currency,
    }).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length) await this.db.updateTable('events').set(set).where('id', '=', eventId).execute();
    await this.audit.record({ actorType: 'admin', actorId: adminId, action: 'events.updated', targetType: 'event', targetId: eventId, before: { starts_at: before.starts_at, venue_name: before.venue_name, venue_address: before.venue_address, capacity: before.capacity }, after: set, reason: b.changeNote });
    // People who planned around the time or place are told it changed.
    const moved = b.startsAt || b.endsAt || b.venueName !== undefined || b.venueAddress !== undefined || b.cityId || b.isOnline !== undefined || b.latitude !== undefined || b.longitude !== undefined;
    if (moved && before.status === 'published') {
      const people = await this.db.selectFrom('event_attendees').select('user_id').where('event_id', '=', eventId).where('status', 'in', ['registered', 'waitlisted', 'interested']).execute();
      const title = b.title ?? before.title;
      for (const p of people) await this.notifications.notify(p.user_id, 'event.updated', { event: title, eventId, note: b.changeNote ?? '' }, { dedupeKey: `event-update:${eventId}:${Date.now()}` });
    }
    return { id: eventId };
  }

  async adminCreate(adminId: string, input: z.infer<typeof adminEventCreate>) {
    const cat = await this.db.selectFrom('taxonomy_terms').select('id').where('kind', '=', 'event_category').where('key', '=', input.categoryKey).executeTakeFirst();
    const city = await this.db.selectFrom('cities').select(['id', 'geohash5']).where('id', '=', input.cityId).executeTakeFirst();
    if (!cat || !city) throw new AppError('VALIDATION_FAILED', 'Unknown category or city');
    const e = await this.db.insertInto('events').values({
      organizer_type: 'platform', organizer_admin_id: adminId, category_term_id: cat.id, title: input.title, description: input.description, city_id: city.id, venue_name: input.venueName ?? null,
      venue_address: input.venueAddress ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null, geohash5: input.latitude !== undefined && input.longitude !== undefined ? geohashEncode(input.latitude, input.longitude, 5) : city.geohash5,
      is_online: input.isOnline, starts_at: new Date(input.startsAt), ends_at: new Date(input.endsAt), timezone: input.timezone, capacity: input.capacity ?? null, min_age: input.minAge ?? null, max_age: input.maxAge ?? null,
      visibility: input.visibility, pre_event_matching: input.preEventMatching, chat_enabled: input.chatEnabled, price_minor: input.priceMinor ?? 0, currency: input.priceMinor ? (input.currency ?? 'USD') : null, status: 'published',
    }).returning('id').executeTakeFirstOrThrow();
    if (input.interestIds.length) await this.db.insertInto('event_interests').values(input.interestIds.map((interest_id) => ({ event_id: e.id, interest_id }))).execute();
    await this.audit.record({ actorType: 'admin', actorId: adminId, action: 'events.created', targetType: 'event', targetId: e.id });
    return { id: e.id };
  }
}
