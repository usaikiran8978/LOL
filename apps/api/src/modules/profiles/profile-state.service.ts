import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { DATABASE, type Database } from '../../common/db/database';
import { OutboxService } from '../../common/outbox/outbox.service';
import { SettingsService } from '../platform/settings.service';

/** Completeness weights; admin-overridable via system_settings `profile.completeness_weights` (must sum to 100). */
export const DEFAULT_COMPLETENESS_WEIGHTS = {
  displayName: 5, bio: 10, photos: 20, prompts: 10, interests: 10, identity: 10, work: 5, languages: 5, lifestyle: 10, questionnaire: 15,
} as const;
export type CompletenessWeights = Record<keyof typeof DEFAULT_COMPLETENESS_WEIGHTS, number>;

export interface CompletenessInput {
  hasDisplayName: boolean;
  hasBio: boolean;
  photos: number;
  prompts: number;
  interests: number;
  identityFields: number; // of 3: gender, intent, goal
  hasWork: boolean;
  languages: number;
  lifestyleAttributes: number;
  questionnaireRatio: number; // 0..1 of applicable published questions answered
}

/** Pure scoring — unit tested. Partial credit is linear up to each target. */
export function completenessScore(i: CompletenessInput, w: CompletenessWeights = DEFAULT_COMPLETENESS_WEIGHTS): number {
  const part = (v: number, target: number) => Math.min(v / target, 1);
  const score =
    w.displayName * +i.hasDisplayName +
    w.bio * +i.hasBio +
    w.photos * part(i.photos, 3) +
    w.prompts * part(i.prompts, 1) +
    w.interests * part(i.interests, 3) +
    w.identity * part(i.identityFields, 3) +
    w.work * +i.hasWork +
    w.languages * part(i.languages, 1) +
    w.lifestyle * part(i.lifestyleAttributes, 3) +
    w.questionnaire * Math.max(0, Math.min(1, i.questionnaireRatio));
  return Math.round(score);
}

/**
 * Derived profile state: completeness score and discoverability. Recomputed whenever an input changes
 * (profile edits, media ready/deleted, onboarding, moderation, restrictions, privacy).
 */
@Injectable()
export class ProfileStateService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly analytics: AnalyticsService,
    private readonly outbox: OutboxService,
  ) {}

  async recompute(userId: string): Promise<{ completeness: number; discoverable: boolean } | null> {
    const p = await this.db
      .selectFrom('user_profiles as p')
      .innerJoin('users as u', 'u.id', 'p.user_id')
      .leftJoin('onboarding_progress as o', 'o.user_id', 'p.user_id')
      .leftJoin('user_privacy_settings as ps', 'ps.user_id', 'p.user_id')
      .select([
        'p.display_name', 'p.bio', 'p.gender_id', 'p.dating_intent_id', 'p.relationship_goal_id', 'p.profession', 'p.education_level_id',
        'p.completeness_score', 'p.snoozed_until', 'p.moderation_status', 'u.status', 'o.completed_at', 'ps.discoverable_by',
      ])
      .where('p.user_id', '=', userId)
      .executeTakeFirst();
    if (!p) return null;

    const count = (table: 'profile_prompts' | 'user_interests' | 'user_languages', extra?: (qb: any) => any) => {
      let qb = this.db.selectFrom(table).select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', userId);
      if (extra) qb = extra(qb);
      return qb.executeTakeFirstOrThrow().then((r: { n: number }) => r.n);
    };
    const [photos, approvedPhotos, prompts, interests, languages, lifestyle, questionnaire, restricted] = await Promise.all([
      this.db.selectFrom('profile_media').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', userId).where('kind', '=', 'photo').where('deleted_at', 'is', null).where('processing_status', '=', 'ready').where('moderation_status', '<>', 'rejected').executeTakeFirstOrThrow(),
      this.db.selectFrom('profile_media').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', userId).where('kind', '=', 'photo').where('deleted_at', 'is', null).where('processing_status', '=', 'ready').where('moderation_status', '=', 'approved').executeTakeFirstOrThrow(),
      count('profile_prompts', (qb) => qb.where('moderation_status', '<>', 'rejected')),
      count('user_interests'),
      count('user_languages'),
      this.db.selectFrom('user_profile_attributes').select(sql<number>`count(DISTINCT kind)::int`.as('n')).where('user_id', '=', userId).executeTakeFirstOrThrow(),
      this.questionnaireRatio(userId),
      this.db.selectFrom('account_restrictions').select('id').where('user_id', '=', userId).where('kind', 'in', ['no_discovery', 'shadow_limited']).where('lifted_at', 'is', null).where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', new Date())])).executeTakeFirst(),
    ]);

    const weights = await this.settings.get<CompletenessWeights>('profile.completeness_weights', { ...DEFAULT_COMPLETENESS_WEIGHTS });
    const completeness = completenessScore(
      {
        hasDisplayName: !!p.display_name,
        hasBio: !!p.bio && p.bio.trim().length >= 20,
        photos: photos.n,
        prompts,
        interests,
        identityFields: [p.gender_id, p.dating_intent_id, p.relationship_goal_id].filter(Boolean).length,
        hasWork: !!(p.profession || p.education_level_id),
        languages,
        lifestyleAttributes: lifestyle.n,
        questionnaireRatio: questionnaire,
      },
      weights,
    );

    const minPhotos = await this.settings.get<number>('profile.min_approved_photos', 1);
    const discoverable =
      p.status === 'active' &&
      !!p.completed_at &&
      approvedPhotos.n >= minPhotos &&
      p.discoverable_by !== 'nobody' &&
      !(p.snoozed_until && new Date(p.snoozed_until) > new Date()) &&
      p.moderation_status !== 'rejected' &&
      !restricted;

    await this.db.updateTable('user_profiles').set({ completeness_score: completeness, is_discoverable: discoverable }).where('user_id', '=', userId).execute();
    // Search index sync + any other listeners interested in profile visibility/content.
    await this.outbox.enqueue(this.db, 'profile.state_changed', { userId, discoverable }, { aggregateId: userId });
    if (completeness === 100 && p.completeness_score < 100) await this.analytics.track('profile_completed', { userId });
    return { completeness, discoverable };
  }

  /** Share of currently-published, active, required-or-scored questions the user has a current answer for. */
  private async questionnaireRatio(userId: string): Promise<number> {
    const total = await this.db
      .selectFrom('questions as q')
      .innerJoin('question_versions as v', 'v.id', 'q.published_version_id')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('q.is_active', '=', true)
      .where('q.archived_at', 'is', null)
      .executeTakeFirstOrThrow();
    if (total.n === 0) return 1;
    const answered = await this.db
      .selectFrom('question_answers as a')
      .innerJoin('questions as q', 'q.id', 'a.question_id')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('a.user_id', '=', userId)
      .where('a.superseded_at', 'is', null)
      .where('q.is_active', '=', true)
      .where('q.archived_at', 'is', null)
      .executeTakeFirstOrThrow();
    return answered.n / total.n;
  }
}
