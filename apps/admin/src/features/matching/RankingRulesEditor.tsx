'use client';

import { adminMatchingConfigInput } from '@amora/shared';
import { PredicateBuilder } from '@/components/editors/PredicateBuilder';
import { Button } from '@/components/ui/Button';
import { CheckboxField, NumberField, SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { FieldErrors } from '@/lib/forms/validate';
import type { Conversion } from '@/lib/predicate';
import { newRule, RANKING_RULE_TYPES, type ConfigForm, type RankingRuleType, type RuleForm } from './configForm';
import type { FormUpdate } from './ConfigFields';

const MAX_RULES = 50;
const valueSchema = adminMatchingConfigInput.shape.rankingRules.element.shape.value;

/**
 * Ranking rules (boost / penalty / exclude by a predicate over candidate features). Order = priority, so rules
 * can be moved; the condition uses the shared predicate builder.
 */
export function RankingRulesEditor({ form, update, errors, onCondition }: {
  form: ConfigForm;
  update: FormUpdate;
  errors: FieldErrors;
  /** Builder reports go through the page so the initial report does not mark the form dirty. */
  onCondition: (ruleId: string, conversion: Conversion) => void;
}) {
  const rules = form.rankingRules;
  const patch = (id: string, p: Partial<RuleForm>) => update((f) => ({ ...f, rankingRules: f.rankingRules.map((r) => (r.id === id ? { ...r, ...p } : r)) }));
  const move = (i: number, delta: number) =>
    update((f) => {
      const next = [...f.rankingRules];
      const [item] = next.splice(i, 1);
      next.splice(i + delta, 0, item!);
      return { ...f, rankingRules: next };
    });

  return (
    <section className="card" aria-labelledby="matching-rules">
      <h2 id="matching-rules" className="card__title">{t('matching.editor.sections.rules')}</h2>
      <p className="field__hint">{t('matching.editor.rules.hint')}</p>
      {errors.rankingRules ? <p className="field__error" role="alert">{errors.rankingRules}</p> : null}
      {rules.length === 0 ? <p className="muted">{t('matching.editor.rules.empty')}</p> : null}
      <ol className="rules__list">
        {rules.map((r, i) => {
          const name = t('matching.editor.rules.ruleN', { n: i + 1 });
          return (
            <li key={r.id} className="rule" aria-label={name}>
              <div className="row row--between">
                <strong>{name}{r.key ? <> — <code>{r.key}</code></> : null}</strong>
                <div className="row">
                  <Button variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${t('common.moveUp')} — ${name}`}>↑</Button>
                  <Button variant="ghost" size="sm" onClick={() => move(i, 1)} disabled={i === rules.length - 1} aria-label={`${t('common.moveDown')} — ${name}`}>↓</Button>
                  <Button variant="ghost" size="sm" onClick={() => update((f) => ({ ...f, rankingRules: f.rankingRules.filter((x) => x.id !== r.id) }))} aria-label={`${t('common.remove')} — ${name}`}>{t('common.remove')}</Button>
                </div>
              </div>
              <div className="grid grid--3">
                <TextField label={t('common.key')} hint={t('validation.keyFormat')} value={r.key} onChange={(key) => patch(r.id, { key })} error={errors[`rankingRules.${i}.key`]} required spellCheck={false} />
                <SelectField
                  label={t('matching.editor.rules.ruleType')}
                  value={r.ruleType}
                  onChange={(v) => patch(r.id, { ruleType: v as RankingRuleType })}
                  options={RANKING_RULE_TYPES.map((x) => ({ value: x, label: t(`matching.ruleType.${x}`) }))}
                  error={errors[`rankingRules.${i}.ruleType`]}
                  required
                />
                <NumberField
                  label={t('matching.editor.rules.value')}
                  hint={t('matching.editor.rules.valueHint')}
                  value={r.value}
                  onChange={(value) => patch(r.id, { value })}
                  error={errors[`rankingRules.${i}.value`]}
                  min={valueSchema.minValue ?? undefined}
                  max={valueSchema.maxValue ?? undefined}
                  step="any"
                  required
                />
              </div>
              <CheckboxField label={t('common.active')} checked={r.isActive} onChange={(isActive) => patch(r.id, { isActive })} />
              <PredicateBuilder label={t('matching.editor.rules.condition')} initial={r.initialCondition} onChange={(c) => onCondition(r.id, c)} />
              {errors[`rankingRules.${i}.condition`] ? <p className="field__error" role="alert">{errors[`rankingRules.${i}.condition`]}</p> : null}
            </li>
          );
        })}
      </ol>
      <Button variant="secondary" onClick={() => update((f) => ({ ...f, rankingRules: [...f.rankingRules, newRule()] }))} disabled={rules.length >= MAX_RULES}>
        {t('matching.editor.rules.add')}
      </Button>
    </section>
  );
}
