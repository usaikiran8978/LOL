import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type Database } from '../../common/db/database';
import { ageOn } from '../auth/age';
import type { Normalized } from '../questionnaire/answers';
import type { AnswerFeature, UserFeatures } from './engine/compatibility';
import type { CandidateSignals } from './engine/ranking';

export interface LoadedUser {
  features: UserFeatures;
  signals: Omit<CandidateSignals, 'compatibility' | 'confidence'>;
  cityId: string | null;
  geohash5: string | null;
}

function ageBand(age: number | null): string {
  if (age === null) return 'unknown';
  const lo = Math.floor(age / 5) * 5;
  return `${lo}-${lo + 4}`;
}

/** Bulk loader: a handful of set-based queries regardless of how many users (no N+1). */
@Injectable()
export class FeaturesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async load(userIds: string[]): Promise<Map<string, LoadedUser>> {
    const ids = [...new Set(userIds)];
    const out = new Map<string, LoadedUser>();
    if (!ids.length) return out;
    const [base, attrs, interests, answers, prefTerms, behavior, risk, boosts, priority, photos] = await Promise.all([
      this.db
        .selectFrom('users as u')
        .innerJoin('user_profiles as p', 'p.user_id', 'u.id')
        .leftJoin('user_preferences as pr', 'pr.user_id', 'u.id')
        .leftJoin('user_locations as l', 'l.user_id', 'u.id')
        .leftJoin('cities as c', 'c.id', 'p.city_id')
        .select([
          'u.id', 'u.date_of_birth', 'u.last_active_at', 'p.gender_id', 'p.dating_intent_id', 'p.relationship_goal_id', 'p.verification_level', 'p.bio',
          'p.city_id', 'p.geohash5', 'p.completeness_score', 'l.latitude', 'l.longitude', 'c.latitude as city_lat', 'c.longitude as city_lon',
          'pr.age_min', 'pr.age_max', 'pr.age_strict', 'pr.max_distance_km', 'pr.distance_strict', 'pr.global_mode', 'pr.verified_only',
        ])
        .where('u.id', 'in', ids)
        .execute(),
      this.db.selectFrom('user_profile_attributes').select(['user_id', 'kind', 'term_id']).where('user_id', 'in', ids).execute(),
      this.db.selectFrom('user_interests').select(['user_id', 'interest_id']).where('user_id', 'in', ids).execute(),
      this.db.selectFrom('question_answers').select(['user_id', 'question_id', 'question_version_id', 'normalized_value', 'importance', 'is_dealbreaker'])
        .where('user_id', 'in', ids).where('superseded_at', 'is', null).where('is_skipped', '=', false).where('normalized_value', 'is not', null).execute(),
      this.db.selectFrom('user_preference_terms').select(['user_id', 'kind', 'term_id', 'is_dealbreaker']).where('user_id', 'in', ids).execute(),
      this.db.selectFrom('user_behavior_stats').selectAll().where('user_id', 'in', ids).execute(),
      this.db.selectFrom('user_risk_scores').select(['user_id', 'score']).where('user_id', 'in', ids).execute(),
      this.db.selectFrom('boosts').select('user_id').distinct().where('user_id', 'in', ids).where('starts_at', '<=', new Date()).where('ends_at', '>', new Date()).execute(),
      this.db.selectFrom('entitlements').select('user_id').distinct().where('user_id', 'in', ids).where('entitlement_key', '=', 'priority_discovery').where('revoked_at', 'is', null)
        .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', new Date())])).execute(),
      this.db.selectFrom('profile_media').select(['user_id', sql<number>`count(*)::int`.as('n')]).where('user_id', 'in', ids).where('kind', '=', 'photo')
        .where('deleted_at', 'is', null).where('moderation_status', '=', 'approved').groupBy('user_id').execute(),
    ]);
    const group = <T extends { user_id: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]);
      return m;
    };
    const attrsBy = group(attrs), intBy = group(interests), ansBy = group(answers), prefBy = group(prefTerms);
    const behaviorBy = new Map(behavior.map((b) => [b.user_id, b]));
    const riskBy = new Map(risk.map((r) => [r.user_id, r.score]));
    const boosted = new Set(boosts.map((b) => b.user_id));
    const prioritized = new Set(priority.map((p) => p.user_id));
    const photosBy = new Map(photos.map((p) => [p.user_id, p.n]));

    for (const u of base) {
      const age = u.date_of_birth ? ageOn(String(u.date_of_birth)) : null;
      const attributes = new Map<string, string[]>();
      for (const a of attrsBy.get(u.id) ?? []) attributes.set(a.kind, [...(attributes.get(a.kind) ?? []), a.term_id]);
      const ans = new Map<string, AnswerFeature>();
      for (const a of ansBy.get(u.id) ?? []) ans.set(a.question_id, { versionId: a.question_version_id, normalized: a.normalized_value as Normalized, importance: a.importance, isDealbreaker: a.is_dealbreaker });
      const pt = prefBy.get(u.id) ?? [];
      const dealbreakerTerms = new Map<string, string[]>();
      for (const p of pt.filter((x) => x.is_dealbreaker && !['gender', 'dating_intent'].includes(x.kind))) dealbreakerTerms.set(p.kind, [...(dealbreakerTerms.get(p.kind) ?? []), p.term_id]);
      const lat = u.latitude ?? u.city_lat;
      const lon = u.longitude ?? u.city_lon;
      const verified = u.verification_level === 'selfie' || u.verification_level === 'identity';
      const b = behaviorBy.get(u.id);
      const inactiveDays = u.last_active_at ? Math.floor((Date.now() - new Date(u.last_active_at).getTime()) / 86_400_000) : null;
      out.set(u.id, {
        cityId: u.city_id,
        geohash5: u.geohash5,
        features: {
          userId: u.id, age, genderTermId: u.gender_id, intentTermId: u.dating_intent_id, goalTermId: u.relationship_goal_id, verified,
          attributes, interests: new Set((intBy.get(u.id) ?? []).map((i) => i.interest_id)),
          location: lat !== null && lat !== undefined && lon !== null && lon !== undefined ? { lat, lon } : null,
          answers: ans,
          prefs: {
            ageMin: u.age_min ?? 18, ageMax: u.age_max ?? 99, ageStrict: u.age_strict ?? true, maxDistanceKm: u.max_distance_km ?? 50,
            distanceStrict: u.distance_strict ?? false, globalMode: u.global_mode ?? false, verifiedOnly: u.verified_only ?? false,
            genderTermIds: pt.filter((p) => p.kind === 'gender').map((p) => p.term_id),
            intentTermIds: pt.filter((p) => p.kind === 'dating_intent' && p.is_dealbreaker).map((p) => p.term_id),
            dealbreakerTerms,
          },
        },
        signals: {
          candidateId: u.id,
          riskScore: riskBy.get(u.id) ?? 0,
          behavior: {
            replyRate: b?.reply_rate_30d === null || b?.reply_rate_30d === undefined ? null : Number(b.reply_rate_30d),
            positiveFeedbackRate: b?.positive_feedback_rate === null || b?.positive_feedback_rate === undefined ? null : Number(b.positive_feedback_rate),
            recommendationAcceptRate: b?.recommendation_accept_rate === null || b?.recommendation_accept_rate === undefined ? null : Number(b.recommendation_accept_rate),
            activeWithinDays: inactiveDays,
          },
          facts: { verified, boosted: boosted.has(u.id), priorityDiscovery: prioritized.has(u.id), hasBio: !!u.bio && u.bio.length >= 20, photoCount: photosBy.get(u.id) ?? 0, inactiveDays: inactiveDays ?? 999, completeness: u.completeness_score, age },
          diversityBuckets: { age_band: ageBand(age), intent: u.dating_intent_id ?? 'none', city: u.city_id ?? 'none', gender: u.gender_id ?? 'none' },
        },
      });
    }
    return out;
  }
}
