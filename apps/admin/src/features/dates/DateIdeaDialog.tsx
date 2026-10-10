'use client';

import type { TaxonomyKind } from '@amora/shared';
import { useState } from 'react';
import { TranslationEditor, translationsFromServer, translationsToPayload, type TranslationFieldSpec, type TranslationValues } from '@/components/editors/TranslationEditor';
import { useNotify } from '@/components/shell/notice';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import { dateIdeaUpsert, IDEA_KEY_RE, TIMES_OF_DAY, type DateIdea, type TimeOfDay } from '@/lib/api/modules/dates';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { parseList, scopedErrors, type FieldErrors } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';
import { InterestsField } from '../events/EventPickers';

const FIELDS: TranslationFieldSpec<'title' | 'description'>[] = [
  { name: 'title', labelKey: 'dates.ideas.fieldTitle', maxLength: 120 },
  { name: 'description', labelKey: 'dates.ideas.fieldDescription', kind: 'textarea', maxLength: 1000 },
];

type Indoor = '' | 'yes' | 'no';

export function indoorLabel(v: boolean | null): string {
  return v === null ? t('dates.ideas.indoorAny') : v ? t('dates.ideas.indoorYes') : t('dates.ideas.indoorNo');
}

/** `PUT admin/dates/ideas/:key` — create or replace a date idea. The key is immutable after creation. */
export function DateIdeaDialog({ idea, onClose, onSaved }: { idea: DateIdea | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [key, setKey] = useState(idea?.key ?? '');
  const [activityType, setActivityType] = useState(idea?.activityType ?? '');
  const [budgetKey, setBudgetKey] = useState(idea?.budgetKey ?? '');
  const [stages, setStages] = useState<string[]>(idea?.dateStageKeys ?? []);
  const [interestIds, setInterestIds] = useState<string[]>(idea?.interestIds ?? []);
  const [indoor, setIndoor] = useState<Indoor>(idea?.indoor === true ? 'yes' : idea?.indoor === false ? 'no' : '');
  const [times, setTimes] = useState<TimeOfDay[]>(idea?.timeOfDay ?? []);
  const [duration, setDuration] = useState<number | undefined>(idea?.typicalDurationMin ?? undefined);
  const [safetyTipsKey, setSafetyTipsKey] = useState(idea?.safetyTipsKey ?? '');
  const [isActive, setActive] = useState(idea?.isActive ?? true);
  const [translations, setTranslations] = useState<TranslationValues<'title' | 'description'>>(() => translationsFromServer(FIELDS, idea?.translations));

  async function save() {
    const ideaKey = idea?.key ?? key.trim();
    const extra: FieldErrors = idea || IDEA_KEY_RE.test(ideaKey) ? {} : { key: t('dates.ideas.keyHint') };
    const payload = {
      activityType: activityType.trim(),
      budgetKey: budgetKey.trim() || null,
      dateStageKeys: stages,
      interestIds,
      indoor: indoor === '' ? null : indoor === 'yes',
      timeOfDay: times,
      typicalDurationMin: duration ?? null,
      safetyTipsKey: safetyTipsKey.trim() || null,
      isActive,
      translations: translationsToPayload(FIELDS, translations),
    };
    const ok = await submit(dateIdeaUpsert, payload, (d) => api.dates.upsertIdea(ideaKey, d), extra);
    if (ok) {
      notify(t('dates.ideas.saved', { key: ideaKey }));
      onSaved();
      onClose();
    }
  }

  const listError = (prefix: string) => fieldErrors[prefix] ?? Object.entries(fieldErrors).find(([k]) => k.startsWith(`${prefix}.`))?.[1];

  return (
    <FormDialog title={idea ? t('dates.ideas.editIdea', { key: idea.key }) : t('dates.ideas.newIdea')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} size="lg">
      <div className="grid grid--2">
        {idea ? (
          <ReadOnlyField label={t('common.key')} value={idea.key} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('common.key')} hint={t('dates.ideas.keyHint')} value={key} onChange={setKey} error={fieldErrors.key} required maxLength={60} spellCheck={false} autoComplete="off" data-autofocus />
        )}
        <TextField label={t('dates.ideas.activityType')} hint={t('dates.ideas.activityTypeHint')} value={activityType} onChange={setActivityType} error={fieldErrors.activityType} required maxLength={50} />
        <TermSelect kind="budget_tier" label={t('dates.ideas.budget')} hint={t('dates.ideas.budgetHint')} value={budgetKey} onChange={setBudgetKey} error={fieldErrors.budgetKey} />
        <SelectField
          label={t('dates.ideas.indoor')}
          value={indoor}
          onChange={(v) => setIndoor(v as Indoor)}
          placeholder={t('dates.ideas.indoorAny')}
          options={[{ value: 'yes', label: t('dates.ideas.indoorYes') }, { value: 'no', label: t('dates.ideas.indoorNo') }]}
        />
        <NumberField label={t('dates.ideas.duration')} hint={t('dates.ideas.durationHint')} value={duration} onChange={setDuration} error={fieldErrors.typicalDurationMin} min={10} max={1440} step={1} />
        <TextField label={t('dates.ideas.safetyTipsKey')} hint={t('dates.ideas.safetyTipsKeyHint')} value={safetyTipsKey} onChange={setSafetyTipsKey} error={fieldErrors.safetyTipsKey} maxLength={100} spellCheck={false} />
      </div>

      <fieldset className="field">
        <legend className="field__label">{t('dates.ideas.timeOfDay')}</legend>
        <p className="field__hint">{t('dates.ideas.timeOfDayHint')}</p>
        <div className="grid grid--3">
          {TIMES_OF_DAY.map((x) => (
            <CheckboxField key={x} label={t(`dates.ideas.times.${x}`)} checked={times.includes(x)} onChange={(on) => setTimes(on ? [...times, x] : times.filter((y) => y !== x))} />
          ))}
        </div>
      </fieldset>

      <StagesField value={stages} onChange={setStages} error={listError('dateStageKeys')} />
      <InterestsField value={interestIds} onChange={setInterestIds} error={listError('interestIds')} hint={t('dates.ideas.interestsHint')} />
      <CheckboxField label={t('common.active')} checked={isActive} onChange={setActive} />
      <TranslationEditor fields={FIELDS} value={translations} onChange={setTranslations} errors={scopedErrors(fieldErrors, 'translations')} />
    </FormDialog>
  );
}

