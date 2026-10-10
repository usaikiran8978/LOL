import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { z } from 'zod';
import type { searchQuery } from '@amora/shared';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../../common/http/cursor';
import { OutboxService } from '../../common/outbox/outbox.service';
import { EntitlementsService } from '../platform/entitlements.service';
import { FlagsService } from '../platform/flags.service';
import { UserFactsService } from '../platform/user-facts.service';
import { compatibility } from './engine/compatibility';
import { FeaturesService } from './features.service';
import { MatchingConfigService } from './matching-config.service';
import { RecommendationsService } from './recommendations.service';
import { SEARCH_INDEX, type SearchIndex } from './search';

const ids = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20) : undefined);
const codes = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter((x) => /^[a-z]{2,3}(-[A-Z]{2})?$/.test(x)).slice(0, 10) : undefined);

@Injectable()
export class DiscoveryService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SEARCH_INDEX) private readonly index: SearchIndex,
    private readonly entitlements: EntitlementsService,
    private readonly flags: FlagsService,
    private readonly facts: UserFactsService,
    private readonly features: FeaturesService,
    private readonly config: MatchingConfigService,
    private readonly recs: RecommendationsService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    // Keeps an external search index in sync; the Postgres adapter ignores these.
    this.outbox.on('profile.state_changed', async (p) => this.sync(String(p.userId)));
  }

  async sync(userId: string): Promise<void> {
    const p = await this.db.selectFrom('user_profiles as p').innerJoin('users as u', 'u.id', 'p.user_id')
      .select(['p.user_id', 'p.is_discoverable', 'u.status', 'u.date_of_birth', 'p.geohash5', 'p.gender_id', 'p.dating_intent_id', 'p.verification_level', 'p.height_cm', 'p.bio', 'u.last_active_at'])
      .where('p.user_id', '=', userId).executeTakeFirst();
    if (!p || p.status !== 'active') return this.index.remove(userId);
    const [i, l, a] = await Promise.all([
      this.db.selectFrom('user_interests').select('interest_id').where('user_id', '=', userId).execute(),
      this.db.selectFrom('user_languages').select('language_code').where('user_id', '=', userId).execute(),
      this.db.selectFrom('user_profile_attributes').select('term_id').where('user_id', '=', userId).execute(),
    ]);
    await this.index.upsert({
      id: userId, discoverable: p.is_discoverable, birthDate: p.date_of_birth ? String(p.date_of_birth) : null, geohash5: p.geohash5, genderId: p.gender_id, intentId: p.dating_intent_id,
      interestIds: i.map((x) => x.interest_id), languageCodes: l.map((x) => x.language_code), attributeIds: a.map((x) => x.term_id),
      verified: ['selfie', 'identity'].includes(p.verification_level), heightCm: p.height_cm, bio: p.bio, lastActive: p.last_active_at ? new Date(p.last_active_at).toISOString() : null,
    });
  }

  /** Advanced search (BRD §8). Age/distance/gender/intent are basic; the rest needs `advanced_filters`. */
  async search(userId: string, q: z.infer<typeof searchQuery>, locale: string) {
    const advanced = !!(q.interestIds || q.languageCodes || q.verifiedOnly || q.heightMinCm || q.heightMaxCm || q.attributeIds || q.q);
    if (advanced) await this.entitlements.require(userId, 'advanced_filters');
    const me = await this.db.selectFrom('user_profiles as p').leftJoin('user_locations as l', 'l.user_id', 'p.user_id').leftJoin('onboarding_progress as o', 'o.user_id', 'p.user_id')
      .select(['p.geohash5', 'o.completed_at']).where('p.user_id', '=', userId).executeTakeFirst();
    if (!me?.completed_at) throw new AppError('PROFILE_INCOMPLETE');
    const c = decodeCursor<[string, string]>(q.cursor, 2);

    const out: Array<{ id: string; lastActive: string }> = [];
    let after = c ? { lastActive: c[0], id: c[1] } : null;
    // Over-fetch and drop blocked / already-swiped people; loop a few times so pages stay full.
    for (let i = 0; i < 5 && out.length < q.limit; i++) {
      const hits = await this.index.search({
        viewerId: userId, ageMin: q.ageMin, ageMax: q.ageMax, originGeohash: me.geohash5, radiusKm: q.maxDistanceKm, genderIds: ids(q.genderIds), intentIds: ids(q.intentIds),
        interestIds: ids(q.interestIds), languageCodes: codes(q.languageCodes), attributeIds: ids(q.attributeIds), verifiedOnly: q.verifiedOnly, heightMinCm: q.heightMinCm,
        heightMaxCm: q.heightMaxCm, q: q.q, after, limit: q.limit * 2,
      });
      if (!hits.length) break;
      after = hits[hits.length - 1]!;
      const hidden = await this.hiddenFor(userId, hits.map((h) => h.id));
      out.push(...hits.filter((h) => !hidden.has(h.id)));
      if (hits.length < q.limit * 2) { after = null; break; }
    }
    const page = out.slice(0, q.limit);
    const cfg = await this.config.forUser(userId);
    const loaded = await this.features.load([userId, ...page.map((p) => p.id)]);
    const seeker = loaded.get(userId)!;
    const rows = page.map((h) => {
      const r = loaded.get(h.id) ? compatibility(cfg.engine, seeker.features, loaded.get(h.id)!.features) : null;
      const ok = r && !r.excluded ? r : null;
      return { id: h.id, candidate_id: h.id, compatibility: ok?.compatibility ?? 0, confidence: ok?.confidence ?? 0, factor_scores: ok?.categoryScores ?? {}, top_factors: ok?.topFactors ?? [], differences: ok?.differences ?? [], surface: 'search' };
    });
    const cards = await this.recs.cards(userId, rows, locale, (await this.facts.load(userId)).entitlements.includes('compatibility_insights'));
    const last = out.length > q.limit ? page.at(-1) : after;
    return { items: cards.map((c) => ({ ...c, candidateRowId: null })), nextCursor: last ? encodeCursor([last.lastActive, last.id]) : null };
  }

  private async hiddenFor(userId: string, candidateIds: string[]): Promise<Set<string>> {
    if (!candidateIds.length) return new Set();
    const [blocks, swipes] = await Promise.all([
      this.db.selectFrom('blocks').select(['blocker_id', 'blocked_id']).where((eb) => eb.or([eb.and([eb('blocker_id', '=', userId), eb('blocked_id', 'in', candidateIds)]), eb.and([eb('blocked_id', '=', userId), eb('blocker_id', 'in', candidateIds)])])).execute(),
      this.db.selectFrom('swipe_actions').select('target_id').where('actor_id', '=', userId).where('target_id', 'in', candidateIds).where('rewound_at', 'is', null).execute(),
    ]);
    return new Set([...blocks.map((b) => (b.blocker_id === userId ? b.blocked_id : b.blocker_id)), ...swipes.map((s) => s.target_id)]);
  }

  // ---------------------------------------------------------------------------------- travel mode

  async createTravelPlan(userId: string, input: { cityId: string; startsOn: string; endsOn: string; visibleToLocals: boolean }) {
    const facts = await this.facts.load(userId);
    await this.flags.assertEnabled('travel_mode', facts);
    await this.entitlements.require(userId, 'travel_mode');
    if (input.endsOn < input.startsOn) throw new AppError('VALIDATION_FAILED', 'endsOn must be on or after startsOn');
    if (input.endsOn < new Date().toISOString().slice(0, 10)) throw new AppError('VALIDATION_FAILED', 'Travel plan is in the past');
    const city = await this.db.selectFrom('cities').select('id').where('id', '=', input.cityId).where('is_active', '=', true).executeTakeFirst();
    if (!city) throw new AppError('VALIDATION_FAILED', 'Unknown city');
    const active = await this.db.selectFrom('travel_plans').select('id').where('user_id', '=', userId).where('is_active', '=', true).where('ends_on', '>=', new Date().toISOString().slice(0, 10)).execute();
    if (active.length >= 5) throw new AppError('LIMIT_REACHED', 'Too many active travel plans');
    const row = await this.db.insertInto('travel_plans').values({ user_id: userId, city_id: input.cityId, starts_on: input.startsOn, ends_on: input.endsOn, visible_to_locals: input.visibleToLocals }).returning('id').executeTakeFirstOrThrow();
    return (await this.listTravelPlans(userId)).find((p) => p.id === row.id)!;
  }

  async listTravelPlans(userId: string) {
    const rows = await this.db.selectFrom('travel_plans as t').innerJoin('cities as c', 'c.id', 't.city_id').select(['t.id', 't.city_id', 'c.name as city_name', 'c.country_code', 't.starts_on', 't.ends_on', 't.visible_to_locals', 't.is_active'])
      .where('t.user_id', '=', userId).where('t.is_active', '=', true).orderBy('t.starts_on').execute();
    return rows.map((r) => ({ id: r.id, cityId: r.city_id, cityName: r.city_name, countryCode: r.country_code, startsOn: r.starts_on, endsOn: r.ends_on, visibleToLocals: r.visible_to_locals, isActive: r.is_active }));
  }

  async cancelTravelPlan(userId: string, id: string) {
    const r = await this.db.updateTable('travel_plans').set({ is_active: false }).where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();
    if (!r.numUpdatedRows) throw new AppError('NOT_FOUND');
  }
}
