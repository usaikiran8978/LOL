import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { evaluatePredicate, type SubmitAnswer } from '@amora/shared';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { OutboxService } from '../../common/outbox/outbox.service';
import { UserFactsService, type UserFacts } from '../platform/user-facts.service';
import { OnboardingService } from '../profiles/onboarding.service';
import { ProfileStateService } from '../profiles/profile-state.service';
import { AnswerValidationError, conditionsMet, normalizeAnswer, type Normalized } from './answers';
import { QuestionRepo } from './question-repo';

@Injectable()
export class QuestionnaireService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly repo: QuestionRepo,
    private readonly facts: UserFactsService,
    private readonly outbox: OutboxService,
    private readonly analytics: AnalyticsService,
    private readonly onboarding: OnboardingService,
    private readonly profileState: ProfileStateService,
  ) {}

  onModuleInit(): void {
    // The onboarding "questionnaire" step is complete when every applicable required question has a current answer.
    this.onboarding.registerCheck('questionnaire', async (userId) => ((await this.status(userId)).requiredRemaining === 0 ? null : 'onboarding.missing.questionnaire'));
  }

  /**
   * Questions this user should see, in order, with their current answers. A question is applicable when its targeting
   * predicate matches the user and its conditions are met by the user's *current* answers. Answers given to an older
   * version are surfaced as `needsReanswer` instead of being reinterpreted (TECH §5).
   */
  async applicable(userId: string, locale: string, facts?: UserFacts) {
    const f = facts ?? (await this.facts.load(userId));
    const [questions, answers] = await Promise.all([this.repo.publishedQuestions(), this.repo.currentAnswers([userId])]);
    const byQuestion = new Map(answers.map((a) => [a.question_id, a]));
    const valid = new Map<string, Normalized>();
    for (const q of questions) {
      const a = byQuestion.get(q.id);
      if (a && !a.is_skipped && a.question_version_id === q.version.id && a.normalized) valid.set(q.id, a.normalized);
    }
    const out = [];
    for (const q of questions) {
      if (q.version.targeting && !evaluatePredicate(q.version.targeting, f)) continue;
      if (!conditionsMet(q.version.conditions, valid)) continue;
      const a = byQuestion.get(q.id);
      const current = !!a && a.question_version_id === q.version.id;
      out.push({
        questionId: q.id,
        key: q.key,
        categoryKey: q.categoryKey,
        ...this.repo.render(q.version, locale),
        answer: current
          ? { skipped: a!.is_skipped, importance: a!.importance, isDealbreaker: a!.is_dealbreaker, value: await this.rawValue(a!.id), answeredAt: new Date(a!.answered_at).toISOString() }
          : null,
        needsReanswer: !!a && !current,
      });
    }
    return out;
  }

  async status(userId: string) {
    const qs = await this.applicable(userId, 'en');
    const answered = qs.filter((q) => q.answer && !q.answer.skipped).length;
    const requiredRemaining = qs.filter((q) => q.isRequired && (!q.answer || q.answer.skipped)).length;
    return { total: qs.length, answered, requiredRemaining, complete: requiredRemaining === 0 && qs.every((q) => q.answer) };
  }

  private async rawValue(answerId: string): Promise<unknown> {
    const row = await this.db.selectFrom('question_answers').select('value').where('id', '=', answerId).executeTakeFirst();
    return row?.value ?? null;
  }

  async submit(userId: string, input: SubmitAnswer): Promise<{ questionId: string; versionId: string }> {
    const q = (await this.repo.publishedQuestions()).find((x) => x.id === input.questionId);
    if (!q) throw new AppError('NOT_FOUND');
    // Client rendered an older version: make it refetch rather than silently mapping its answer.
    if (q.version.id !== input.versionId) throw new AppError('VERSION_STALE', undefined, { currentVersionId: q.version.id });
    const facts = await this.facts.load(userId);
    if (q.version.targeting && !evaluatePredicate(q.version.targeting, facts)) throw new AppError('QUESTION_NOT_APPLICABLE');
    const current = await this.repo.currentAnswers([userId]);
    const valid = new Map(current.filter((a) => !a.is_skipped && a.normalized).map((a) => [a.question_id, a.normalized!]));
    if (!conditionsMet(q.version.conditions, valid)) throw new AppError('QUESTION_NOT_APPLICABLE');

    if (input.skip && (q.version.isRequired || !q.version.allowSkip)) throw new AppError('ANSWER_INVALID', 'This question cannot be skipped', { reason: 'skip_not_allowed' });
    if (input.importance !== undefined && !q.version.allowImportance) throw new AppError('ANSWER_INVALID', undefined, { reason: 'importance_not_allowed' });
    if (input.isDealbreaker && !q.version.allowDealbreaker) throw new AppError('ANSWER_INVALID', undefined, { reason: 'dealbreaker_not_allowed' });

    let norm: ReturnType<typeof normalizeAnswer> | null = null;
    if (!input.skip) {
      try {
        norm = normalizeAnswer(q.version, input.value!, input.acceptableOptionKeys);
      } catch (err) {
        if (err instanceof AnswerValidationError) throw new AppError('ANSWER_INVALID', undefined, { reason: err.reason });
        throw err;
      }
      if (input.isDealbreaker && !norm.acceptable.length && q.version.answerType !== 'scale' && q.version.answerType !== 'numeric_range') {
        throw new AppError('ANSWER_INVALID', 'Deal-breakers need acceptable answers', { reason: 'dealbreaker_requires_acceptable' });
      }
    }

    const firstAnswer = current.length === 0;
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('question_answers').set({ superseded_at: new Date() }).where('user_id', '=', userId).where('question_id', '=', q.id).where('superseded_at', 'is', null).execute();
      const row = await trx
        .insertInto('question_answers')
        .values({
          user_id: userId, question_id: q.id, question_version_id: q.version.id,
          value: input.skip ? null : JSON.stringify(input.value), normalized_value: norm ? JSON.stringify(norm.normalized) : null,
          importance: input.importance ?? null, is_dealbreaker: input.isDealbreaker, is_skipped: input.skip,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (norm?.selected.length) await trx.insertInto('question_answer_options').values(norm.selected.map((s) => ({ answer_id: row.id, option_id: s.optionId, rank: s.rank }))).execute();
      if (norm?.acceptable.length) await trx.insertInto('question_answer_acceptable').values(norm.acceptable.map((o) => ({ answer_id: row.id, option_id: o }))).execute();
      // Matching precompute listens for this (P4).
      await this.outbox.enqueue(trx, 'answers.changed', { userId, questionId: q.id }, { aggregateId: userId });
    });

    if (firstAnswer) await this.analytics.track('questionnaire_started', { userId });
    await this.analytics.track('question_answered', { userId, properties: { questionKey: q.key, skipped: input.skip } });
    const st = await this.status(userId);
    if (st.requiredRemaining === 0) {
      const already = await this.db.selectFrom('analytics_events').select(sql`1`.as('x')).where('user_id', '=', userId).where('name', '=', 'questionnaire_completed').executeTakeFirst();
      if (!already) await this.analytics.track('questionnaire_completed', { userId, properties: { answered: st.answered } });
    }
    await this.profileState.recompute(userId);
    return { questionId: q.id, versionId: q.version.id };
  }
}