const termLabel = (x: { key: string; translations: Record<string, { label?: string | null }> }) => x.translations.en?.label ?? x.key;

/** Taxonomy terms are listed with `taxonomy.manage`; otherwise the key is typed. */
function useTerms(kind: TaxonomyKind) {
  const api = useAdminApi();
  const { can } = useSession();
  const allowed = can('taxonomy.manage');
  return { allowed, terms: useResource(() => (allowed ? api.taxonomy.terms(kind) : Promise.resolve(null)), [api, allowed, kind]) };
}

function TermSelect({ kind, label, hint, value, onChange, error }: { kind: TaxonomyKind; label: string; hint: string; value: string; onChange: (v: string) => void; error?: string }) {
  const { allowed, terms } = useTerms(kind);
  if (allowed && terms.status === 'loading') return <LoadingState />;
  if (allowed && terms.status === 'error') return <ErrorState error={terms.error} onRetry={terms.reload} />;
  if (terms.status === 'success' && terms.data) {
    const options = terms.data.filter((x) => x.is_active || x.key === value).map((x) => ({ value: x.key, label: termLabel(x) }));
    return <SelectField label={label} value={value} onChange={onChange} options={options} placeholder={t('common.none')} error={error} />;
  }
  return <TextField label={label} hint={hint} value={value} onChange={onChange} error={error} maxLength={50} spellCheck={false} />;
}

function StagesField({ value, onChange, error }: { value: string[]; onChange: (v: string[]) => void; error?: string }) {
  const { allowed, terms } = useTerms('date_stage');
  const [text, setText] = useState(value.join(', '));
  if (allowed && terms.status === 'loading') return <LoadingState />;
  if (allowed && terms.status === 'error') return <ErrorState error={terms.error} onRetry={terms.reload} />;
  if (terms.status === 'success' && terms.data) {
    const options = terms.data.filter((x) => x.is_active || value.includes(x.key));
    return (
      <fieldset className="field">
        <legend className="field__label">{t('dates.ideas.stages')}</legend>
        <p className="field__hint">{t('dates.ideas.stagesPickHint')}</p>
        {options.length === 0 ? <p className="muted">{t('dates.ideas.noStages')}</p> : null}
        <div className="grid grid--3">
          {options.map((x) => (
            <CheckboxField key={x.id} label={termLabel(x)} checked={value.includes(x.key)} onChange={(on) => onChange(on ? [...value, x.key] : value.filter((k) => k !== x.key))} />
          ))}
        </div>
        {error ? <p className="field__error" role="alert">{error}</p> : null}
      </fieldset>
    );
  }
  return (
    <TextField
      label={t('dates.ideas.stages')}
      hint={t('dates.ideas.stagesHint')}
      value={text}
      onChange={(v) => {
        setText(v);
        onChange(parseList(v));
      }}
      error={error}
      spellCheck={false}
    />
  );
}
