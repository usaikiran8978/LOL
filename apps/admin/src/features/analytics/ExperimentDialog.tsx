'use client';

import { ANALYTICS_EVENTS } from '@amora/shared';
import { useId, useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { NumberField, ReadOnlyField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { EXPERIMENT_SURFACES, type ExperimentRow } from '@/lib/api/modules/analytics';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import type { FieldErrors } from '@/lib/forms/validate';
import {
  allocationTotal, blankVariant, emptyExperimentForm, experimentInputSchema, experimentKeySchema, experimentToForm, formToBody,
  type ExperimentForm, type VariantForm,
} from './experimentSchema';

export interface SegmentRef { id: string; key: string }

interface Props {
  experiment: ExperimentRow | null;
  /** Segments for the picker; null when the admin cannot list them (needs flags.manage) or the lookup failed. */
  segments: SegmentRef[] | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ExperimentDialog({ experiment, segments, onClose, onSaved }: Props) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  // The list endpoint returns segment_id only; the upsert takes the segment key (contract gap), so map it back.
  const resolvedSegment = experiment?.segment_id ? segments?.find((s) => s.id === experiment.segment_id)?.key : undefined;
  const unresolvedSegment = !!experiment?.segment_id && resolvedSegment === undefined;
  const [form, setForm] = useState<ExperimentForm>(() => (experiment ? experimentToForm(experiment, resolvedSegment ?? '') : emptyExperimentForm()));
  const set = <K extends keyof ExperimentForm>(k: K) => (v: ExperimentForm[K]) => setForm((s) => ({ ...s, [k]: v }));

  const metricOptions = Array.from(new Set<string>([...ANALYTICS_EVENTS, ...(form.primaryMetric ? [form.primaryMetric] : [])])).map((m) => ({ value: m, label: m }));

  function save() {
    const key = experiment ? experiment.key : form.key.trim();
    const { body, extraErrors } = formToBody(form);
    if (!experiment && !experimentKeySchema.safeParse(key).success) extraErrors.key = t('analytics.experiments.keyFormat');
    // Saving with an empty key would silently drop targeting the admin cannot see.
    if (unresolvedSegment && !form.segmentKey.trim()) extraErrors.segmentKey = t('analytics.experiments.segmentRequired');
    void submit(experimentInputSchema, body, () => api.analytics.upsertExperiment(key, body), extraErrors).then((ok) => {
      if (!ok) return;
      notify(t('analytics.experiments.saved'));
      onSaved();
      onClose();
    });
  }

  return (
    <FormDialog
      title={experiment ? t('analytics.experiments.editExperiment', { key: experiment.key }) : t('analytics.experiments.newExperiment')}
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      error={error}
      fieldErrors={fieldErrors}
      size="lg"
    >
      {experiment ? (
        <ReadOnlyField label={t('analytics.experiments.key')} value={experiment.key} hint={t('common.immutableHint')} />
      ) : (
        <TextField label={t('analytics.experiments.key')} hint={t('analytics.experiments.keyHint')} value={form.key} onChange={set('key')} error={fieldErrors.key} required data-autofocus spellCheck={false} autoComplete="off" />
      )}
      <div className="grid grid--2">
        <SelectField
          label={t('analytics.experiments.surface')}
          value={form.surface}
          onChange={(v) => set('surface')(v as ExperimentForm['surface'])}
          options={EXPERIMENT_SURFACES.map((s) => ({ value: s, label: t(`analytics.experiments.surfaces.${s}`) }))}
          error={fieldErrors.surface}
          required
        />
        <NumberField label={t('analytics.experiments.trafficPct')} hint={t('analytics.experiments.trafficHint')} value={form.trafficPct} onChange={set('trafficPct')} error={fieldErrors.trafficPct} min={1} max={100} step={1} required />
      </div>
      <SelectField
        label={t('analytics.experiments.primaryMetric')}
        hint={t('analytics.experiments.primaryMetricHint')}
        value={form.primaryMetric}
        onChange={set('primaryMetric')}
        options={metricOptions}
        placeholder=""
        error={fieldErrors.primaryMetric}
        required
      />
      {segments && !unresolvedSegment ? (
        <SelectField
          label={t('analytics.experiments.segment')}
          hint={t('analytics.experiments.segmentHint')}
          value={form.segmentKey}
          onChange={set('segmentKey')}
          options={segments.map((s) => ({ value: s.key, label: s.key }))}
          placeholder={t('analytics.experiments.noSegment')}
          error={fieldErrors.segmentKey}
        />
      ) : (
        <TextField
          label={t('analytics.experiments.segmentKey')}
          hint={unresolvedSegment ? t('analytics.experiments.segmentUnknown', { id: experiment?.segment_id ?? '' }) : t('analytics.experiments.segmentHint')}
          value={form.segmentKey}
          onChange={set('segmentKey')}
          error={fieldErrors.segmentKey}
          maxLength={64}
          spellCheck={false}
          autoComplete="off"
        />
      )}
      <TextAreaField label={t('analytics.experiments.hypothesis')} value={form.hypothesis} onChange={set('hypothesis')} error={fieldErrors.hypothesis} rows={2} maxLength={2000} />
      <VariantsEditor variants={form.variants} surface={form.surface} onChange={set('variants')} errors={fieldErrors} total={allocationTotal(form)} />
    </FormDialog>
  );
}

function VariantsEditor({ variants, surface, onChange, errors, total }: {
  variants: VariantForm[]; surface: string; onChange: (v: VariantForm[]) => void; errors: FieldErrors; total: number;
}) {
  const controlName = useId();
  const update = (i: number, patch: Partial<VariantForm>) => onChange(variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const setControl = (i: number) => onChange(variants.map((v, j) => ({ ...v, isControl: j === i })));

  return (
    <fieldset className="stack">
      <legend>{t('analytics.experiments.variants')}</legend>
      <p role="status" aria-live="polite" className={total === 100 ? 'muted' : undefined}>{t('analytics.experiments.allocationTotal', { total })}</p>
      {errors.variants ? <p className="field__error" role="alert">{errors.variants}</p> : null}
      {variants.map((v, i) => (
        <fieldset key={v.uid} className="card stack">
          <legend>{t('analytics.experiments.variant', { n: i + 1 })}</legend>
          <div className="grid grid--2">
            <TextField label={t('analytics.experiments.variantKey')} value={v.key} onChange={(key) => update(i, { key })} error={errors[`variants.${i}.key`]} maxLength={40} spellCheck={false} autoComplete="off" required />
            <NumberField label={t('analytics.experiments.allocation')} value={v.allocation} onChange={(allocation) => update(i, { allocation })} error={errors[`variants.${i}.allocation`]} min={1} max={100} step={1} required />
          </div>
          <div className="field field--checkbox">
            <input id={`${controlName}-${v.uid}`} type="radio" name={controlName} checked={v.isControl} onChange={() => setControl(i)} />
            <label htmlFor={`${controlName}-${v.uid}`}>{t('analytics.experiments.controlLabel')}</label>
          </div>
          <TextAreaField
            label={t('analytics.experiments.config')}
            hint={surface === 'matching' ? t('analytics.experiments.matchingConfigHint') : t('analytics.experiments.configHint')}
            value={v.configText}
            onChange={(configText) => update(i, { configText })}
            error={errors[`variants.${i}.config`]}
            rows={3}
            spellCheck={false}
            className="code-input"
          />
          {variants.length > 2 ? (
            <div className="toolbar">
              <Button variant="ghost" size="sm" onClick={() => onChange(variants.filter((_, j) => j !== i))}>
                {t('analytics.experiments.removeVariant', { n: i + 1 })}
              </Button>
            </div>
          ) : null}
        </fieldset>
      ))}
      {variants.length < 6 ? (
        <div className="toolbar">
          <Button variant="secondary" size="sm" onClick={() => onChange([...variants, blankVariant(false)])}>{t('analytics.experiments.addVariant')}</Button>
        </div>
      ) : null}
    </fieldset>
  );
}
