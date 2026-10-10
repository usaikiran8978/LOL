import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { evaluatePredicate, type AdminVersionInput, type AnswerValue } from '@amora/shared';
import { sql } from 'kysely';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import type { ClientContext } from '../../common/http/request-context';
import { JobScheduler } from '../../common/jobs/scheduler';
import { OutboxService } from '../../common/outbox/outbox.service';
import { questionScore, type QuestionDef } from '../matching/engine/compatibility';
import type { AdminContext } from '../admin/auth/admin-auth.service';
import { hasDependencyCycle, normalizeAnswer, type Normalized } from './answers';
import { QuestionRepo, type FullVersion } from './question-repo';

const CHOICE_TYPES = ['single_choice', 'multiple_choice', 'yes_no', 'ranking', 'structured_preference'];
const IMPACT_SAMPLE_PAIRS = 500;
const MIGRATION_BATCH = 500;

export interface PublishIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * Questionnaire builder (BRD §10, §20; TECH §5). Questions are stable identities; all editable content lives on
 * versions. Only drafts are mutable (also enforced by a DB trigger). Publishing supersedes the previous version,
 * is audited, records an impact snapshot and migrates answers only as the admin explicitly configured
 * (`answer_carry_over`), so historical answers are never silently reinterpreted.
 */
@Injectable()
export class QuestionnaireAdminService implements OnModuleInit {
  private readonly logger = new Logger(QuestionnaireAdminService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly repo: QuestionRepo,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly jobs: JobScheduler,
  ) {}

  onModuleInit(): void {
    this.outbox.on('questionnaire.version_published', (p) => this.migrateAnswers(String(p.fromVersionId), String(p.toVersionId)));
    this.jobs.register('questionnaire.publish_scheduled', 60, async () => {
      await this.publishDue();
    });
  }

  // ------------------------------------------------------------------------------------------ reads

  async list(filter: { categoryId?: string; status?: 'active' | 'inactive' | 'archived' | 'draft_only' }) {
    let qb = this.db
      .selectFrom('questions as q')
      .leftJoin('question_versions as pv', 'pv.id', 'q.published_version_id')
      .select([
        'q.id', 'q.key', 'q.category_id', 'q.position', 'q.is_active', 'q.archived_at', 'q.published_version_id', 'pv.version as published_version', 'pv.answer_type', 'pv.is_required', 'pv.weight',
        sql<number>`(SELECT max(version) FROM question_versions v WHERE v.question_id = q.id AND v.status = 'draft')`.as('draft_version'),
        sql<number>`(SELECT count(*)::int FROM question_answers a WHERE a.question_id = q.id AND a.superseded_at IS NULL AND NOT a.is_skipped)`.as('current_answers'),
      ])
      .orderBy('q.category_id')
      .orderBy('q.position');
    if (filter.categoryId) qb = qb.where('q.category_id', '=', filter.categoryId);
    if (filter.status === 'archived') qb = qb.where('q.archived_at', 'is not', null);
    else qb = qb.where('q.archived_at', 'is', null);
    if (filter.status === 'active') qb = qb.where('q.is_active', '=', true);
    if (filter.status === 'inactive') qb = qb.where('q.is_active', '=', false);
    if (filter.status === 'draft_only') qb = qb.where('q.published_version_id', 'is', null);
    const rows = await qb.execute();
    const texts = await this.db
      .selectFrom('question_version_translations')
      .select(['version_id', 'text'])
      .where('locale', '=', 'en')
      .where('version_id', 'in', rows.map((r) => r.published_version_id).filter((x): x is string => !!x).concat(['00000000-0000-0000-0000-000000000000']))
      .execute();
    return rows.map((r) => ({ ...r, weight: r.weight === null ? null : Number(r.weight), text: texts.find((t) => t.version_id === r.published_version_id)?.text ?? null }));
  }

  async get(questionId: string) {
    const q = await this.db.selectFrom('questions').selectAll().where('id', '=', questionId).executeTakeFirst();
    if (!q) throw new AppError('NOT_FOUND');
    const ids = (await this.db.selectFrom('question_versions').select('id').where('question_id', '=', questionId).orderBy('version', 'desc').execute()).map((v) => v.id);
    const versions = await this.repo.versions(ids);
    const mappings = ids.length
      ? await this.db.selectFrom('question_option_mappings as m').innerJoin('question_options as f', 'f.id', 'm.from_option_id').innerJoin('question_options as t', 't.id', 'm.to_option_id')
          .select(['f.key as from_key', 't.key as to_key', 't.version_id']).where('t.version_id', 'in', ids).execute()
      : [];
    const events = await this.db.selectFrom('questionnaire_publish_events as e').innerJoin('question_versions as v', 'v.id', 'e.question_version_id')
      .select(['e.id', 'e.action', 'e.impact_summary', 'e.performed_by', 'e.performed_at', 'v.version']).where('v.question_id', '=', questionId).orderBy('e.performed_at', 'desc').execute();
    return {
      ...q,
      versions: ids.map((id) => ({ ...versions.get(id)!, optionMappings: mappings.filter((m) => m.version_id === id).map((m) => ({ fromOptionKey: m.from_key, toOptionKey: m.to_key })) })),
      history: events,
    };
  }

  // ------------------------------------------------------------------------------------------ writes

