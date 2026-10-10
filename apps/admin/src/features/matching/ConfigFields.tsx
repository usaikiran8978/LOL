'use client';

import { adminMatchingConfigInput } from '@amora/shared';
import { CheckboxField, NumberField, SelectField, TextAreaField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { FieldErrors } from '@/lib/forms/validate';
import {
  bounds, DIVERSITY_DIMENSIONS, IMPORTANCE_LEVELS, MISSING_ANSWER_POLICIES, SECTIONS,
  type ConfigForm, type DiversityDimension, type MissingAnswerPolicy, type ScalarField,
} from './configForm';

export type FormUpdate = (fn: (f: ConfigForm) => ConfigForm) => void;

interface Props {
  form: ConfigForm;
  update: FormUpdate;
  errors: FieldErrors;
}

function Scalar({ name, form, update, errors }: Props & { name: ScalarField }) {
  const b = bounds(name);
  return (
    <NumberField
      label={t(`matching.fields.${name}.label`)}
      hint={t(`matching.fields.${name}.hint`)}
      value={form.scalars[name]}
      onChange={(v) => update((f) => ({ ...f, scalars: { ...f.scalars, [name]: v } }))}
      error={errors[name]}
      min={b.min}
      max={b.max}
      step={b.step}
      required
    />
  );
}

function ScalarGrid({ fields, ...props }: Props & { fields: ScalarField[] }) {
  return (
    <div className="grid grid--3">
      {fields.map((f) => <Scalar key={f} name={f} {...props} />)}
    </div>
  );
}

const multiplierSchema = adminMatchingConfigInput.shape.importanceMultipliers.def.items[0];

/** Candidate pool / thresholds section. */
export function PoolSection(props: Props) {
  return (
    <section className="card" aria-labelledby="matching-pool">
      <h2 id="matching-pool" className="card__title">{t('matching.editor.sections.pool')}</h2>
      <ScalarGrid fields={SECTIONS.pool} {...props} />
    </section>
  );
}

/** Scoring: missing answers, importance multipliers per answer importance, intent default, behavior blend. */
export function ScoringSection({ form, update, errors }: Props) {
  const multErr = errors.importanceMultipliers;
  return (
    <section className="card" aria-labelledby="matching-scoring">
      <h2 id="matching-scoring" className="card__title">{t('matching.editor.sections.scoring')}</h2>
      <div className="grid grid--3">
        <SelectField
          label={t('matching.fields.missingAnswerPolicy.label')}
          hint={t('matching.fields.missingAnswerPolicy.hint')}
          value={form.missingAnswerPolicy}
          onChange={(v) => update((f) => ({ ...f, missingAnswerPolicy: v as MissingAnswerPolicy }))}
          options={MISSING_ANSWER_POLICIES.map((p) => ({ value: p, label: t(`matching.missingAnswerPolicy.${p}`) }))}
          error={errors.missingAnswerPolicy}
          required
        />
        <SelectField
          label={t('matching.fields.defaultImportance.label')}
          hint={t('matching.fields.defaultImportance.hint')}
          value={form.defaultImportance === undefined ? '' : String(form.defaultImportance)}
          onChange={(v) => update((f) => ({ ...f, defaultImportance: v === '' ? undefined : Number(v) }))}
          options={IMPORTANCE_LEVELS.map((l) => ({ value: String(l), label: t(`matching.importance.l${l}`) }))}
          error={errors.defaultImportance}
          required
        />
        <Scalar name="intentDefaultScore" form={form} update={update} errors={errors} />
        <Scalar name="behavioralWeight" form={form} update={update} errors={errors} />
      </div>
      <fieldset className="section">
        <legend>{t('matching.editor.importance.legend')}</legend>
        <p className="field__hint">{t('matching.editor.importance.hint')}</p>
        {multErr ? <p className="field__error" role="alert">{multErr}</p> : null}
        <div className="grid grid--3">
          {IMPORTANCE_LEVELS.map((l) => (
            <NumberField
              key={l}
              label={t('matching.editor.importance.multiplierFor', { level: t(`matching.importance.l${l}`) })}
              value={form.importanceMultipliers[l]}
              onChange={(v) => update((f) => {
                const next = [...f.importanceMultipliers] as ConfigForm['importanceMultipliers'];
                next[l] = v;
                return { ...f, importanceMultipliers: next };
              })}
              error={errors[`importanceMultipliers.${l}`]}
              min={multiplierSchema.minValue ?? undefined}
              max={multiplierSchema.maxValue ?? undefined}
              step="any"
              required
            />
          ))}
        </div>
      </fieldset>
    </section>
  );
}

/** Diversity: max share of one bucket and the dimensions buckets are formed from. */
export function DiversitySection({ form, update, errors }: Props) {
  const toggle = (d: DiversityDimension, on: boolean) =>
    update((f) => ({ ...f, diversityDimensions: on ? [...f.diversityDimensions, d] : f.diversityDimensions.filter((x) => x !== d) }));
  return (
    <section className="card" aria-labelledby="matching-diversity">
      <h2 id="matching-diversity" className="card__title">{t('matching.editor.sections.diversity')}</h2>
      <ScalarGrid fields={SECTIONS.diversity} form={form} update={update} errors={errors} />
      <fieldset className="checkbox-group">
        <legend>{t('matching.fields.diversityDimensions.label')}</legend>
        {DIVERSITY_DIMENSIONS.map((d) => (
          <CheckboxField key={d} label={t(`matching.diversityDimension.${d}`)} checked={form.diversityDimensions.includes(d)} onChange={(on) => toggle(d, on)} />
        ))}
      </fieldset>
      <p className="field__hint">{t('matching.fields.diversityDimensions.hint')}</p>
      {errors.diversityDimensions ? <p className="field__error" role="alert">{errors.diversityDimensions}</p> : null}
    </section>
  );
}

/** Safety thresholds (risk score): exclude above, down-rank above, by factor. */
export function SafetySection(props: Props) {
  return (
    <section className="card" aria-labelledby="matching-safety">
      <h2 id="matching-safety" className="card__title">{t('matching.editor.sections.safety')}</h2>
      <ScalarGrid fields={SECTIONS.safety} {...props} />
    </section>
  );
}

/** Explanations shown to users (top factors and differences) plus internal notes. */
export function ExplanationsSection({ form, update, errors }: Props) {
  return (
    <section className="card" aria-labelledby="matching-explanations">
      <h2 id="matching-explanations" className="card__title">{t('matching.editor.sections.explanations')}</h2>
      <ScalarGrid fields={SECTIONS.explanations} form={form} update={update} errors={errors} />
      <TextAreaField
        label={t('matching.fields.notes.label')}
        hint={t('matching.fields.notes.hint')}
        value={form.notes}
        onChange={(notes) => update((f) => ({ ...f, notes }))}
        error={errors.notes}
        maxLength={2000}
        rows={3}
      />
    </section>
  );
}
