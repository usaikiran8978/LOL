import { Inject, Injectable } from '@nestjs/common';
import { evaluatePredicate, predicate } from '@amora/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { SettingsService } from '../platform/settings.service';
import { UserFactsService } from '../platform/user-facts.service';
import { ProfileStateService } from './profile-state.service';

/** Shape of `onboarding_flows.steps`, validated on read and on admin write. */
export const flowSteps = z
  .array(z.object({ key: z.string().regex(/^[a-z_]{2,50}$/), required: z.boolean(), condition: predicate.optional() }))
  .min(1)
  .max(40)
  .refine((s) => new Set(s.map((x) => x.key)).size === s.length, 'duplicate step keys');
export type FlowStep = z.infer<typeof flowSteps>[number];

/** A check returns null when satisfied, or a reason key the client can show. */
export type StepCheck = (userId: string) => Promise<string | null>;

@Injectable()
export class OnboardingService {
  private readonly checks = new Map<string, StepCheck>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly facts: UserFactsService,
    private readonly state: ProfileStateService,
    private readonly analytics: AnalyticsService,
  ) {
    const profile = (col: string) => async (userId: string) => {
      const p = await this.db.selectFrom('user_profiles').select(sql<unknown>`${sql.ref(col)}`.as('v')).where('user_id', '=', userId).executeTakeFirst();
      return p?.v ? null : `onboarding.missing.${col}`;
    };
    const attr = (kinds: string[]) => async (userId: string) => {
      const r = await this.db.selectFrom('user_profile_attributes').select('kind').where('user_id', '=', userId).where('kind', 'in', kinds).executeTakeFirst();
      return r ? null : 'onboarding.missing.attribute';
    };
    this.registerCheck('profile_basics', profile('display_name'));
    this.registerCheck('location', profile('city_id'));
    this.registerCheck('gender', profile('gender_id'));
    this.registerCheck('orientation', profile('orientation_id'));
    this.registerCheck('dating_intent', profile('dating_intent_id'));
    this.registerCheck('relationship_goal', profile('relationship_goal_id'));
    this.registerCheck('lifestyle', attr(['lifestyle_drinking', 'lifestyle_smoking', 'lifestyle_exercise', 'lifestyle_diet', 'lifestyle_social', 'lifestyle_sleep', 'lifestyle_cannabis', 'pets']));
    this.registerCheck('family', attr(['children_have', 'children_want', 'family_plans']));
    this.registerCheck('values', attr(['religion', 'religion_importance', 'politics']));
    this.registerCheck('communication_style', attr(['communication_style', 'love_language']));
    this.registerCheck('preferences', async (userId) => {
      const g = await this.db.selectFrom('user_preference_terms').select('term_id').where('user_id', '=', userId).where('kind', '=', 'gender').executeTakeFirst();
      return g ? null : 'onboarding.missing.gender_preference';
    });
    this.registerCheck('interests', async (userId) => {
      const min = await this.settings.get<number>('onboarding.min_interests', 3);
      const { n } = await this.db.selectFrom('user_interests').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', userId).executeTakeFirstOrThrow();
      return n >= min ? null : 'onboarding.missing.interests';
    });
    this.registerCheck('photos', async (userId) => {
      const min = await this.settings.get<number>('onboarding.min_photos', 2);
      const { n } = await this.db
        .selectFrom('profile_media')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('user_id', '=', userId).where('kind', '=', 'photo').where('deleted_at', 'is', null)
        .where('processing_status', 'in', ['processing', 'ready']).where('moderation_status', '<>', 'rejected')
        .executeTakeFirstOrThrow();
      return n >= min ? null : 'onboarding.missing.photos';
    });
    this.registerCheck('prompts', async (userId) => {
      const r = await this.db.selectFrom('profile_prompts').select('id').where('user_id', '=', userId).executeTakeFirst();
      return r ? null : 'onboarding.missing.prompts';
    });
    this.registerCheck('languages', async (userId) => {
      const r = await this.db.selectFrom('user_languages').select('language_code').where('user_id', '=', userId).executeTakeFirst();
      return r ? null : 'onboarding.missing.languages';
    });
    // Steps without a registered check (permissions, verification intro, tips) are acknowledgement steps.
  }

  registerCheck(stepKey: string, check: StepCheck): void {
    this.checks.set(stepKey, check);
  }

  private async flow(): Promise<{ version: number; steps: FlowStep[] }> {
    const row = await this.db.selectFrom('onboarding_flows').select(['version', 'steps']).where('status', '=', 'published').orderBy('version', 'desc').limit(1).executeTakeFirst();
    if (!row) throw new AppError('INTERNAL', 'No published onboarding flow');
    return { version: row.version, steps: flowSteps.parse(row.steps) };
  }

  async state_(userId: string) {
    const [{ version, steps }, progress, facts] = await Promise.all([
      this.flow(),
      this.db.selectFrom('onboarding_progress').selectAll().where('user_id', '=', userId).executeTakeFirst(),
      this.facts.load(userId),
    ]);
    const completed = new Set(progress?.completed_steps ?? []);
    const evaluated = await Promise.all(
      steps.map(async (s) => {
        const applicable = !s.condition || evaluatePredicate(s.condition, facts);
        const check = this.checks.get(s.key);
        // Data-backed steps are complete when the data is there (also covers edits made elsewhere).
        // Optional data steps also count as done when the user explicitly skipped them.
        const satisfied = check ? (await check(userId)) === null || (!s.required && completed.has(s.key)) : completed.has(s.key);
        return { key: s.key, required: s.required, applicable, completed: satisfied, hasCheck: !!check };
      }),
    );
    const applicable = evaluated.filter((s) => s.applicable);
    const next = applicable.find((s) => !s.completed && !completed.has(s.key));
    return {
      flowVersion: version,
      steps: applicable.map(({ hasCheck: _h, ...s }) => s),
      currentStep: progress?.completed_at ? null : (next?.key ?? null),
      progress: applicable.length ? Math.round((applicable.filter((s) => s.completed || completed.has(s.key)).length / applicable.length) * 100) : 100,
      draft: (progress?.draft ?? {}) as Record<string, unknown>,
      completedAt: progress?.completed_at ? new Date(progress.completed_at).toISOString() : null,
      canComplete: applicable.filter((s) => s.required).every((s) => s.completed),
    };
  }

  async saveStep(userId: string, step: string, draft: Record<string, unknown> | undefined, complete: boolean, skip = false) {
    const { version, steps } = await this.flow();
    const def = steps.find((s) => s.key === step);
    if (!def) throw new AppError('ONBOARDING_STEP_INVALID', `Unknown step ${step}`);
    if (skip && def.required) throw new AppError('ONBOARDING_STEP_INVALID', 'Required steps cannot be skipped', { step, reason: 'onboarding.required' });
    if (skip) complete = true;
    else if (complete) {
      const check = this.checks.get(step);
      const reason = check ? await check(userId) : null;
      if (reason) throw new AppError('ONBOARDING_STEP_INVALID', 'Step requirements not met', { step, reason });
    }
    await this.db
      .insertInto('onboarding_progress')
      .values({ user_id: userId, flow_version: version, current_step: step, completed_steps: complete ? [step] : [], draft: JSON.stringify(complete ? {} : (draft ?? {})) })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet({
          flow_version: version,
          current_step: step,
          draft: JSON.stringify(complete ? {} : (draft ?? {})),
          completed_steps: complete ? sql<string[]>`(SELECT array_agg(DISTINCT s) FROM unnest(onboarding_progress.completed_steps || ARRAY[${step}]::text[]) s)` : sql<string[]>`onboarding_progress.completed_steps`,
        }),
      )
      .execute();
    if (complete) await this.analytics.track('onboarding_step_completed', { userId, properties: { step, flowVersion: version, skipped: skip } });
    return this.state_(userId);
  }

  async complete(userId: string) {
    const s = await this.state_(userId);
    if (s.completedAt) return s;
    if (!s.canComplete) {
      throw new AppError('ONBOARDING_STEP_INVALID', 'Required steps incomplete', { missing: s.steps.filter((x) => x.required && !x.completed).map((x) => x.key) });
    }
    await this.db
      .insertInto('onboarding_progress')
      .values({ user_id: userId, flow_version: s.flowVersion, current_step: 'done', completed_at: new Date() })
      .onConflict((oc) => oc.column('user_id').doUpdateSet({ completed_at: new Date(), current_step: 'done' }))
      .execute();
    await this.analytics.track('onboarding_completed', { userId, properties: { flowVersion: s.flowVersion } });
    await this.state.recompute(userId);
    return this.state_(userId);
  }
}