  async create(admin: AdminContext, client: ClientContext, input: { key: string; categoryId: string; position?: number; version: AdminVersionInput }) {
    const cat = await this.db.selectFrom('question_categories').select('id').where('id', '=', input.categoryId).executeTakeFirst();
    if (!cat) throw new AppError('VALIDATION_FAILED', 'Unknown category', [{ path: 'categoryId', message: 'unknown' }]);
    try {
      return await this.db.transaction().execute(async (trx) => {
        const pos = input.position ?? (await trx.selectFrom('questions').select(sql<number>`coalesce(max(position) + 1, 0)`.as('p')).where('category_id', '=', input.categoryId).executeTakeFirstOrThrow()).p;
        const q = await trx.insertInto('questions').values({ key: input.key, category_id: input.categoryId, position: pos, created_by: admin.adminId }).returning('id').executeTakeFirstOrThrow();
        const v = await this.insertVersion(trx, q.id, 1, input.version, admin.adminId, null);
        await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'questions.created', targetType: 'question', targetId: q.id, after: { key: input.key, versionId: v }, client }, trx);
        return { questionId: q.id, versionId: v };
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new AppError('CONFLICT', 'Question key already exists');
      throw err;
    }
  }

  /** New draft from explicit content, or a copy of the latest version when `input` is omitted. One draft at a time. */
  async createDraft(admin: AdminContext, client: ClientContext, questionId: string, input?: AdminVersionInput) {
    const q = await this.db.selectFrom('questions').select(['id', 'archived_at']).where('id', '=', questionId).executeTakeFirst();
    if (!q) throw new AppError('NOT_FOUND');
    if (q.archived_at) throw new AppError('CONFLICT', 'Question is archived');
    const existing = await this.db.selectFrom('question_versions').select(['id', 'status']).where('question_id', '=', questionId).where('status', 'in', ['draft', 'scheduled']).executeTakeFirst();
    if (existing?.status === 'draft') throw new AppError('CONFLICT', 'A draft already exists', { draftVersionId: existing.id });
    // A scheduled version must go live (or be cancelled) first; otherwise the next version would fork from stale content.
    if (existing) throw new AppError('CONFLICT', 'A version is scheduled; cancel the schedule or wait for it to publish', { scheduledVersionId: existing.id });
    const latest = await this.db.selectFrom('question_versions').select(['id', 'version']).where('question_id', '=', questionId).orderBy('version', 'desc').limit(1).executeTakeFirstOrThrow();
    const content = input ?? (await this.versionToInput(latest.id));
    return this.db.transaction().execute(async (trx) => {
      const v = await this.insertVersion(trx, questionId, latest.version + 1, content, admin.adminId, latest.id);
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'questions.draft_created', targetType: 'question_version', targetId: v, after: { fromVersionId: latest.id }, client }, trx);
      return { questionId, versionId: v };
    });
  }

  async updateDraft(admin: AdminContext, client: ClientContext, versionId: string, input: AdminVersionInput) {
    const v = await this.db.selectFrom('question_versions').select(['id', 'question_id', 'version', 'status']).where('id', '=', versionId).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND');
    if (v.status !== 'draft') throw new AppError('VERSION_IMMUTABLE', `Version is ${v.status}; create a new draft`);
    const prev = await this.previousPublished(v.question_id);
    return this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('question_options').where('version_id', '=', versionId).execute(); // cascades translations/mappings
      await trx.deleteFrom('question_version_translations').where('version_id', '=', versionId).execute();
      await trx.deleteFrom('question_conditions').where('version_id', '=', versionId).execute();
      await trx.deleteFrom('compatibility_rules').where('source_question_version_id', '=', versionId).execute();
      await trx.updateTable('question_versions').set(this.versionColumns(input)).where('id', '=', versionId).execute();
      await this.insertVersionChildren(trx, versionId, input, admin.adminId, prev?.id ?? null);
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'questions.draft_updated', targetType: 'question_version', targetId: versionId, after: { changeNote: input.changeNote ?? null }, client }, trx);
      return { questionId: v.question_id, versionId };
    });
  }

  /** DEC-010: only never-published drafts can be deleted; a question with no other versions is removed entirely. */
  async deleteDraft(admin: AdminContext, client: ClientContext, versionId: string) {
    const v = await this.db.selectFrom('question_versions').select(['id', 'question_id', 'status']).where('id', '=', versionId).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND');
    if (v.status !== 'draft') throw new AppError('VERSION_IMMUTABLE', 'Only drafts can be deleted; archive published questions instead');
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('question_versions').where('id', '=', versionId).execute();
      const others = await trx.selectFrom('question_versions').select('id').where('question_id', '=', v.question_id).executeTakeFirst();
      if (!others) {
        const referenced = await trx.selectFrom('question_conditions').select('id').where('depends_on_question_id', '=', v.question_id).executeTakeFirst();
        if (referenced) throw new AppError('CONFLICT', 'Other questions depend on this question');
        await trx.deleteFrom('compatibility_rules').where('target_question_id', '=', v.question_id).execute();
        await trx.deleteFrom('questions').where('id', '=', v.question_id).execute();
      }
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'questions.draft_deleted', targetType: 'question_version', targetId: versionId, before: { questionId: v.question_id }, client }, trx);
    });
  }

  async updateMeta(admin: AdminContext, client: ClientContext, questionId: string, input: { categoryId?: string; position?: number }) {
    const before = await this.db.selectFrom('questions').selectAll().where('id', '=', questionId).executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    const set: Record<string, unknown> = {};
    if (input.categoryId) set.category_id = input.categoryId;
    if (input.position !== undefined) set.position = input.position;
    return this.db.transaction().execute(async (trx) => {
      const row = await trx.updateTable('questions').set(set).where('id', '=', questionId).returningAll().executeTakeFirstOrThrow();
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'questions.meta_updated', targetType: 'question', targetId: questionId, before, after: row, client }, trx);
      return row;
    });
  }

  async reorder(admin: AdminContext, client: ClientContext, categoryId: string, ids: string[]) {
    const rows = await this.db.selectFrom('questions').select('id').where('category_id', '=', categoryId).where('id', 'in', ids).execute();
    if (rows.length !== ids.length) throw new AppError('VALIDATION_FAILED', 'All questions must belong to the category');
    await this.db.transaction().execute(async (trx) => {
      for (const [i, id] of ids.entries()) await trx.updateTable('questions').set({ position: i }).where('id', '=', id).execute();
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'questions.reordered', targetType: 'question_category', targetId: categoryId, after: { order: ids }, client }, trx);
    });
  }

  async setActive(admin: AdminContext, client: ClientContext, questionId: string, active: boolean) {
    const q = await this.db.selectFrom('questions').select(['id', 'is_active', 'published_version_id', 'archived_at']).where('id', '=', questionId).executeTakeFirst();
    if (!q) throw new AppError('NOT_FOUND');
    if (active && (!q.published_version_id || q.archived_at)) throw new AppError('CONFLICT', 'Only published, non-archived questions can be activated');
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('questions').set({ is_active: active }).where('id', '=', questionId).execute();
      if (q.published_version_id) await trx.insertInto('questionnaire_publish_events').values({ question_version_id: q.published_version_id, action: active ? 'activate' : 'deactivate', performed_by: admin.adminId }).execute();
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: active ? 'questions.activated' : 'questions.deactivated', targetType: 'question', targetId: questionId, client }, trx);
    });
  }

  async archive(admin: AdminContext, client: ClientContext, questionId: string) {
    const q = await this.db.selectFrom('questions').select(['id', 'published_version_id', 'archived_at']).where('id', '=', questionId).executeTakeFirst();
    if (!q) throw new AppError('NOT_FOUND');
    if (q.archived_at) return;
    const dependents = await this.db
      .selectFrom('question_conditions as c').innerJoin('question_versions as v', 'v.id', 'c.version_id').innerJoin('questions as q', 'q.id', 'v.question_id')
      .select('q.key').where('c.depends_on_question_id', '=', questionId).where('v.status', 'in', ['published', 'draft', 'scheduled']).where('q.archived_at', 'is', null).execute();
    if (dependents.length) throw new AppError('CONFLICT', 'Other questions have conditions on this question', { dependents: dependents.map((d) => d.key) });
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('questions').set({ archived_at: new Date(), is_active: false }).where('id', '=', questionId).execute();
      await trx.deleteFrom('question_versions').where('question_id', '=', questionId).where('status', '=', 'draft').execute();
      if (q.published_version_id) await trx.insertInto('questionnaire_publish_events').values({ question_version_id: q.published_version_id, action: 'archive', performed_by: admin.adminId }).execute();
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'questions.archived', targetType: 'question', targetId: questionId, client }, trx);
    });
  }

  // ------------------------------------------------------------------------------------------ validation / preview / impact

  async validate(versionId: string): Promise<PublishIssue[]> {
    const v = (await this.repo.versions([versionId])).get(versionId);
    if (!v) throw new AppError('NOT_FOUND');
    const issues: PublishIssue[] = [];
    const add = (path: string, code: string, message: string) => issues.push({ path, code, message });
    if (!v.translations.some((t) => t.locale === 'en')) add('translations', 'missing_en', 'English text is required');
    const keys = v.options.map((o) => o.key);
    if (CHOICE_TYPES.includes(v.answerType) && v.options.length < 2) add('options', 'too_few_options', 'At least two options are required');
    if (v.answerType === 'yes_no' && (keys.length !== 2 || !keys.includes('yes') || !keys.includes('no'))) add('options', 'yes_no_options', 'Yes/no questions need exactly the options "yes" and "no"');
    if (!CHOICE_TYPES.includes(v.answerType) && v.options.length) add('options', 'options_not_allowed', `${v.answerType} questions do not take options`);
    for (const o of v.options) if (!v.optionTranslations.some((t) => t.optionId === o.id && t.locale === 'en')) add(`options.${o.key}`, 'missing_en', 'Option needs an English label');
    if (v.answerType === 'scale' && (v.scaleMin === null || v.scaleMax === null || v.scaleMin >= v.scaleMax)) add('scale', 'invalid_scale', 'Scale needs min < max');
    if (v.answerType === 'numeric_range' && v.numericMin !== null && v.numericMax !== null && v.numericMin > v.numericMax) add('numeric', 'invalid_range', 'numericMin must be <= numericMax');
    if (v.minSelections !== null && v.maxSelections !== null && v.minSelections > v.maxSelections) add('selections', 'invalid_selection_bounds', 'minSelections must be <= maxSelections');
    if (v.maxSelections !== null && v.options.length && v.maxSelections > v.options.length) add('selections', 'max_exceeds_options', 'maxSelections exceeds option count');
    if (v.answerType === 'text' && v.isScored) add('isScored', 'text_not_scorable', 'Free-text answers cannot be scored');
    if (v.isRequired && v.targeting === null && v.conditions.length === 0 && v.answerType === 'text') add('isRequired', 'required_text', 'Required free-text questions hurt completion; make it optional');

    for (const c of v.conditions) if (c.dependsOnQuestionId === v.questionId) add('conditions', 'self_dependency', 'A question cannot depend on itself');
    const published = await this.db.selectFrom('question_conditions as c').innerJoin('question_versions as qv', 'qv.id', 'c.version_id')
      .select(['qv.question_id', 'c.depends_on_question_id']).where('qv.status', '=', 'published').where('qv.question_id', '<>', v.questionId).execute();
    const edges: Array<[string, string]> = [...published.map((p) => [p.question_id, p.depends_on_question_id] as [string, string]), ...v.conditions.map((c) => [v.questionId, c.dependsOnQuestionId] as [string, string])];
    if (hasDependencyCycle(edges)) add('conditions', 'dependency_cycle', 'Conditions create a cycle between questions');

    // Rules: source option must exist on this version; target must be published with that option key (or self).
    const targetIds = [...new Set(v.rules.map((r) => r.targetQuestionId).filter((id) => id !== v.questionId))];
    const targets = targetIds.length ? await this.db.selectFrom('questions').select(['id', 'published_version_id']).where('id', 'in', targetIds).execute() : [];
    const targetVersions = await this.repo.versions(targets.map((t) => t.published_version_id).filter((x): x is string => !!x));
    for (const [i, r] of v.rules.entries()) {
      const tv = r.targetQuestionId === v.questionId ? v : targetVersions.get(targets.find((t) => t.id === r.targetQuestionId)?.published_version_id ?? '');
      if (!tv) { add(`rules.${i}`, 'target_unpublished', 'Rule target question must be published'); continue; }
      if (r.targetOptionKey && !tv.options.some((o) => o.key === r.targetOptionKey)) add(`rules.${i}`, 'unknown_target_option', `Target option "${r.targetOptionKey}" does not exist`);
    }

    const prev = await this.previousPublished(v.questionId);
    if (v.answerCarryOver !== 'none') {
      if (!prev) add('answerCarryOver', 'nothing_to_carry', 'No previously published version to carry answers from');
      else {
        const pv = (await this.repo.versions([prev.id])).get(prev.id)!;
        if (pv.answerType !== v.answerType) add('answerCarryOver', 'type_changed', 'Answers cannot be carried over when the answer type changes');
        if (v.answerCarryOver === 'same_options' && CHOICE_TYPES.includes(v.answerType)) {
          const a = pv.options.map((o) => o.key).sort().join(','), b = keys.slice().sort().join(',');
          if (a !== b) add('answerCarryOver', 'options_differ', 'Option keys differ from the published version; use "mapped" with explicit mappings');
        }
        if (v.answerCarryOver === 'mapped') {
          const mapped = await this.db.selectFrom('question_option_mappings as m').innerJoin('question_options as f', 'f.id', 'm.from_option_id').select('f.key').innerJoin('question_options as t', 't.id', 'm.to_option_id').where('t.version_id', '=', v.id).execute();
          const unmapped = pv.options.filter((o) => !mapped.some((m) => m.key === o.key)).map((o) => o.key);
          if (unmapped.length) add('optionMappings', 'unmapped_options', `Previous options without a mapping (those users will be re-asked): ${unmapped.join(', ')}`);
        }
      }
    }
    return issues;
  }

  async preview(versionId: string, locale: string, facts: Record<string, unknown>) {
    const v = (await this.repo.versions([versionId])).get(versionId);
    if (!v) throw new AppError('NOT_FOUND');
    return {
      rendered: this.repo.render(v, locale),
      targetingMatches: v.targeting ? evaluatePredicate(v.targeting, facts) : true,
      conditions: v.conditions,
      issues: await this.validate(versionId),
    };
  }

  /**
   * Impact analysis before publishing (BRD §20). Measures, against real current answers:
   * - how many users have answered the published version and how many would keep their answer after carry-over,
   * - how many users would newly be blocked from completing onboarding (required change),
   * - average change in the question-level compatibility score over a sample of real answer pairs.
   */
  async impact(versionId: string) {
    const v = (await this.repo.versions([versionId])).get(versionId);
    if (!v) throw new AppError('NOT_FOUND');
    const prev = await this.previousPublished(v.questionId);
    const pv = prev ? (await this.repo.versions([prev.id])).get(prev.id)! : null;
    const answers = pv
      ? await this.db.selectFrom('question_answers').select(['user_id', 'value', 'normalized_value', 'importance']).where('question_version_id', '=', pv.id).where('superseded_at', 'is', null).where('is_skipped', '=', false).execute()
      : [];
    const mapping = await this.optionMapping(v, pv);

    let carried = 0;
    const carriedNorm: Array<{ old: Normalized; neu: Normalized | null }> = [];
    for (const a of answers) {
      const neu = pv && v.answerCarryOver !== 'none' ? this.mapAnswer(v, pv, a.value as AnswerValue, mapping) : null;
      if (neu) carried++;
      carriedNorm.push({ old: a.normalized_value as Normalized, neu: neu?.normalized ?? null });
    }

    const { activeUsers } = await this.db.selectFrom('users').select(sql<number>`count(*)::int`.as('activeUsers')).where('status', '=', 'active').executeTakeFirstOrThrow();
    const newlyRequired = v.isRequired && !pv?.isRequired ? activeUsers - carried : 0;

    // Score shift over a deterministic sample of answer pairs (old definition vs new definition + carried answers).
    const qd = (ver: FullVersion): QuestionDef => ({ questionId: ver.questionId, key: '', versionId: ver.id, categoryId: ver.compatibilityCategoryId, weight: ver.weight, isScored: ver.isScored, optionValues: Object.fromEntries(ver.options.map((o) => [o.key, o.numericValue])) });
    let pairs = 0, totalDelta = 0, absDelta = 0;
    if (pv && carriedNorm.length > 1) {
      outer: for (let i = 0; i < carriedNorm.length; i++) {
        for (let j = i + 1; j < carriedNorm.length; j++) {
          if (pairs >= IMPACT_SAMPLE_PAIRS) break outer;
          const a = carriedNorm[i]!, b = carriedNorm[j]!;
          const before = questionScore(qd(pv), { versionId: pv.id, normalized: a.old, importance: null, isDealbreaker: false }, { versionId: pv.id, normalized: b.old, importance: null, isDealbreaker: false });
          const after = a.neu && b.neu ? questionScore(qd(v), { versionId: v.id, normalized: a.neu, importance: null, isDealbreaker: false }, { versionId: v.id, normalized: b.neu, importance: null, isDealbreaker: false }) : null;
          if (before === null) continue;
          pairs++;
          const d = (after ?? 0) - before;
          totalDelta += d;
          absDelta += Math.abs(d);
        }
      }
    }

    return {
      versionId,
      previousVersionId: pv?.id ?? null,
      usersWithCurrentAnswer: answers.length,
      answersCarriedOver: carried,
      usersReasked: answers.length - carried,
      newlyRequiredForUsers: Math.max(0, newlyRequired),
      weightChange: pv ? v.weight - pv.weight : v.weight,
      rulesBefore: pv?.rules.length ?? 0,
      rulesAfter: v.rules.length,
      sampledPairs: pairs,
      avgScoreDelta: pairs ? Math.round((totalDelta / pairs) * 1000) / 1000 : 0,
      avgAbsScoreDelta: pairs ? Math.round((absDelta / pairs) * 1000) / 1000 : 0,
      issues: await this.validate(versionId),
    };
  }

  // ------------------------------------------------------------------------------------------ publish / schedule / rollback

  async publish(admin: AdminContext, client: ClientContext, versionId: string, effectiveAt: string | undefined, acknowledgeImpact: boolean) {
    const v = await this.db.selectFrom('question_versions').select(['id', 'question_id', 'status']).where('id', '=', versionId).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND');
    if (v.status !== 'draft') throw new AppError('VERSION_IMMUTABLE', `Version is ${v.status}`);
    const issues = await this.validate(versionId);
    const blocking = issues.filter((i) => i.code !== 'unmapped_options');
    if (blocking.length) throw new AppError('PUBLISH_VALIDATION_FAILED', undefined, { issues });
    const impact = await this.impact(versionId);
    if (impact.usersReasked > 0 && !acknowledgeImpact) throw new AppError('PUBLISH_VALIDATION_FAILED', 'Publishing re-asks users; acknowledge the impact to continue', { impact, requiresAcknowledgement: true });

    if (effectiveAt && new Date(effectiveAt) > new Date()) {
      await this.db.transaction().execute(async (trx) => {
        await trx.updateTable('question_versions').set({ status: 'scheduled', effective_at: new Date(effectiveAt) }).where('id', '=', versionId).execute();
        await trx.insertInto('questionnaire_publish_events').values({ question_version_id: versionId, action: 'schedule', impact_summary: JSON.stringify(impact), performed_by: admin.adminId }).execute();
        await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'questions.scheduled', targetType: 'question_version', targetId: versionId, after: { effectiveAt }, client }, trx);
      });
      return { status: 'scheduled', effectiveAt, impact };
    }
    await this.doPublish(versionId, admin.adminId, 'publish', impact, client);
    return { status: 'published', impact };
  }

  private async doPublish(versionId: string, adminId: string | null, action: 'publish' | 'rollback', impact: unknown, client?: ClientContext) {
    await this.db.transaction().execute(async (trx) => {
      const v = await trx.selectFrom('question_versions').select(['id', 'question_id', 'status']).where('id', '=', versionId).forUpdate().executeTakeFirstOrThrow();
      const q = await trx.selectFrom('questions').select(['published_version_id', 'is_active']).where('id', '=', v.question_id).forUpdate().executeTakeFirstOrThrow();
      if (q.published_version_id) await trx.updateTable('question_versions').set({ status: 'superseded' }).where('id', '=', q.published_version_id).execute();
      // Status and publish metadata change in one statement: after this the immutability trigger freezes the row.
      await trx.updateTable('question_versions').set({ status: 'published', published_at: new Date(), published_by: adminId }).where('id', '=', versionId).execute();
      // First publish activates the question; later publishes keep the admin's activation choice.
      await trx.updateTable('questions').set({ published_version_id: versionId, ...(q.published_version_id ? {} : { is_active: true }) }).where('id', '=', v.question_id).execute();
      await trx.insertInto('questionnaire_publish_events').values({ question_version_id: versionId, action, impact_summary: impact === undefined ? null : JSON.stringify(impact), performed_by: adminId }).execute();
      await this.audit.record({ actorType: adminId ? 'admin' : 'system', actorId: adminId, action: action === 'rollback' ? 'questions.rolled_back' : 'questions.published', targetType: 'question_version', targetId: versionId, before: { publishedVersionId: q.published_version_id }, client }, trx);
      if (q.published_version_id) await this.outbox.enqueue(trx, 'questionnaire.version_published', { fromVersionId: q.published_version_id, toVersionId: versionId }, { aggregateId: v.question_id });
      await this.outbox.enqueue(trx, 'matching.config_changed', { reason: 'question_published', questionId: v.question_id });
    });
  }

  async publishDue(): Promise<number> {
    const due = await this.db.selectFrom('question_versions').select('id').where('status', '=', 'scheduled').where('effective_at', '<=', new Date()).execute();
    for (const d of due) {
      try {
        // Revalidate at publish time — referenced questions may have changed since scheduling.
        const issues = (await this.validate(d.id)).filter((i) => i.code !== 'unmapped_options');
        if (issues.length) {
          this.logger.warn(`scheduled version ${d.id} no longer valid: ${issues.map((i) => i.code).join(',')}`);
          await this.db.updateTable('question_versions').set({ status: 'draft' }).where('id', '=', d.id).execute();
          continue;
        }
        await this.doPublish(d.id, null, 'publish', await this.impact(d.id));
      } catch (err) {
        this.logger.error(`publishing scheduled version ${d.id} failed: ${(err as Error).message}`);
      }
    }
    return due.length;
  }

  async cancelSchedule(admin: AdminContext, client: ClientContext, versionId: string) {
    const v = await this.db.selectFrom('question_versions').select('status').where('id', '=', versionId).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND');
    if (v.status !== 'scheduled') throw new AppError('CONFLICT', 'Version is not scheduled');
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('question_versions').set({ status: 'draft' }).where('id', '=', versionId).execute();
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'questions.schedule_cancelled', targetType: 'question_version', targetId: versionId, client }, trx);
    });
  }

  /**
   * Rollback never mutates history: it copies the chosen earlier version into a new version and publishes it.
   * Answers carry over only if the option keys are identical; otherwise affected users are re-asked.
   */
  async rollback(admin: AdminContext, client: ClientContext, questionId: string, toVersionId: string) {
    const target = await this.db.selectFrom('question_versions').select(['id', 'question_id', 'status']).where('id', '=', toVersionId).executeTakeFirst();
    if (!target || target.question_id !== questionId) throw new AppError('NOT_FOUND');
    if (target.status === 'draft') throw new AppError('CONFLICT', 'Cannot roll back to a draft');
    const draft = await this.db.selectFrom('question_versions').select('id').where('question_id', '=', questionId).where('status', 'in', ['draft', 'scheduled']).executeTakeFirst();
    if (draft) throw new AppError('CONFLICT', 'Delete or publish the pending draft first', { versionId: draft.id });
    const input = await this.versionToInput(toVersionId);
    const prev = await this.previousPublished(questionId);
    const prevOpts = prev ? (await this.repo.versions([prev.id])).get(prev.id)!.options.map((o) => o.key).sort().join(',') : '';
    input.answerCarryOver = prev && prevOpts === input.options.map((o) => o.key).sort().join(',') ? 'same_options' : 'none';
    input.optionMappings = [];
    input.changeNote = `Rollback to version ${toVersionId}`;
    const { versionId } = await this.createDraft(admin, client, questionId, input);
    const issues = (await this.validate(versionId)).filter((i) => i.code !== 'unmapped_options');
    if (issues.length) {
      await this.deleteDraft(admin, client, versionId);
      throw new AppError('PUBLISH_VALIDATION_FAILED', 'Rollback target is no longer valid', { issues });
    }
    await this.doPublish(versionId, admin.adminId, 'rollback', await this.impact(versionId), client);
    return { versionId };
  }

  // ------------------------------------------------------------------------------------------ carry-over migration

  /** Outbox worker: re-pins current answers from the superseded version to the new one when configured. */
  async migrateAnswers(fromVersionId: string, toVersionId: string): Promise<void> {
    const vs = await this.repo.versions([fromVersionId, toVersionId]);
    const from = vs.get(fromVersionId), to = vs.get(toVersionId);
    if (!from || !to || to.answerCarryOver === 'none') return;
    const mapping = await this.optionMapping(to, from);
    let lastId = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      // Keyset pagination so unmappable answers (left in place) never block later ones.
      const batch = await this.db.selectFrom('question_answers').selectAll().where('question_version_id', '=', fromVersionId).where('superseded_at', 'is', null)
        .where('id', '>', lastId).orderBy('id').limit(MIGRATION_BATCH).execute();
      if (!batch.length) return;
      lastId = batch[batch.length - 1]!.id;
      for (const a of batch) {
        const mapped = a.is_skipped ? null : this.mapAnswer(to, from, a.value as AnswerValue, mapping);
        await this.db.transaction().execute(async (trx) => {
          // Not mappable: leave it pinned to the old version; the user is re-asked (needsReanswer).
          if (!mapped && !a.is_skipped) return;
          await trx.updateTable('question_answers').set({ superseded_at: new Date() }).where('id', '=', a.id).execute();
          const row = await trx.insertInto('question_answers').values({
            user_id: a.user_id, question_id: a.question_id, question_version_id: toVersionId,
            value: mapped ? JSON.stringify(mapped.value) : null, normalized_value: mapped ? JSON.stringify(mapped.normalized) : null,
            importance: a.importance, is_dealbreaker: mapped ? a.is_dealbreaker && mapped.acceptable.length > 0 : false, is_skipped: a.is_skipped,
            carried_over_from: a.id, answered_at: a.answered_at,
          }).returning('id').executeTakeFirstOrThrow();
          if (mapped?.selected.length) await trx.insertInto('question_answer_options').values(mapped.selected.map((s) => ({ answer_id: row.id, option_id: s.optionId, rank: s.rank }))).execute();
          if (mapped?.acceptable.length) await trx.insertInto('question_answer_acceptable').values(mapped.acceptable.map((o) => ({ answer_id: row.id, option_id: o }))).execute();
          await this.outbox.enqueue(trx, 'answers.changed', { userId: a.user_id, questionId: a.question_id }, { aggregateId: a.user_id });
        });
      }
    }
  }

  private async optionMapping(v: FullVersion, prev: FullVersion | null): Promise<Map<string, string[]>> {
    const m = new Map<string, string[]>();
    if (!prev) return m;
    if (v.answerCarryOver === 'same_options') {
      for (const o of prev.options) if (v.options.some((n) => n.key === o.key)) m.set(o.key, [o.key]);
      return m;
    }
    const rows = await this.db.selectFrom('question_option_mappings as mm').innerJoin('question_options as f', 'f.id', 'mm.from_option_id').innerJoin('question_options as t', 't.id', 'mm.to_option_id')
      .select(['f.key as from_key', 't.key as to_key']).where('t.version_id', '=', v.id).execute();
    for (const r of rows) m.set(r.from_key, [...(m.get(r.from_key) ?? []), r.to_key]);
    return m;
  }

  /** Maps a raw answer of `prev` onto `v` and validates it; null when it cannot be carried over faithfully. */
  private mapAnswer(v: FullVersion, prev: FullVersion, value: AnswerValue, mapping: Map<string, string[]>) {
    if (prev.answerType !== v.answerType) return null;
    const mk = (keys: string[]) => {
      const out: string[] = [];
      for (const k of keys) {
        const to = mapping.get(k);
        if (!to?.length) return null;
        out.push(...to);
      }
      return [...new Set(out)];
    };
    let next: AnswerValue | null = null;
    if ('optionKey' in value) {
      const k = mk([value.optionKey]);
      next = k && k.length === 1 ? { optionKey: k[0]! } : null;
    } else if ('acceptableOptionKeys' in value) {
      const k = mk(value.optionKeys), acc = mk(value.acceptableOptionKeys);
      next = k && acc ? { optionKeys: k, acceptableOptionKeys: acc } : null;
    } else if ('optionKeys' in value) {
      const k = mk(value.optionKeys);
      next = k ? { optionKeys: k } : null;
    } else if ('rankedOptionKeys' in value) {
      const k = mk(value.rankedOptionKeys);
      next = k ? { rankedOptionKeys: k } : null;
    } else {
      next = value; // scale / range / text: same shape, bounds re-validated below
    }
    if (!next) return null;
    try {
      return { value: next, ...normalizeAnswer(v, next) };
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------------------------------ analytics

  async analytics(questionId: string) {
    const versions = await this.db.selectFrom('question_versions').select(['id', 'version', 'status']).where('question_id', '=', questionId).where('status', '<>', 'draft').orderBy('version', 'desc').execute();
    if (!versions.length) return { versions: [] };
    const ids = versions.map((v) => v.id);
    const [counts, dist, eligible] = await Promise.all([
      this.db.selectFrom('question_answers').select(['question_version_id', sql<number>`count(*) FILTER (WHERE NOT is_skipped)::int`.as('answered'), sql<number>`count(*) FILTER (WHERE is_skipped)::int`.as('skipped'), sql<number>`count(*) FILTER (WHERE is_dealbreaker)::int`.as('dealbreakers')])
        .where('question_version_id', 'in', ids).where('superseded_at', 'is', null).groupBy('question_version_id').execute(),
      this.db.selectFrom('question_answer_options as ao').innerJoin('question_answers as a', 'a.id', 'ao.answer_id').innerJoin('question_options as o', 'o.id', 'ao.option_id')
        .select(['o.version_id', 'o.key', sql<number>`count(*)::int`.as('n')]).where('o.version_id', 'in', ids).where('a.superseded_at', 'is', null).groupBy(['o.version_id', 'o.key']).execute(),
      this.db.selectFrom('onboarding_progress').select(sql<number>`count(*)::int`.as('n')).where('completed_at', 'is not', null).executeTakeFirstOrThrow(),
    ]);
    return {
      eligibleUsers: eligible.n,
      versions: versions.map((v) => {
        const c = counts.find((x) => x.question_version_id === v.id);
        const answered = c?.answered ?? 0;
        return {
          versionId: v.id, version: v.version, status: v.status, answered, skipped: c?.skipped ?? 0, dealbreakers: c?.dealbreakers ?? 0,
          completionRate: eligible.n ? Math.round((answered / eligible.n) * 1000) / 1000 : 0,
          distribution: dist.filter((d) => d.version_id === v.id).map((d) => ({ optionKey: d.key, count: d.n, share: answered ? Math.round((d.n / answered) * 1000) / 1000 : 0 })),
        };
      }),
    };
  }

  // ------------------------------------------------------------------------------------------ internals

  private previousPublished(questionId: string) {
    return this.db.selectFrom('questions as q').innerJoin('question_versions as v', 'v.id', 'q.published_version_id').select(['v.id', 'v.version']).where('q.id', '=', questionId).executeTakeFirst();
  }

  private versionColumns(input: AdminVersionInput) {
    return {
      answer_type: input.answerType, is_required: input.isRequired, weight: input.weight, compatibility_category_id: input.compatibilityCategoryId,
      is_scored: input.answerType === 'text' ? false : input.isScored, visibility: input.visibility, allow_importance: input.allowImportance,
      allow_dealbreaker: input.allowDealbreaker, allow_skip: input.allowSkip, min_selections: input.minSelections, max_selections: input.maxSelections,
      scale_min: input.scaleMin, scale_max: input.scaleMax, scale_step: input.scaleStep, numeric_min: input.numericMin, numeric_max: input.numericMax,
      numeric_unit: input.numericUnit, text_max_length: input.textMaxLength, targeting: input.targeting ? JSON.stringify(input.targeting) : null,
      answer_carry_over: input.answerCarryOver, change_note: input.changeNote ?? null,
    };
  }

  private async insertVersion(trx: Tx, questionId: string, version: number, input: AdminVersionInput, adminId: string, prevPublishedOrLatestId: string | null): Promise<string> {
    const v = await trx.insertInto('question_versions').values({ question_id: questionId, version, status: 'draft', created_by: adminId, ...this.versionColumns(input) }).returning('id').executeTakeFirstOrThrow();
    const prev = await trx.selectFrom('questions as q').innerJoin('question_versions as pv', 'pv.id', 'q.published_version_id').select('pv.id').where('q.id', '=', questionId).executeTakeFirst();
    await this.insertVersionChildren(trx, v.id, input, adminId, prev?.id ?? prevPublishedOrLatestId);
    return v.id;
  }

  private async insertVersionChildren(trx: Tx, versionId: string, input: AdminVersionInput, adminId: string, previousVersionId: string | null) {
    if (new Set(input.options.map((o) => o.key)).size !== input.options.length) throw new AppError('VALIDATION_FAILED', 'Duplicate option keys');
    await trx.insertInto('question_version_translations').values(Object.entries(input.translations).map(([locale, t]) => ({
      version_id: versionId, locale, text: t.text, help_text: t.helpText ?? null, scale_min_label: t.scaleMinLabel ?? null, scale_max_label: t.scaleMaxLabel ?? null,
    }))).execute();
    const optionIds = new Map<string, string>();
    for (const [position, o] of input.options.entries()) {
      const row = await trx.insertInto('question_options').values({ version_id: versionId, key: o.key, position, numeric_value: o.numericValue ?? null, is_exclusive: o.isExclusive }).returning('id').executeTakeFirstOrThrow();
      optionIds.set(o.key, row.id);
      await trx.insertInto('question_option_translations').values(Object.entries(o.translations).map(([locale, t]) => ({ option_id: row.id, locale, label: t.label }))).execute();
    }
    if (input.conditions.length) {
      const deps = await trx.selectFrom('questions').select('id').where('id', 'in', input.conditions.map((c) => c.dependsOnQuestionId)).execute();
      if (deps.length !== new Set(input.conditions.map((c) => c.dependsOnQuestionId)).size) throw new AppError('VALIDATION_FAILED', 'Condition references an unknown question');
      await trx.insertInto('question_conditions').values(input.conditions.map((c) => ({
        version_id: versionId, group_no: c.groupNo, depends_on_question_id: c.dependsOnQuestionId, operator: c.operator, option_keys: c.optionKeys ?? null, number_a: c.numberA ?? null, number_b: c.numberB ?? null,
      }))).execute();
    }
    if (input.rules.length) {
      const targets = await trx.selectFrom('questions').select('id').where('id', 'in', input.rules.map((r) => r.targetQuestionId)).execute();
      const own = await trx.selectFrom('question_versions').select('question_id').where('id', '=', versionId).executeTakeFirstOrThrow();
      const known = new Set([...targets.map((t) => t.id), own.question_id]);
      for (const r of input.rules) if (!known.has(r.targetQuestionId)) throw new AppError('VALIDATION_FAILED', 'Rule references an unknown target question');
      await trx.insertInto('compatibility_rules').values(input.rules.map((r) => {
        if (r.sourceOptionKey && !optionIds.has(r.sourceOptionKey)) throw new AppError('VALIDATION_FAILED', `Rule source option "${r.sourceOptionKey}" does not exist`);
        return {
          source_question_version_id: versionId, source_option_id: r.sourceOptionKey ? optionIds.get(r.sourceOptionKey)! : null, target_question_id: r.targetQuestionId,
          target_option_key: r.targetOptionKey, rule_type: r.ruleType, score_delta: r.scoreDelta, is_exclusion: r.isExclusion || r.ruleType === 'dealbreaker',
          is_bidirectional: r.isBidirectional, description: r.description ?? null, created_by: adminId,
        };
      })).execute();
    }
    if (input.answerCarryOver === 'mapped' && input.optionMappings.length && previousVersionId) {
      const prevOpts = await trx.selectFrom('question_options').select(['id', 'key']).where('version_id', '=', previousVersionId).execute();
      const rows = input.optionMappings.map((m) => {
        const from = prevOpts.find((o) => o.key === m.fromOptionKey);
        const to = optionIds.get(m.toOptionKey);
        if (!from || !to) throw new AppError('VALIDATION_FAILED', `Invalid option mapping ${m.fromOptionKey} → ${m.toOptionKey}`);
        return { from_option_id: from.id, to_option_id: to };
      });
      await trx.insertInto('question_option_mappings').values(rows).onConflict((oc) => oc.doNothing()).execute();
    }
  }

  private async versionToInput(versionId: string): Promise<AdminVersionInput> {
    const v = (await this.repo.versions([versionId])).get(versionId)!;
    const tr = (locale: string) => v.translations.find((t) => t.locale === locale)!;
    return {
      answerType: v.answerType, isRequired: v.isRequired, weight: v.weight, compatibilityCategoryId: v.compatibilityCategoryId, isScored: v.isScored,
      visibility: v.visibility as AdminVersionInput['visibility'], allowImportance: v.allowImportance, allowDealbreaker: v.allowDealbreaker, allowSkip: v.allowSkip,
      minSelections: v.minSelections, maxSelections: v.maxSelections, scaleMin: v.scaleMin, scaleMax: v.scaleMax, scaleStep: v.scaleStep,
      numericMin: v.numericMin, numericMax: v.numericMax, numericUnit: v.numericUnit, textMaxLength: v.textMaxLength, targeting: v.targeting,
      // A copy keeps identical options, so answers carry over unchanged.
      answerCarryOver: 'same_options', optionMappings: [], changeNote: undefined,
      translations: Object.fromEntries(v.translations.map((t) => [t.locale, { text: tr(t.locale).text, helpText: t.helpText ?? undefined, scaleMinLabel: t.scaleMinLabel ?? undefined, scaleMaxLabel: t.scaleMaxLabel ?? undefined }])),
      options: v.options.map((o) => ({ key: o.key, numericValue: o.numericValue ?? undefined, isExclusive: o.isExclusive, translations: Object.fromEntries(v.optionTranslations.filter((t) => t.optionId === o.id).map((t) => [t.locale, { label: t.label }])) })),
      conditions: v.conditions.map((c) => ({ groupNo: c.groupNo, dependsOnQuestionId: c.dependsOnQuestionId, operator: c.operator, optionKeys: c.optionKeys ?? undefined, numberA: c.numberA ?? undefined, numberB: c.numberB ?? undefined })),
      rules: v.rules.map((r) => ({ sourceOptionKey: r.sourceOptionKey, targetQuestionId: r.targetQuestionId, targetOptionKey: r.targetOptionKey, ruleType: r.ruleType as AdminVersionInput['rules'][number]['ruleType'], scoreDelta: r.scoreDelta, isExclusion: r.isExclusion, isBidirectional: r.isBidirectional, description: r.description ?? undefined })),
    };
  }
}
