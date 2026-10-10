import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sql, type SelectQueryBuilder } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { DATABASE, type Database, type DB } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { distanceBucket, geohashEncode, geohashNeighborhood, haversineKm } from '../../common/geo/geo';
import { ageOn } from '../auth/age';
import { JobScheduler } from '../../common/jobs/scheduler';
import { OutboxService } from '../../common/outbox/outbox.service';
import { CatalogService } from '../catalog/catalog.service';
import { EntitlementsService } from '../platform/entitlements.service';
import { FlagsService } from '../platform/flags.service';
import { UserFactsService } from '../platform/user-facts.service';
import { MediaService } from '../profiles/media.service';
import { personalizedScore } from './adaptive';
import { AdaptiveService } from './adaptive.service';
import { compatibility, type CompatibilityResult } from './engine/compatibility';
import { rank, type CandidateSignals } from './engine/ranking';
import { FeaturesService } from './features.service';
import { MatchingConfigService } from './matching-config.service';

export type Surface = 'swipe' | 'smart' | 'daily' | 'nearby' | 'travel' | 'event' | 'interest' | 'intent' | 'crossed_paths' | 'search';

export interface SurfaceOptions {
  interestId?: string;
  intentId?: string;
  travelPlanId?: string;
  eventId?: string;
}

/** Geohash prefix length whose 3×3 neighbourhood covers roughly `km` radius. */
function precisionFor(km: number): number {
  if (km > 600) return 2;
  if (km > 80) return 3;
  if (km > 20) return 4;
  return 5;
}

/**
 * Recommendation pipeline (TECH §6): SQL retrieval with hard prefilters → feature load → pure compatibility engine
 * (eligibility + deal-breakers + scoring) → ranking (behavior, admin rules, safety, diversity) → persisted batch with
 * explainability (match_candidates). Feeds are served from precomputed batches; jobs keep them fresh.
 */
