import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { z } from 'zod';
import type { dateFeedbackCreate, datePlanCreate, datePlanUpdate } from '@amora/shared';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { blockedEitherWay } from '../../common/db/relations';
import { AppError } from '../../common/errors/app-error';
import { localeChain } from '../../common/i18n/translations';
import { JobScheduler } from '../../common/jobs/scheduler';
import { OutboxService } from '../../common/outbox/outbox.service';
import { AiGatewayService } from '../ai/ai-gateway.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FlagsService } from '../platform/flags.service';
import { UserFactsService } from '../platform/user-facts.service';

/** Date planner (BRD §14) + relationship journey & private feedback (BRD §16). */
@Injectable()
export class DatesService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly ai: AiGatewayService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
    private readonly outbox: OutboxService,
    private readonly flags: FlagsService,
    private readonly facts: UserFactsService,
    private readonly jobs: JobScheduler,
  ) {}

  onModuleInit(): void {
    this.jobs.register('dates.reminders', 600, () => this.reminders());
    this.jobs.register('dates.feedback_requests', 1800, () => this.feedbackRequests());
    this.jobs.register('matching.behavior_stats', 6 * 3600, () => this.behaviorStats());
  }

  private async match(userId: string, matchId: string, opts: { active: boolean } = { active: true }) {
    const m = await this.db.selectFrom('matches').select(['id', 'user_low_id', 'user_high_id', 'status']).where('id', '=', matchId).executeTakeFirst();
    if (!m || ![m.user_low_id, m.user_high_id].includes(userId)) throw new AppError('NOT_FOUND');
    if (opts.active && m.status !== 'active') throw new AppError('CONVERSATION_CLOSED');
    const other = m.user_low_id === userId ? m.user_high_id : m.user_low_id;
    if (opts.active && (await blockedEitherWay(this.db, userId, other))) throw new AppError('NOT_FOUND');
    return { ...m, other };
  }

  private async term(kind: string, key?: string): Promise<string | null> {
    if (!key) return null;
    const t = await this.db.selectFrom('taxonomy_terms').select('id').where('kind', '=', kind).where('key', '=', key).executeTakeFirst();
    if (!t) throw new AppError('VALIDATION_FAILED', `Unknown ${kind}`);
    return t.id;
  }

  // ------------------------------------------------------------------------------------ plans

  async create(userId: string, input: z.infer<typeof datePlanCreate>) {
    const m = await this.match(userId, input.matchId);
    if (new Date(input.startsAt) < new Date()) throw new AppError('VALIDATION_FAILED', 'Date must be in the future');
    const [stage, budget] = await Promise.all([this.term('date_stage', input.stageKey), this.term('budget_tier', input.budgetKey)]);
    const plan = await this.db.transaction().execute(async (trx) => {
      const p = await trx.insertInto('date_plans').values({
        match_id: m.id, proposed_by: userId, status: 'proposed', date_stage_term_id: stage, activity_type: input.activityType, title: input.title, notes: input.notes ?? null,
        venue_name: input.venueName ?? null, venue_address: input.venueAddress ?? null, venue_provider: input.venueProvider ?? null, venue_place_id: input.venuePlaceId ?? null,
        city_id: input.cityId ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null, starts_at: new Date(input.startsAt), expected_duration_min: input.expectedDurationMin,
        budget_term_id: budget, ai_generated: input.aiGenerated,
      }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('date_plan_participants').values([
        { date_plan_id: p.id, user_id: userId, response: 'accepted', responded_at: new Date() },
        { date_plan_id: p.id, user_id: m.other, response: 'pending' },
      ]).execute();
      await this.systemMessage(trx, m.id, 'date_invite', p.id);
      return p;
    });
    const name = await this.name(userId);
    await this.notifications.notify(m.other, 'date.proposed', { name }, { dedupeKey: `date-proposed:${plan.id}`, deepLinkVars: { datePlanId: plan.id } });
    await this.analytics.track('date_planned', { userId, properties: { aiGenerated: input.aiGenerated } });
    return this.get(userId, plan.id);
  }

  /** A date invite also appears in the chat as a system message linking to the plan. */
  private async systemMessage(trx: Tx, matchId: string, kind: 'date_invite' | 'system', ref: string) {
    const conv = await trx.selectFrom('conversations').select('id').where('match_id', '=', matchId).executeTakeFirst();
    if (!conv) return;
    const m = await trx.insertInto('messages').values({ conversation_id: conv.id, sender_id: null, kind, body: JSON.stringify({ datePlanId: ref }) }).returning('id').executeTakeFirstOrThrow();
    await trx.updateTable('conversations').set({ last_message_at: new Date() }).where('id', '=', conv.id).execute();
    await this.outbox.enqueue(trx, 'message.created', { messageId: m.id, conversationId: conv.id, senderId: null, recipientIds: [] }, { aggregateId: conv.id });
  }

  async get(userId: string, planId: string) {
    const p = await this.db.selectFrom('date_plans as d').innerJoin('date_plan_participants as me', (j) => j.onRef('me.date_plan_id', '=', 'd.id').on('me.user_id', '=', userId))
      .leftJoin('taxonomy_terms as s', 's.id', 'd.date_stage_term_id').leftJoin('taxonomy_terms as b', 'b.id', 'd.budget_term_id').leftJoin('cities as c', 'c.id', 'd.city_id')
      .selectAll('d').select(['s.key as stage_key', 'b.key as budget_key', 'c.name as city', 'me.response as my_response', 'me.reminder_minutes_before'])
      .where('d.id', '=', planId).executeTakeFirst();
    if (!p) throw new AppError('NOT_FOUND');
    const participants = await this.db.selectFrom('date_plan_participants').select(['user_id', 'response', 'responded_at']).where('date_plan_id', '=', planId).execute();
    return {
      id: p.id, matchId: p.match_id, status: p.status, proposedBy: p.proposed_by, title: p.title, activityType: p.activity_type, stage: p.stage_key, budget: p.budget_key, notes: p.notes,
      venue: { name: p.venue_name, address: p.venue_address, provider: p.venue_provider, placeId: p.venue_place_id, city: p.city,
        // Exact coordinates are only ever shared between the two participants (MP §20).
        latitude: p.latitude, longitude: p.longitude },
      startsAt: new Date(p.starts_at).toISOString(), expectedDurationMin: p.expected_duration_min, aiGenerated: p.ai_generated, myResponse: p.my_response,
      reminders: p.reminder_minutes_before, participants: participants.map((x) => ({ userId: x.user_id, response: x.response })),
    };
  }

  async listForMatch(userId: string, matchId: string) {
    await this.match(userId, matchId, { active: false });
    const rows = await this.db.selectFrom('date_plans').select('id').where('match_id', '=', matchId).orderBy('starts_at', 'desc').limit(50).execute();
    return Promise.all(rows.map((r) => this.get(userId, r.id)));
  }

  async respond(userId: string, planId: string, response: 'accepted' | 'declined') {
    const plan = await this.get(userId, planId);
    if (plan.proposedBy === userId) throw new AppError('CONFLICT', 'You proposed this date');
    if (!['proposed', 'rescheduled'].includes(plan.status)) throw new AppError('CONFLICT', `Date is ${plan.status}`);
    await this.match(userId, plan.matchId);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('date_plan_participants').set({ response, responded_at: new Date() }).where('date_plan_id', '=', planId).where('user_id', '=', userId).execute();
      await trx.updateTable('date_plans').set({ status: response === 'accepted' ? 'accepted' : 'declined' }).where('id', '=', planId).execute();
    });
    return this.get(userId, planId);
  }

  /** Changing time/place moves the plan back to "rescheduled" and asks the other person again. */
  async update(userId: string, planId: string, input: z.infer<typeof datePlanUpdate>) {
    const plan = await this.get(userId, planId);
    if (['cancelled', 'completed', 'declined'].includes(plan.status)) throw new AppError('CONFLICT', `Date is ${plan.status}`);
    const m = await this.match(userId, plan.matchId);
    const set: Record<string, unknown> = {};
    const map: Record<string, string> = { title: 'title', activityType: 'activity_type', notes: 'notes', venueName: 'venue_name', venueAddress: 'venue_address', venueProvider: 'venue_provider', venuePlaceId: 'venue_place_id', cityId: 'city_id', latitude: 'latitude', longitude: 'longitude', expectedDurationMin: 'expected_duration_min' };
    for (const [k, col] of Object.entries(map)) if ((input as Record<string, unknown>)[k] !== undefined) set[col] = (input as Record<string, unknown>)[k];
    if (input.startsAt) set.starts_at = new Date(input.startsAt);
    if (input.stageKey) set.date_stage_term_id = await this.term('date_stage', input.stageKey);
    if (input.budgetKey) set.budget_term_id = await this.term('budget_tier', input.budgetKey);
    const material = ['starts_at', 'venue_name', 'venue_address', 'latitude', 'longitude', 'city_id'].some((k) => k in set);
    await this.db.transaction().execute(async (trx) => {
      if (Object.keys(set).length) await trx.updateTable('date_plans').set({ ...set, ...(material ? { status: 'rescheduled', proposed_by: userId } : {}) }).where('id', '=', planId).execute();
      if (material) {
        await trx.updateTable('date_plan_participants').set({ response: 'pending', responded_at: null }).where('date_plan_id', '=', planId).where('user_id', '=', m.other).execute();
        await trx.updateTable('date_plan_participants').set({ response: 'accepted', responded_at: new Date() }).where('date_plan_id', '=', planId).where('user_id', '=', userId).execute();
      }
    });
    if (material) await this.notifications.notify(m.other, 'date.proposed', { name: await this.name(userId) }, { dedupeKey: `date-changed:${planId}:${Date.now()}`, deepLinkVars: { datePlanId: planId } });
    return this.get(userId, planId);
  }

  async cancel(userId: string, planId: string) {
    const plan = await this.get(userId, planId);
    if (['cancelled', 'completed'].includes(plan.status)) throw new AppError('CONFLICT', `Date is ${plan.status}`);
    await this.db.updateTable('date_plans').set({ status: 'cancelled' }).where('id', '=', planId).execute();
    await this.db.updateTable('date_safety_sessions').set({ status: 'cancelled' }).where('date_plan_id', '=', planId).where('status', 'in', ['scheduled']).execute();
  }

  async setReminders(userId: string, planId: string, minutesBefore: number[]) {
    await this.get(userId, planId);
    await this.db.updateTable('date_plan_participants').set({ reminder_minutes_before: [...new Set(minutesBefore)].sort((a, b) => b - a) }).where('date_plan_id', '=', planId).where('user_id', '=', userId).execute();
  }

  /** "Calendar integration when authorized": an RFC 5545 event the app adds to the device calendar. */
  async ics(userId: string, planId: string): Promise<string> {
    const p = await this.get(userId, planId);
    if (p.status !== 'accepted') throw new AppError('CONFLICT', 'Only accepted dates can be added to a calendar');
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const start = new Date(p.startsAt);
    const end = new Date(start.getTime() + p.expectedDurationMin * 60_000);
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LOL//Date Planner//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:${p.id}@amora`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, `SUMMARY:${esc(p.title)}`,
      ...(p.venue.name || p.venue.address ? [`LOCATION:${esc([p.venue.name, p.venue.address].filter(Boolean).join(', '))}`] : []),
      'BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(p.title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
  }

  // ------------------------------------------------------------------------------------ ideas

  async ideas(userId: string, q: { stageKey?: string; budgetKey?: string; timeOfDay?: string; indoor?: boolean; matchId?: string }, locale: string) {
    let shared: string[] = [];
    if (q.matchId) {
      const m = await this.match(userId, q.matchId);
      shared = (await this.db.selectFrom('user_interests as a').innerJoin('user_interests as b', 'b.interest_id', 'a.interest_id').select('a.interest_id').where('a.user_id', '=', userId).where('b.user_id', '=', m.other).execute()).map((r) => r.interest_id);
    }
    const [stage, budget] = await Promise.all([this.term('date_stage', q.stageKey), this.term('budget_tier', q.budgetKey)]);
    let qb = this.db.selectFrom('date_ideas as i').leftJoin('taxonomy_terms as b', 'b.id', 'i.budget_term_id').select(['i.id', 'i.key', 'i.activity_type', 'i.indoor', 'i.time_of_day', 'i.typical_duration_min', 'i.interest_ids', 'i.date_stage_term_ids', 'b.key as budget_key'])
      .where('i.is_active', '=', true);
    if (budget) qb = qb.where('i.budget_term_id', '=', budget);
    if (q.indoor !== undefined) qb = qb.where('i.indoor', '=', q.indoor);
    if (q.timeOfDay) qb = qb.where(sql<boolean>`${q.timeOfDay} = ANY(i.time_of_day)`);
    if (stage) qb = qb.where(sql<boolean>`(cardinality(i.date_stage_term_ids) = 0 OR ${stage}::uuid = ANY(i.date_stage_term_ids))`);
    const ideas = await qb.limit(100).execute();
    const tr = ideas.length ? await this.db.selectFrom('date_idea_translations').selectAll().where('idea_id', 'in', ideas.map((i) => i.id)).where('locale', 'in', localeChain(locale)).execute() : [];
    return ideas
      .map((i) => {
        const t = localeChain(locale).map((l) => tr.find((x) => x.idea_id === i.id && x.locale === l)).find(Boolean);
        return { key: i.key, title: t?.title ?? i.key, description: t?.description ?? '', activityType: i.activity_type, budget: i.budget_key, indoor: i.indoor, durationMin: i.typical_duration_min, sharedInterestMatch: i.interest_ids.filter((x) => shared.includes(x)).length };
      })
      .sort((a, b) => b.sharedInterestMatch - a.sharedInterestMatch)
      .slice(0, 20);
  }

  /** AI date planner grounded on the admin catalog, shared interests, budget, time and stage (BRD §12, §14). */
  async aiPlan(userId: string, input: { matchId: string; stageKey?: string; budgetKey?: string; time?: string; notes?: string }, locale: string) {
    await this.flags.assertEnabled('ai.date_planner', await this.facts.load(userId));
    const m = await this.match(userId, input.matchId);
    const catalog = await this.ideas(userId, { matchId: input.matchId, stageKey: input.stageKey, budgetKey: input.budgetKey }, locale);
    const [mine, city] = await Promise.all([
      this.db.selectFrom('user_interests as a').innerJoin('user_interests as b', 'b.interest_id', 'a.interest_id').innerJoin('interest_translations as t', (j) => j.onRef('t.interest_id', '=', 'a.interest_id').on('t.locale', '=', 'en'))
        .select('t.label').where('a.user_id', '=', userId).where('b.user_id', '=', m.other).execute(),
      this.db.selectFrom('user_profiles as p').innerJoin('cities as c', 'c.id', 'p.city_id').select(['c.name', 'c.country_code']).where('p.user_id', '=', userId).executeTakeFirst(),
    ]);
    const r = await this.ai.run<{ ideas: Array<{ title: string; description: string; activityType: string; budgetTier: string; durationMin: number; safetyTip: string }> }>('date_planner', {
      locale, city: city ? `${city.name}, ${city.country_code}` : '', stage: input.stageKey ?? 'first_date', budget: input.budgetKey ?? 'low', time: input.time ?? '',
      sharedInterests: mine.map((x) => x.label).join(', '), catalog: catalog.map((c) => `${c.title}: ${c.description}`).join('\n'), notes: input.notes ?? '',
    }, { userId, trusted: ['locale', 'city', 'stage', 'budget', 'sharedInterests', 'catalog'] });
    return { ideas: r.output.ideas, note: 'Suggestions only — nothing is booked or sent until you choose.' };
  }

  // ------------------------------------------------------------------------------------ feedback & journey

  async feedback(userId: string, planId: string, input: z.infer<typeof dateFeedbackCreate>) {
    const plan = await this.get(userId, planId);
    if (new Date(plan.startsAt) > new Date()) throw new AppError('VALIDATION_FAILED', 'Feedback opens after the date starts');
    const m = await this.match(userId, plan.matchId, { active: false });
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('date_feedback').values({
        date_plan_id: planId, match_id: m.id, author_id: userId, about_user_id: m.other, date_happened: input.dateHappened, overall: input.overall ?? null, felt_safe: input.feltSafe ?? null,
        matched_profile: input.matchedProfile ?? null, want_second_date: input.wantSecondDate ?? null, tags: input.tags, private_note: input.privateNote ?? null, raise_safety_concern: input.raiseSafetyConcern,
      }).onConflict((oc) => oc.columns(['match_id', 'author_id', 'date_plan_id']).doUpdateSet({
        date_happened: input.dateHappened, overall: input.overall ?? null, felt_safe: input.feltSafe ?? null, matched_profile: input.matchedProfile ?? null,
        want_second_date: input.wantSecondDate ?? null, tags: input.tags, private_note: input.privateNote ?? null, raise_safety_concern: input.raiseSafetyConcern,
      })).execute();
      if (input.dateHappened) {
        await trx.updateTable('date_plans').set({ status: 'completed' }).where('id', '=', planId).where('status', '=', 'accepted').execute();
        const done = await trx.selectFrom('date_plans').select(sql<number>`count(*)::int`.as('n')).where('match_id', '=', m.id).where('status', '=', 'completed').executeTakeFirstOrThrow();
        const j = await trx.selectFrom('relationship_journeys').selectAll().where('match_id', '=', m.id).executeTakeFirst();
        if (j) {
          const set: Record<string, unknown> = { first_feedback_at: j.first_feedback_at ?? new Date() };
          if (done.n >= 1 && !j.first_date_at) Object.assign(set, { first_date_at: plan.startsAt, stage: 'first_date' });
          if (done.n >= 2 && !j.second_date_at) Object.assign(set, { second_date_at: plan.startsAt, stage: 'second_date' });
          if (done.n === 1 && j.stage === 'first_date') set.stage = 'feedback';
          await trx.updateTable('relationship_journeys').set(set).where('match_id', '=', m.id).execute();
        }
      }
      // Safety concerns or "matched profile = no" go to Trust & Safety, never to the other person.
      if (input.raiseSafetyConcern || input.feltSafe === false || input.matchedProfile === false) {
        await trx.insertInto('safety_events').values({ user_id: m.other, signal: input.matchedProfile === false && !input.raiseSafetyConcern ? 'fake_profile' : 'sos', source: 'date_feedback', score: input.raiseSafetyConcern ? 0.8 : 0.5, ref_type: 'date_plan', ref_id: planId, details: JSON.stringify({ reporter: userId }) }).execute();
        await this.outbox.enqueue(trx, 'safety.date_concern', { reporterId: userId, subjectId: m.other, datePlanId: planId, severe: input.raiseSafetyConcern });
      }
    });
    if (input.dateHappened) await this.analytics.track('date_completed', { userId });
    await this.analytics.track('date_feedback_submitted', { userId, properties: { happened: input.dateHappened, secondDate: input.wantSecondDate ?? null } });
    // Learning signal for matching (BRD §9): positive outcomes recomputed by the behavior job.
    await this.outbox.enqueue(this.db, 'answers.changed', { userId });
  }

  async journey(userId: string, matchId: string) {
    await this.match(userId, matchId, { active: false });
    const j = await this.db.selectFrom('relationship_journeys').selectAll().where('match_id', '=', matchId).executeTakeFirstOrThrow();
    const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
    return {
      stage: j.stage,
      milestones: { matched: true, conversationAt: iso(j.conversation_at), voiceVideoAt: iso(j.voice_video_at), firstDateAt: iso(j.first_date_at), feedbackAt: iso(j.first_feedback_at), secondDateAt: iso(j.second_date_at), relationshipAt: iso(j.relationship_at) },
      next: j.stage === 'matched' ? 'say_hello' : j.stage === 'conversation' ? 'voice_or_video' : j.stage === 'voice_video' ? 'plan_first_date' : j.stage === 'first_date' || j.stage === 'feedback' ? 'plan_second_date' : j.stage === 'second_date' ? 'relationship_tools' : null,
    };
  }

  // ------------------------------------------------------------------------------------ jobs

  private async name(userId: string) {
    return (await this.db.selectFrom('user_profiles').select('display_name').where('user_id', '=', userId).executeTakeFirst())?.display_name ?? '';
  }

  private async reminders(): Promise<void> {
    const rows = await this.db.selectFrom('date_plans as d').innerJoin('date_plan_participants as pp', 'pp.date_plan_id', 'd.id')
      .select(['d.id', 'd.starts_at', 'd.match_id', 'pp.user_id', 'pp.reminder_minutes_before']).where('d.status', '=', 'accepted')
      .where('d.starts_at', '>', new Date()).where('d.starts_at', '<', new Date(Date.now() + 25 * 3_600_000)).execute();
    for (const r of rows) {
      const minsLeft = (new Date(r.starts_at).getTime() - Date.now()) / 60_000;
      for (const before of r.reminder_minutes_before) {
        if (minsLeft <= before && minsLeft > before - 15) {
          const m = await this.db.selectFrom('matches').select(['user_low_id', 'user_high_id']).where('id', '=', r.match_id).executeTakeFirstOrThrow();
          const other = m.user_low_id === r.user_id ? m.user_high_id : m.user_low_id;
          const time = `in ${Math.round(minsLeft)} min`;
          await this.notifications.notify(r.user_id, 'date.reminder', { name: await this.name(other), time }, { dedupeKey: `date-reminder:${r.id}:${before}`, deepLinkVars: { datePlanId: r.id } });
        }
      }
    }
  }

  private async feedbackRequests(): Promise<void> {
    const rows = await this.db.selectFrom('date_plans as d').innerJoin('date_plan_participants as pp', 'pp.date_plan_id', 'd.id').select(['d.id', 'd.match_id', 'pp.user_id'])
      .where('d.status', '=', 'accepted').where(sql<boolean>`d.starts_at + (d.expected_duration_min || ' minutes')::interval < now()`).where('d.starts_at', '>', new Date(Date.now() - 3 * 86_400_000))
      .where((eb) => eb.not(eb.exists(eb.selectFrom('date_feedback as f').select(sql`1`.as('x')).whereRef('f.date_plan_id', '=', 'd.id').whereRef('f.author_id', '=', 'pp.user_id')))).execute();
    for (const r of rows) {
      const m = await this.db.selectFrom('matches').select(['user_low_id', 'user_high_id']).where('id', '=', r.match_id).executeTakeFirstOrThrow();
      const other = m.user_low_id === r.user_id ? m.user_high_id : m.user_low_id;
      await this.notifications.notify(r.user_id, 'date.feedback_request', { name: await this.name(other) }, { dedupeKey: `date-feedback:${r.id}`, deepLinkVars: { datePlanId: r.id } });
    }
  }

  /** Outcome-oriented behavior features for ranking (TECH §6 behavior score; BRD §9 learning from outcomes). */
  async behaviorStats(): Promise<void> {
    await sql`
      INSERT INTO user_behavior_stats (user_id, likes_sent_30d, passes_sent_30d, likes_received_30d, matches_30d, conversations_started_30d, reply_rate_30d, dates_completed_90d, positive_feedback_rate, recommendation_accept_rate, last_active_at, computed_at)
      SELECT u.id,
        (SELECT count(*) FROM swipe_actions s WHERE s.actor_id = u.id AND s.action IN ('like','super_like') AND s.created_at > now() - interval '30 days'),
        (SELECT count(*) FROM swipe_actions s WHERE s.actor_id = u.id AND s.action = 'pass' AND s.created_at > now() - interval '30 days'),
        (SELECT count(*) FROM swipe_actions s WHERE s.target_id = u.id AND s.action IN ('like','super_like') AND s.created_at > now() - interval '30 days'),
        (SELECT count(*) FROM matches m WHERE (m.user_low_id = u.id OR m.user_high_id = u.id) AND m.created_at > now() - interval '30 days'),
        (SELECT count(*) FROM relationship_journeys j JOIN matches m ON m.id = j.match_id WHERE (m.user_low_id = u.id OR m.user_high_id = u.id) AND j.conversation_at > now() - interval '30 days'),
        -- reply rate: share of conversations where someone else wrote first and this user answered
        (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE avg(CASE WHEN EXISTS (SELECT 1 FROM messages r WHERE r.conversation_id = c.conversation_id AND r.sender_id = u.id) THEN 1.0 ELSE 0 END) END
           FROM (SELECT DISTINCT m.conversation_id FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = u.id
                 WHERE m.sender_id IS NOT NULL AND m.sender_id <> u.id AND m.created_at > now() - interval '30 days') c),
        (SELECT count(*) FROM date_plans d JOIN matches m ON m.id = d.match_id WHERE (m.user_low_id = u.id OR m.user_high_id = u.id) AND d.status = 'completed' AND d.starts_at > now() - interval '90 days'),
        (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE avg(CASE WHEN f.want_second_date = 'yes' OR f.overall >= 4 THEN 1.0 ELSE 0 END) END FROM date_feedback f WHERE f.about_user_id = u.id AND f.date_happened),
        (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE avg(CASE WHEN rf.outcome = 'accepted' THEN 1.0 ELSE 0 END) END FROM recommendation_feedback rf WHERE rf.candidate_id = u.id AND rf.created_at > now() - interval '30 days'),
        u.last_active_at, now()
      FROM users u WHERE u.status = 'active' AND u.last_active_at > now() - interval '60 days'
      ON CONFLICT (user_id) DO UPDATE SET likes_sent_30d = EXCLUDED.likes_sent_30d, passes_sent_30d = EXCLUDED.passes_sent_30d, likes_received_30d = EXCLUDED.likes_received_30d,
        matches_30d = EXCLUDED.matches_30d, conversations_started_30d = EXCLUDED.conversations_started_30d, reply_rate_30d = EXCLUDED.reply_rate_30d, dates_completed_90d = EXCLUDED.dates_completed_90d,
        positive_feedback_rate = EXCLUDED.positive_feedback_rate, recommendation_accept_rate = EXCLUDED.recommendation_accept_rate, last_active_at = EXCLUDED.last_active_at, computed_at = now()
    `.execute(this.db);
  }
}
