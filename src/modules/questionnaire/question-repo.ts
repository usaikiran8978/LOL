import { Inject, Injectable } from '@nestjs/common';
import { predicate, type Predicate } from '@amora/shared';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { localeChain, pickTranslation } from '../../common/i18n/translations';
import type { ConditionDef, Normalized, VersionDef } from './answers';

export interface FullVersion extends VersionDef {
  version: number;
  numericUnit: string | null;
  status: string;
  weight: number;
  compatibilityCategoryId: string | null;
  isScored: boolean;
  visibility: string;
  targeting: Predicate | null;
  answerCarryOver: string;
  effectiveAt: Date | null;
  changeNote: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  translations: Array<{ locale: string; text: string; helpText: string | null; scaleMinLabel: string | null; scaleMaxLabel: string | null }>;
  optionTranslations: Array<{ optionId: string; locale: string; label: string }>;
  conditions: Array<ConditionDef & { id: string }>;
  rules: Array<{
    id: string; sourceOptionId: string | null; sourceOptionKey: string | null; targetQuestionId: string; targetOptionKey: string | null;
    ruleType: string; scoreDelta: number; isExclusion: boolean; isBidirectional: boolean; description: string | null;
  }>;
}

/** Loads question versions with everything needed to render, validate and score them. */
@Injectable()
export class QuestionRepo {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async versions(ids: string[], trx: Tx | Database = this.db): Promise<Map<string, FullVersion>> {
    if (!ids.length) return new Map();
    const [vs, opts, vtr, otr, conds, rules] = await Promise.all([
      trx.selectFrom('question_versions').selectAll().where('id', 'in', ids).execute(),
      trx.selectFrom('question_options').selectAll().where('version_id', 'in', ids).orderBy('position').execute(),
      trx.selectFrom('question_version_translations').selectAll().where('version_id', 'in', ids).execute(),
      trx.selectFrom('question_option_translations as t').innerJoin('question_options as o', 'o.id', 't.option_id').select(['t.option_id', 't.locale', 't.label', 'o.version_id']).where('o.version_id', 'in', ids).execute(),
      trx.selectFrom('question_conditions').selectAll().where('version_id', 'in', ids).execute(),
      trx.selectFrom('compatibility_rules as r').leftJoin('question_options as o', 'o.id', 'r.source_option_id').select([
        'r.id', 'r.source_question_version_id', 'r.source_option_id', 'o.key as source_option_key', 'r.target_question_id', 'r.target_option_key',
        'r.rule_type', 'r.score_delta', 'r.is_exclusion', 'r.is_bidirectional', 'r.description',
      ]).where('r.source_question_version_id', 'in', ids).execute(),
    ]);
    const out = new Map<string, FullVersion>();
    for (const v of vs) {
      const parsedTargeting = v.targeting ? predicate.safeParse(v.targeting) : null;
      out.set(v.id, {
        id: v.id,
        questionId: v.question_id,
        version: v.version,
        status: v.status,
        answerType: v.answer_type as FullVersion['answerType'],
        isRequired: v.is_required,
        weight: Number(v.weight),
        compatibilityCategoryId: v.compatibility_category_id,
        isScored: v.is_scored,
        visibility: v.visibility,
        allowImportance: v.allow_importance,
        allowDealbreaker: v.allow_dealbreaker,
        allowSkip: v.allow_skip,
        minSelections: v.min_selections,
        maxSelections: v.max_selections,
        scaleMin: v.scale_min,
        scaleMax: v.scale_max,
        scaleStep: v.scale_step,
        numericMin: v.numeric_min === null ? null : Number(v.numeric_min),
        numericMax: v.numeric_max === null ? null : Number(v.numeric_max),
        numericUnit: v.numeric_unit,
        textMaxLength: v.text_max_length,
        targeting: parsedTargeting?.success ? parsedTargeting.data : null,
        answerCarryOver: v.answer_carry_over,
        effectiveAt: v.effective_at,
        changeNote: v.change_note,
        createdAt: v.created_at,
        publishedAt: v.published_at,
        options: opts.filter((o) => o.version_id === v.id).map((o) => ({ id: o.id, key: o.key, numericValue: o.numeric_value === null ? null : Number(o.numeric_value), isExclusive: o.is_exclusive })),
        translations: vtr.filter((t) => t.version_id === v.id).map((t) => ({ locale: t.locale, text: t.text, helpText: t.help_text, scaleMinLabel: t.scale_min_label, scaleMaxLabel: t.scale_max_label })),
        optionTranslations: otr.filter((t) => t.version_id === v.id).map((t) => ({ optionId: t.option_id, locale: t.locale, label: t.label })),
        conditions: conds.filter((c) => c.version_id === v.id).map((c) => ({
          id: c.id, groupNo: c.group_no, dependsOnQuestionId: c.depends_on_question_id, operator: c.operator as ConditionDef['operator'],
          optionKeys: c.option_keys, numberA: c.number_a === null ? null : Number(c.number_a), numberB: c.number_b === null ? null : Number(c.number_b),
        })),
        rules: rules.filter((r) => r.source_question_version_id === v.id).map((r) => ({
          id: r.id, sourceOptionId: r.source_option_id, sourceOptionKey: r.source_option_key, targetQuestionId: r.target_question_id, targetOptionKey: r.target_option_key,
          ruleType: r.rule_type, scoreDelta: Number(r.score_delta), isExclusion: r.is_exclusion, isBidirectional: r.is_bidirectional, description: r.description,
        })),
      });
    }
    return out;
  }

