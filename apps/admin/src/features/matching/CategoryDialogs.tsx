'use client';

import { adminCategorySignalsInput, adminCompatibilityCategoryUpsert, TAXONOMY_KINDS } from '@amora/shared';
import { useState } from 'react';
import { TranslationEditor, translationsFromServer, translationsToPayload, type TranslationFieldSpec, type TranslationValues } from '@/components/editors/TranslationEditor';
import { useNotify } from '@/components/shell/notice';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { CompatibilitySource, CompatibilityCategoryRow } from '@/lib/api/modules/matching';
import { useAdminApi } from '@/lib/auth/session';
import { scopedErrors } from '@/lib/forms/validate';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';

const FIELDS: TranslationFieldSpec<'label' | 'description'>[] = [
  { name: 'label', labelKey: 'matching.categories.label', maxLength: 120 },
  { name: 'description', labelKey: 'common.description', kind: 'textarea', optional: true, maxLength: 500 },
];
const SOURCES = adminCompatibilityCategoryUpsert.shape.source.options;

/** Create/edit a compatibility category (PUT admin/questionnaire/compatibility-categories/:key upserts). */
export function CategoryDialog({ category, onClose, onSaved }: { category: CompatibilityCategoryRow | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [key, setKey] = useState(category?.key ?? '');
  const [source, setSource] = useState<CompatibilitySource>(category?.source ?? 'questionnaire');
  const [position, setPosition] = useState<number | undefined>(category?.position ?? 0);
  const [isActive, setActive] = useState(category?.is_active ?? true);
  const [translations, setTranslations] = useState<TranslationValues<'label' | 'description'>>(() =>
    translationsFromServer(FIELDS, category?.translations as Record<string, Partial<Record<'label' | 'description', string | null>>> | undefined));

  async function save() {
    const payload = { key: category?.key ?? key.trim(), source, position, isActive, translations: translationsToPayload(FIELDS, translations) };
    const ok = await submit(adminCompatibilityCategoryUpsert, payload, (d) => api.matching.upsertCategory(d));
    if (ok) {
      notify(category ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog
      title={category ? t('matching.categories.editTitle', { key: category.key }) : t('matching.categories.new')}
      onClose={onClose}
      onSubmit={() => void save()}
      busy={busy}
      error={error}
      fieldErrors={fieldErrors}
    >
      <div className="grid grid--3">
        {category ? (
          <ReadOnlyField label={t('common.key')} value={category.key} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('common.key')} hint={t('validation.keyFormat')} value={key} onChange={setKey} error={fieldErrors.key} required data-autofocus spellCheck={false} />
        )}
        <SelectField
          label={t('matching.categories.source')}
          value={source}
          onChange={(v) => setSource(v as CompatibilitySource)}
          options={SOURCES.map((s) => ({ value: s, label: t(`matching.source.${s}`) }))}
          error={fieldErrors.source}
          required
        />
        <NumberField label={t('common.position')} min={0} step={1} value={position} onChange={setPosition} error={fieldErrors.position} />
      </div>
      <CheckboxField label={t('common.active')} checked={isActive} onChange={setActive} />
      {!category ? <p className="field__hint">{t('matching.categories.signalsAfterCreate')}</p> : null}
      <TranslationEditor fields={FIELDS} value={translations} onChange={setTranslations} errors={scopedErrors(fieldErrors, 'translations')} />
    </FormDialog>
  );
}

/** Which profile signals feed a category (PUT admin/matching/categories/:key/signals). */
export function SignalsDialog({ category, onClose, onSaved }: { category: CompatibilityCategoryRow; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [kinds, setKinds] = useState<string[]>(category.attribute_kinds);
  const [usesIntent, setUsesIntent] = useState(category.uses_intent);
  const [usesInterests, setUsesInterests] = useState(category.uses_interests);
  const [usesLocation, setUsesLocation] = useState(category.uses_location);
  const [inOverall, setInOverall] = useState(category.in_overall);
  // Taxonomy kinds from the shared catalog, plus any value already stored that the catalog no longer lists.
  const options = [...TAXONOMY_KINDS, ...category.attribute_kinds.filter((k) => !(TAXONOMY_KINDS as readonly string[]).includes(k))];

  async function save() {
    const payload = { attributeKinds: kinds, usesIntent, usesInterests, usesLocation, inOverall };
    const ok = await submit(adminCategorySignalsInput, payload, (d) => api.matching.updateSignals(category.key, d));
    if (ok) {
      notify(t('matching.signals.saved', { key: category.key }));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={t('matching.signals.title', { key: category.key })} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} size="lg">
      <p className="field__hint">{t('matching.signals.intro')}</p>
      <fieldset className="checkbox-group">
        <legend>{t('matching.signals.attributeKinds')}</legend>
        {options.map((k) => (
          <CheckboxField key={k} label={k} checked={kinds.includes(k)} onChange={(on) => setKinds((all) => (on ? [...all, k] : all.filter((x) => x !== k)))} />
        ))}
      </fieldset>
      {fieldErrors.attributeKinds ? <p className="field__error" role="alert">{fieldErrors.attributeKinds}</p> : null}
      <fieldset>
        <legend>{t('matching.signals.other')}</legend>
        <CheckboxField label={t('matching.signals.usesIntent')} checked={usesIntent} onChange={setUsesIntent} />
        <CheckboxField label={t('matching.signals.usesInterests')} checked={usesInterests} onChange={setUsesInterests} />
        <CheckboxField label={t('matching.signals.usesLocation')} checked={usesLocation} onChange={setUsesLocation} />
        <CheckboxField label={t('matching.signals.inOverall')} hint={t('matching.signals.inOverallHint')} checked={inOverall} onChange={setInOverall} />
      </fieldset>
    </FormDialog>
  );
}