@Injectable()
export class RecommendationsService implements OnModuleInit {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: MatchingConfigService,
    private readonly features: FeaturesService,
    private readonly media: MediaService,
    private readonly catalog: CatalogService,
    private readonly entitlements: EntitlementsService,
    private readonly flags: FlagsService,
    private readonly facts: UserFactsService,
    private readonly analytics: AnalyticsService,
    private readonly outbox: OutboxService,
    private readonly jobs: JobScheduler,
    private readonly adaptive: AdaptiveService,
  ) {}

  onModuleInit(): void {
    // Answers or preferences changed → that user's unserved recommendations are stale (both as seeker and candidate).
    const expireFor = async (p: Record<string, unknown>) => {
      const uid = String(p.userId);
      await this.db.updateTable('match_candidates').set({ expires_at: new Date() }).where('acted_at', 'is', null).where('served_at', 'is', null).where((eb) => eb.or([eb('user_id', '=', uid), eb('candidate_id', '=', uid)])).where('expires_at', '>', new Date()).execute();
    };
    this.outbox.on('answers.changed', expireFor);
    this.outbox.on('preferences.changed', expireFor);
    this.outbox.on('matching.config_changed', async () => {
      await this.db.updateTable('match_candidates').set({ expires_at: new Date() }).where('acted_at', 'is', null).where('served_at', 'is', null).where('expires_at', '>', new Date()).execute();
    });
    this.jobs.register('recommendations.precompute', 3600, () => this.precomputeActive());
    this.jobs.register('recommendations.cleanup', 6 * 3600, async () => {
      await this.db.deleteFrom('match_candidates').where('expires_at', '<', new Date(Date.now() - 30 * 86_400_000)).where('acted_at', 'is', null).execute();
    });
  }

  // -------------------------------------------------------------------------------------------- retrieval

  private async retrieve(userId: string, surface: Surface, opts: SurfaceOptions, poolLimit: number, suppressDays: number, exclude: string[]): Promise<string[]> {
    const me = await this.db
      .selectFrom('users as u')
      .innerJoin('user_profiles as p', 'p.user_id', 'u.id')
      .leftJoin('user_preferences as pr', 'pr.user_id', 'u.id')
      .leftJoin('user_locations as l', 'l.user_id', 'u.id')
      .select(['p.gender_id', 'p.geohash5', 'p.city_id', 'l.latitude', 'l.longitude', 'pr.age_min', 'pr.age_max', 'pr.age_strict', 'pr.max_distance_km', 'pr.global_mode'])
      .where('u.id', '=', userId)
      .executeTakeFirst();
    if (!me) throw new AppError('PROFILE_INCOMPLETE');
    const myGenderPrefs = (await this.db.selectFrom('user_preference_terms').select('term_id').where('user_id', '=', userId).where('kind', '=', 'gender').execute()).map((r) => r.term_id);

    let qb = this.db
      .selectFrom('user_profiles as p')
      .innerJoin('users as u', 'u.id', 'p.user_id')
      .leftJoin('user_privacy_settings as ps', 'ps.user_id', 'p.user_id')
      .select('p.user_id')
      .where('u.status', '=', 'active')
      .where('p.user_id', '<>', userId)
      .where('p.is_discoverable', '=', true)
      .where((eb) =>
        eb.or([
          eb.and([eb('p.incognito', '=', false), eb.or([eb('ps.discoverable_by', 'is', null), eb('ps.discoverable_by', '=', 'everyone')])]),
          // Incognito / liked-only profiles are visible only to people they have liked.
          eb.exists(eb.selectFrom('swipe_actions as s').select(sql`1`.as('x')).whereRef('s.actor_id', '=', 'p.user_id').where('s.target_id', '=', userId).where('s.action', 'in', ['like', 'super_like']).where('s.rewound_at', 'is', null)),
        ]),
      )
      .where((eb) => eb.not(eb.exists(eb.selectFrom('blocks as b').select(sql`1`.as('x')).where((x) => x.or([x.and([x('b.blocker_id', '=', userId), x('b.blocked_id', '=', x.ref('p.user_id'))]), x.and([x('b.blocked_id', '=', userId), x('b.blocker_id', '=', x.ref('p.user_id'))])])))))
      .where((eb) => eb.not(eb.exists(eb.selectFrom('swipe_actions as s').select(sql`1`.as('x')).where('s.actor_id', '=', userId).whereRef('s.target_id', '=', 'p.user_id').where('s.rewound_at', 'is', null))))
      .where((eb) => eb.not(eb.exists(eb.selectFrom('matches as m').select(sql`1`.as('x')).where('m.status', '=', 'active').where((x) => x.or([x.and([x('m.user_low_id', '=', userId), x('m.user_high_id', '=', x.ref('p.user_id'))]), x.and([x('m.user_high_id', '=', userId), x('m.user_low_id', '=', x.ref('p.user_id'))])])))))
      .where((eb) => eb.not(eb.exists(eb.selectFrom('account_restrictions as r').select(sql`1`.as('x')).whereRef('r.user_id', '=', 'p.user_id').where('r.kind', 'in', ['no_discovery', 'shadow_limited']).where('r.lifted_at', 'is', null))));

    if (exclude.length) qb = qb.where('p.user_id', 'not in', exclude);
    // Mutual gender preference prefilter (the engine re-checks precisely).
    if (myGenderPrefs.length) qb = qb.where('p.gender_id', 'in', myGenderPrefs);
    if (me.gender_id) {
      const g = me.gender_id;
      qb = qb.where((eb) => eb.or([
        eb.not(eb.exists(eb.selectFrom('user_preference_terms as t').select(sql`1`.as('x')).whereRef('t.user_id', '=', 'p.user_id').where('t.kind', '=', 'gender'))),
        eb.exists(eb.selectFrom('user_preference_terms as t').select(sql`1`.as('x')).whereRef('t.user_id', '=', 'p.user_id').where('t.kind', '=', 'gender').where('t.term_id', '=', g)),
      ]));
    }
    if (me.age_strict !== false && me.age_min && me.age_max) {
      const today = new Date();
      const born = (years: number) => new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate())).toISOString().slice(0, 10);
      qb = qb.where('u.date_of_birth', '<=', born(me.age_min)).where('u.date_of_birth', '>', born(me.age_max + 1));
    }

    // Location prefilter by geohash neighbourhood, per surface.
    const origin = await this.surfaceOrigin(userId, surface, opts, me);
    const radius = surface === 'nearby' ? Math.min(me.max_distance_km ?? 50, 10) : (me.max_distance_km ?? 50);
    if (origin && !(me.global_mode && surface !== 'nearby' && surface !== 'travel')) {
      const cells = geohashNeighborhood(origin.slice(0, precisionFor(radius)));
      qb = qb.where((eb) => eb.or(cells.map((c) => eb('p.geohash5', 'like', `${c}%`))));
    }

    qb = this.surfaceFilter(qb, userId, surface, opts);
    if (suppressDays > 0 && ['swipe', 'smart', 'nearby', 'interest', 'intent'].includes(surface)) {
      const since = new Date(Date.now() - suppressDays * 86_400_000);
      qb = qb.where((eb) => eb.not(eb.exists(eb.selectFrom('match_candidates as mc').select(sql`1`.as('x')).where('mc.user_id', '=', userId).whereRef('mc.candidate_id', '=', 'p.user_id').where('mc.served_at', '>', since))));
    }
    const rows = await qb.orderBy(sql`u.last_active_at DESC NULLS LAST`).limit(poolLimit).execute();
    return rows.map((r) => r.user_id);
  }

  private async surfaceOrigin(userId: string, surface: Surface, opts: SurfaceOptions, me: { geohash5: string | null; latitude: number | null; longitude: number | null }): Promise<string | null> {
    if (surface === 'travel') {
      const plan = await this.db.selectFrom('travel_plans as t').innerJoin('cities as c', 'c.id', 't.city_id').select(['c.geohash5'])
        .where('t.user_id', '=', userId).where('t.is_active', '=', true).where('t.ends_on', '>=', new Date().toISOString().slice(0, 10))
        .$if(!!opts.travelPlanId, (q) => q.where('t.id', '=', opts.travelPlanId!)).orderBy('t.starts_on').executeTakeFirst();
      if (!plan) throw new AppError('VALIDATION_FAILED', 'No active travel plan');
      return plan.geohash5;
    }
    if (surface === 'event') return null;
    if (me.latitude !== null && me.longitude !== null) return geohashEncode(me.latitude, me.longitude, 5);
    return me.geohash5;
  }

  private surfaceFilter(qb: SelectQueryBuilder<DB & { p: DB['user_profiles']; u: DB['users']; ps: DB['user_privacy_settings'] }, 'p' | 'u' | 'ps', { user_id: string }>, userId: string, surface: Surface, opts: SurfaceOptions) {
    switch (surface) {
      case 'interest':
        if (!opts.interestId) throw new AppError('VALIDATION_FAILED', 'interestId required');
        return qb.where((eb) => eb.exists(eb.selectFrom('user_interests as ui').select(sql`1`.as('x')).whereRef('ui.user_id', '=', 'p.user_id').where('ui.interest_id', '=', opts.interestId!)));
      case 'intent':
        if (!opts.intentId) throw new AppError('VALIDATION_FAILED', 'intentId required');
        return qb.where('p.dating_intent_id', '=', opts.intentId);
      case 'event':
        if (!opts.eventId) throw new AppError('VALIDATION_FAILED', 'eventId required');
        return qb
          .where((eb) => eb.exists(eb.selectFrom('event_attendees as a').select(sql`1`.as('x')).whereRef('a.user_id', '=', 'p.user_id').where('a.event_id', '=', opts.eventId!).where('a.status', 'in', ['registered', 'checked_in']).where('a.open_to_meet', '=', true)))
          .where((eb) => eb.exists(eb.selectFrom('event_attendees as me').select(sql`1`.as('x')).where('me.user_id', '=', userId).where('me.event_id', '=', opts.eventId!).where('me.status', 'in', ['registered', 'checked_in'])));
      case 'crossed_paths': {
        const since = new Date(Date.now() - 14 * 86_400_000);
        return qb.where((eb) => eb.exists(eb.selectFrom('crossed_path_sightings as a').innerJoin('crossed_path_sightings as b', (j) => j.onRef('a.geohash6', '=', 'b.geohash6').onRef('a.hour_bucket', '=', 'b.hour_bucket'))
          .select(sql`1`.as('x')).where('a.user_id', '=', userId).whereRef('b.user_id', '=', 'p.user_id').where('a.hour_bucket', '>', since)));
      }
      default:
        return qb;
    }
  }

  // -------------------------------------------------------------------------------------------- generation

  /** Scores and ranks a fresh batch for `userId` and persists it. Returns the persisted rows in rank order. */
  async generate(userId: string, surface: Surface, opts: SurfaceOptions = {}, excludeIds: string[] = []) {
    const cfg = await this.config.forUser(userId);
    const pool = await this.retrieve(userId, surface, opts, cfg.candidatePoolLimit, cfg.repeatSuppressionDays, excludeIds);
    const loaded = await this.features.load([userId, ...pool]);
    const seeker = loaded.get(userId);
    if (!seeker) throw new AppError('PROFILE_INCOMPLETE');

    const results = new Map<string, CompatibilityResult>();
    const signals: CandidateSignals[] = [];
    // Adaptive ranking (flag `matching.v2`): personalise ranking with learned affinities; displayed % is unchanged.
    const adaptiveOn = await this.flags.isEnabled('matching.v2', await this.facts.load(userId));
    const affinities = adaptiveOn ? await this.adaptive.affinities(userId) : {};
    const weightsByKey = Object.fromEntries(cfg.engine.categories.map((c) => [c.key, c.weight]));
    for (const id of pool) {
      const c = loaded.get(id);
      if (!c) continue;
      const r = compatibility(cfg.engine, seeker.features, c.features);
      if (r.excluded) continue;
      results.set(id, r);
      const rankScore = adaptiveOn && Object.keys(affinities).length ? (personalizedScore(r.categoryScores, weightsByKey, affinities) ?? r.compatibility) : r.compatibility;
      signals.push({ ...c.signals, compatibility: rankScore, confidence: r.confidence });
    }
    const limit = surface === 'daily' ? cfg.dailyCuratedCount : cfg.batchSize;
    const ranked = rank(signals, { ...cfg.ranking, limit });
    const batchId = randomUUID();
    const expires = surface === 'daily' ? endOfUtcDay() : new Date(Date.now() + cfg.ttlHours * 3_600_000);
    if (ranked.ranked.length) {
      await this.db
        .insertInto('match_candidates')
        .values(ranked.ranked.map((r, i) => {
          const res = results.get(r.candidateId)!;
          return {
            user_id: userId, candidate_id: r.candidateId, config_version_id: cfg.versionId, surface, compatibility: res.compatibility, confidence: res.confidence,
            final_score: r.finalScore, factor_scores: JSON.stringify(res.categoryScores), top_factors: JSON.stringify(res.topFactors),
            differences: JSON.stringify(res.differences), rank: i, batch_id: batchId, expires_at: expires,
          };
        }))
        .execute();
    }
    return { batchId, count: ranked.ranked.length, poolSize: pool.length, dropped: ranked.dropped.length };
  }

  // -------------------------------------------------------------------------------------------- serving

  async feed(userId: string, surface: Surface, limit: number, opts: SurfaceOptions, locale: string) {
    await this.assertSurfaceAllowed(userId, surface);
    const facts = await this.facts.load(userId);
    const insights = facts.entitlements.includes('compatibility_insights');

    let effectiveLimit = limit;
    if (surface === 'smart') {
      const a = await this.entitlements.allowance(userId, 'smart_matches', facts.countryCode);
      if (!a.unlimited) effectiveLimit = Math.min(limit, a.remaining ?? 0);
      if (effectiveLimit === 0) return { items: [], limitReached: true, resetsAt: a.resetsAt };
    }

    let rows = await this.pending(userId, surface, effectiveLimit, opts);
    if (rows.length < effectiveLimit && surface !== 'daily') {
      await this.generate(userId, surface, opts, rows.map((r) => r.candidate_id));
      rows = await this.pending(userId, surface, effectiveLimit, opts);
    } else if (surface === 'daily' && rows.length === 0) {
      const today = await this.db.selectFrom('match_candidates').select('id').where('user_id', '=', userId).where('surface', '=', 'daily').where('computed_at', '>=', startOfUtcDay()).executeTakeFirst();
      if (!today) {
        await this.generate(userId, 'daily', opts);
        rows = await this.pending(userId, surface, effectiveLimit, opts);
      }
    }

    if (rows.length) {
      await this.db.updateTable('match_candidates').set({ served_at: new Date() }).where('id', 'in', rows.map((r) => r.id)).where('served_at', 'is', null).execute();
      if (surface === 'smart') {
        await this.db.transaction().execute(async (trx) => {
          for (let i = 0; i < rows.length; i++) await this.entitlements.consume(trx, userId, 'smart_matches', facts.countryCode);
        });
      }
      await this.analytics.track('recommendation_served', { userId, properties: { surface, count: rows.length } });
    }
    const showBreakdown = surface === 'smart' || surface === 'daily' || insights;
    return { items: await this.cards(userId, rows, locale, showBreakdown), limitReached: false, resetsAt: null };
  }

  private async pending(userId: string, surface: Surface, limit: number, opts: SurfaceOptions) {
    let qb = this.db
      .selectFrom('match_candidates as mc')
      .selectAll('mc')
      .where('mc.user_id', '=', userId)
      .where('mc.surface', '=', surface)
      .where('mc.acted_at', 'is', null)
      .where('mc.expires_at', '>', new Date())
      // Re-check volatile eligibility at serve time: blocks / swipes / profile state may have changed.
      .where((eb) => eb.not(eb.exists(eb.selectFrom('swipe_actions as s').select(sql`1`.as('x')).where('s.actor_id', '=', userId).whereRef('s.target_id', '=', 'mc.candidate_id').where('s.rewound_at', 'is', null))))
      .where((eb) => eb.not(eb.exists(eb.selectFrom('blocks as b').select(sql`1`.as('x')).where((x) => x.or([x.and([x('b.blocker_id', '=', userId), x('b.blocked_id', '=', x.ref('mc.candidate_id'))]), x.and([x('b.blocked_id', '=', userId), x('b.blocker_id', '=', x.ref('mc.candidate_id'))])])))))
      .where((eb) => eb.exists(eb.selectFrom('user_profiles as p').innerJoin('users as u', 'u.id', 'p.user_id').select(sql`1`.as('x')).whereRef('p.user_id', '=', 'mc.candidate_id').where('p.is_discoverable', '=', true).where('u.status', '=', 'active')))
      .orderBy('mc.computed_at', 'desc')
      .orderBy('mc.rank')
      .limit(limit);
    if (surface === 'event' && opts.eventId) qb = qb.where((eb) => eb.exists(eb.selectFrom('event_attendees as a').select(sql`1`.as('x')).whereRef('a.user_id', '=', 'mc.candidate_id').where('a.event_id', '=', opts.eventId!)));
    // Batches of a surface can mix options (e.g. different interests); keep only matching ones for filtered surfaces.
    if (surface === 'interest' && opts.interestId) qb = qb.where((eb) => eb.exists(eb.selectFrom('user_interests as ui').select(sql`1`.as('x')).whereRef('ui.user_id', '=', 'mc.candidate_id').where('ui.interest_id', '=', opts.interestId!)));
    if (surface === 'intent' && opts.intentId) qb = qb.where((eb) => eb.exists(eb.selectFrom('user_profiles as p2').select(sql`1`.as('x')).whereRef('p2.user_id', '=', 'mc.candidate_id').where('p2.dating_intent_id', '=', opts.intentId!)));
    return qb.execute();
  }

  private async assertSurfaceAllowed(userId: string, surface: Surface): Promise<void> {
    const me = await this.db.selectFrom('user_profiles as p').innerJoin('users as u', 'u.id', 'p.user_id').leftJoin('onboarding_progress as o', 'o.user_id', 'p.user_id')
      .select(['u.status', 'o.completed_at']).where('p.user_id', '=', userId).executeTakeFirst();
    if (!me?.completed_at) throw new AppError('PROFILE_INCOMPLETE', 'Finish onboarding to start discovering');
    if (me.status !== 'active') throw new AppError('FORBIDDEN', 'Verify your email or phone to start discovering');
    const restricted = await this.db.selectFrom('account_restrictions').select('kind').where('user_id', '=', userId).where('kind', '=', 'no_discovery').where('lifted_at', 'is', null).executeTakeFirst();
    if (restricted) throw new AppError('FORBIDDEN', 'Discovery is restricted on this account');
    const facts = await this.facts.load(userId);
    if (surface === 'travel') {
      await this.flags.assertEnabled('travel_mode', facts);
      await this.entitlements.require(userId, 'travel_mode');
    }
    if (surface === 'crossed_paths') {
      await this.flags.assertEnabled('crossed_paths', facts);
      const consent = await this.db.selectFrom('consent_records').select('granted').where('user_id', '=', userId).where('consent_type', '=', 'crossed_paths').orderBy('created_at', 'desc').limit(1).executeTakeFirst();
      if (!consent?.granted) throw new AppError('CONSENT_REQUIRED', undefined, { consentType: 'crossed_paths' });
    }
    if (surface === 'event') await this.flags.assertEnabled('events', facts);
  }

  /** Card DTOs honouring each candidate's privacy settings. Internal scores (final_score, risk) are never included. */
  async cards(viewerId: string, rows: Array<{ id: string; candidate_id: string; compatibility: string | number; confidence: string | number; factor_scores: unknown; top_factors: unknown; differences: unknown; surface: string }>, locale: string, showBreakdown: boolean) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.candidate_id);
    const [profiles, locs, interests, prompts] = await Promise.all([
      this.db.selectFrom('user_profiles as p').innerJoin('users as u', 'u.id', 'p.user_id').leftJoin('user_privacy_settings as ps', 'ps.user_id', 'p.user_id').leftJoin('cities as c', 'c.id', 'p.city_id')
        .select(['p.user_id', 'p.display_name', 'p.bio', 'p.dating_intent_id', 'p.verification_level', 'u.date_of_birth', 'u.last_active_at', 'c.name as city', 'ps.show_age', 'ps.show_city', 'ps.show_distance', 'ps.show_verification', 'ps.show_online_status'])
        .where('p.user_id', 'in', ids).execute(),
      this.db.selectFrom('user_locations').select(['user_id', 'latitude', 'longitude']).where('user_id', 'in', [viewerId, ...ids]).execute(),
      this.db.selectFrom('user_interests').select(['user_id', 'interest_id']).where('user_id', 'in', [viewerId, ...ids]).execute(),
      this.db.selectFrom('profile_prompts').select(['user_id', 'prompt_id', 'answer', 'position']).where('user_id', 'in', ids).where('moderation_status', '=', 'approved').orderBy('position').execute(),
    ]);
    const [intentTerms, interestCats, promptCat, compatCats] = await Promise.all([
      this.catalog.terms(['dating_intent'], locale), this.catalog.interests(locale), this.catalog.prompts(locale), this.compatLabels(locale),
    ]);
    const interestLabel = new Map(interestCats.flatMap((c) => c.interests).map((i) => [i.id, i.label]));
    const mine = new Set(interests.filter((i) => i.user_id === viewerId).map((i) => i.interest_id));
    const viewerLoc = locs.find((l) => l.user_id === viewerId);

    return Promise.all(rows.map(async (r) => {
      const p = profiles.find((x) => x.user_id === r.candidate_id)!;
      const loc = locs.find((l) => l.user_id === r.candidate_id);
      const label = (f: { categoryKey: string; score: number; reasonKey: string; params: Record<string, unknown> }) => ({ ...f, label: compatCats.get(f.categoryKey) ?? f.categoryKey });
      const firstPrompt = prompts.find((x) => x.user_id === r.candidate_id);
      const photos = (await this.media.publicMedia(r.candidate_id)).filter((m) => m.kind === 'photo').map((m) => ({ id: m.id, url: m.url, thumbUrl: m.thumbUrl, width: m.width, height: m.height }));
      return {
        candidateRowId: r.id,
        userId: r.candidate_id,
        displayName: p.display_name,
        age: p.show_age === false || !p.date_of_birth ? null : ageOn(String(p.date_of_birth)),
        city: p.show_city === false ? null : p.city,
        distance: p.show_distance === false || !viewerLoc || !loc ? null : distanceBucket(haversineKm(viewerLoc.latitude, viewerLoc.longitude, loc.latitude, loc.longitude)),
        verified: p.show_verification === false ? null : ['selfie', 'identity'].includes(p.verification_level),
        recentlyActive: p.show_online_status === false || !p.last_active_at ? null : Date.now() - new Date(p.last_active_at).getTime() < 86_400_000,
        datingIntent: intentTerms.find((t) => t.id === p.dating_intent_id) ? { key: intentTerms.find((t) => t.id === p.dating_intent_id)!.key, label: intentTerms.find((t) => t.id === p.dating_intent_id)!.label } : null,
        bio: p.bio,
        prompt: firstPrompt ? { prompt: promptCat.find((x) => x.id === firstPrompt.prompt_id)?.text ?? null, answer: firstPrompt.answer } : null,
        photos,
        sharedInterests: interests.filter((i) => i.user_id === r.candidate_id && mine.has(i.interest_id)).map((i) => ({ id: i.interest_id, label: interestLabel.get(i.interest_id) ?? null })),
        compatibility: Number(r.compatibility),
        confidence: Number(r.confidence),
        topFactors: (r.top_factors as Array<{ categoryKey: string; score: number; reasonKey: string; params: Record<string, unknown> }>).map(label),
        ...(showBreakdown
          ? {
              differences: (r.differences as Array<{ categoryKey: string; score: number; reasonKey: string; params: Record<string, unknown> }>).map(label),
              breakdown: Object.entries(r.factor_scores as Record<string, number>).map(([k, v]) => ({ categoryKey: k, label: compatCats.get(k) ?? k, score: v })),
            }
          : { differences: null, breakdown: null }),
      };
    }));
  }

  private async compatLabels(locale: string): Promise<Map<string, string>> {
    const rows = await this.db.selectFrom('compatibility_categories as c').leftJoin('compatibility_category_translations as t', 't.category_id', 'c.id').select(['c.key', 't.locale', 't.label']).execute();
    const out = new Map<string, string>();
    for (const chainLocale of [...new Set([locale, locale.split('-')[0]!, 'en'])].reverse()) for (const r of rows) if (r.locale === chainLocale && r.label) out.set(r.key, r.label);
    return out;
  }

  // -------------------------------------------------------------------------------------------- jobs

  /** Keeps smart + daily batches warm for recently active, discoverable users. */
  async precomputeActive(): Promise<void> {
    const since = new Date(Date.now() - 3 * 86_400_000);
    let cursor = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const users = await this.db.selectFrom('users as u').innerJoin('user_profiles as p', 'p.user_id', 'u.id').select('u.id')
        .where('u.status', '=', 'active').where('p.is_discoverable', '=', true).where('u.last_active_at', '>', since).where('u.id', '>', cursor).orderBy('u.id').limit(200).execute();
      if (!users.length) return;
      cursor = users[users.length - 1]!.id;
      for (const u of users) {
        try {
          const fresh = await this.db.selectFrom('match_candidates').select('id').where('user_id', '=', u.id).where('surface', '=', 'smart').where('acted_at', 'is', null).where('served_at', 'is', null).where('expires_at', '>', new Date()).executeTakeFirst();
          if (!fresh) await this.generate(u.id, 'smart');
        } catch (err) {
          this.logger.warn(`precompute ${u.id} failed: ${(err as Error).message}`);
        }
      }
    }
  }
}

function startOfUtcDay(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function endOfUtcDay(): Date {
  return new Date(startOfUtcDay().getTime() + 86_400_000);
}