  /** Published + active questions in display order. */
  async publishedQuestions(trx: Tx | Database = this.db) {
    const rows = await trx
      .selectFrom('questions as q')
      .innerJoin('question_categories as c', 'c.id', 'q.category_id')
      .select(['q.id', 'q.key', 'q.category_id', 'q.published_version_id', 'c.key as category_key', 'c.compatibility_category_id as category_compat_id'])
      .where('q.is_active', '=', true)
      .where('q.archived_at', 'is', null)
      .where('q.published_version_id', 'is not', null)
      .where('c.is_active', '=', true)
      .orderBy('c.position')
      .orderBy('q.position')
      .execute();
    const versions = await this.versions(rows.map((r) => r.published_version_id!), trx);
    return rows.map((r) => ({ id: r.id, key: r.key, categoryId: r.category_id, categoryKey: r.category_key, categoryCompatibilityId: r.category_compat_id, version: versions.get(r.published_version_id!)! }));
  }

  /** Current answers for users (answer pinned to its own version). */
  async currentAnswers(userIds: string[], trx: Tx | Database = this.db) {
    if (!userIds.length) return [];
    return trx
      .selectFrom('question_answers')
      .select(['id', 'user_id', 'question_id', 'question_version_id', 'normalized_value', 'importance', 'is_dealbreaker', 'is_skipped', 'answered_at'])
      .where('user_id', 'in', userIds)
      .where('superseded_at', 'is', null)
      .execute()
      .then((rows) => rows.map((r) => ({ ...r, normalized: r.normalized_value as Normalized | null })));
  }

  render(v: FullVersion, locale: string) {
    const tr = pickTranslation(v.translations, locale);
    const chain = localeChain(locale);
    return {
      versionId: v.id,
      answerType: v.answerType,
      text: tr?.text ?? '',
      helpText: tr?.helpText ?? null,
      scaleMinLabel: tr?.scaleMinLabel ?? null,
      scaleMaxLabel: tr?.scaleMaxLabel ?? null,
      isRequired: v.isRequired,
      allowImportance: v.allowImportance,
      allowDealbreaker: v.allowDealbreaker,
      allowSkip: v.allowSkip && !v.isRequired,
      constraints: {
        minSelections: v.minSelections, maxSelections: v.maxSelections, scaleMin: v.scaleMin, scaleMax: v.scaleMax, scaleStep: v.scaleStep,
        numericMin: v.numericMin, numericMax: v.numericMax, numericUnit: v.numericUnit, textMaxLength: v.textMaxLength,
      },
      options: v.options.map((o) => {
        const ot = pickTranslation(v.optionTranslations.filter((t) => t.optionId === o.id && chain.includes(t.locale)), locale);
        return { key: o.key, label: ot?.label ?? o.key, isExclusive: o.isExclusive };
      }),
    };
  }
}
