'use client';

import { adminQuestionCategoryUpsert } from '@amora/shared';
import { useState } from 'react';
import { TranslationEditor, translationsFromServer, translationsToPayload, type TranslationFieldSpec, type TranslationValues } from '@/components/editors/TranslationEditor';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { CompatibilityCategory, QuestionCategory } from '@/lib/api/modules/questionnaire';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { scopedErrors } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';
import { compatName, labelOf, QuestionnaireTabs } from './shared';

const FIELDS: readonly TranslationFieldSpec<'label' | 'description'>[] = [
  { name: 'label', labelKey: 'questionnaire.categories.label', maxLength: 120 },
  { name: 'description', labelKey: 'common.description', kind: 'textarea', optional: true, maxLength: 500 },
];

/** Question categories (sections of the questionnaire) and their link to a compatibility category. */
export function CategoriesPage() {
  const api = useAdminApi();
  const { can } = useSession();
  const canCompat = can('matching.view');
  const data = useResource(async () => {
    const [categories, compat] = await Promise.all([api.questionnaire.categories(), canCompat ? api.questionnaire.compatibilityCategories() : Promise.resolve(null)]);
    return { categories, compat };
  }, [api, canCompat]);
  const [editing, setEditing] = useState<QuestionCategory | 'new' | null>(null);
  const canEdit = can('questions.edit');

  return (
    <>
      <PageHeader title={t('questionnaire.categories.title')} intro={t('questionnaire.categories.intro')} actions={canEdit ? <Button onClick={() => setEditing('new')}>{t('questionnaire.categories.new')}</Button> : null} />
      <QuestionnaireTabs />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.categories.length === 0 ? <EmptyState message={t('questionnaire.categories.empty')} /> : null}
      {data.status === 'success' && data.data.categories.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col" className="num">{t('common.position')}</th>
                <th scope="col">{t('common.key')}</th>
                <th scope="col">{t('questionnaire.categories.label')}</th>
                <th scope="col">{t('questionnaire.editor.compatCategory')}</th>
                <th scope="col">{t('questionnaire.categories.locales')}</th>
                <th scope="col">{t('common.active')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {data.data.categories.map((c) => (
                <tr key={c.id}>
                  <td className="num">{formatNumber(c.position)}</td>
                  <td><code>{c.key}</code></td>
                  <td dir="auto">{labelOf(c)}</td>
                  <td>{compatName(data.data.compat, c.compatibility_category_id)}</td>
                  <td>{Object.keys(c.translations).sort().join(', ')}</td>
                  <td><BoolBadge value={c.is_active} /></td>
                  <td className="table__actions">
                    {canEdit ? <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label={`${t('common.edit')} ${c.key}`}>{t('common.edit')}</Button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing && data.status === 'success' ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          compat={data.data.compat}
          nextPosition={data.data.categories.reduce((m, c) => Math.max(m, c.position + 1), 0)}
          onClose={() => setEditing(null)}
          onSaved={data.reload}
        />
      ) : null}
    </>
  );
}

interface CategoryForm {
  key: string;
  compatibilityCategoryId: string;
  position: number | undefined;
  isActive: boolean;
  translations: TranslationValues<'label' | 'description'>;
}

function CategoryDialog({ category, compat, nextPosition, onClose, onSaved }: {
  category: QuestionCategory | null; compat: CompatibilityCategory[] | null; nextPosition: number; onClose: () => void; onSaved: () => void;
}) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [form, setForm] = useState<CategoryForm>(() => ({
    key: category?.key ?? '',
    compatibilityCategoryId: category?.compatibility_category_id ?? '',
    position: category?.position ?? nextPosition,
    isActive: category?.is_active ?? true,
    translations: translationsFromServer(FIELDS, category?.translations),
  }));
  const set = <K extends keyof CategoryForm>(k: K) => (v: CategoryForm[K]) => setForm((s) => ({ ...s, [k]: v }));

  async function save() {
    const body = {
      key: form.key.trim(),
      compatibilityCategoryId: form.compatibilityCategoryId || null,
      position: form.position,
      isActive: form.isActive,
      translations: translationsToPayload(FIELDS, form.translations),
    };
    const ok = await submit(adminQuestionCategoryUpsert, body, (b) => api.questionnaire.upsertCategory(b));
    if (ok) {
      notify(t('common.saved'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={category ? t('questionnaire.categories.edit', { key: category.key }) : t('questionnaire.categories.new')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} size="lg">
      {category ? (
        <ReadOnlyField label={t('common.key')} value={category.key} hint={t('common.immutableHint')} />
      ) : (
        <TextField label={t('common.key')} hint={t('validation.keyFormat')} value={form.key} onChange={set('key')} error={fieldErrors.key} required data-autofocus spellCheck={false} />
      )}
      {compat ? (
        <SelectField
          label={t('questionnaire.editor.compatCategory')}
          hint={t('questionnaire.categories.compatHint')}
          value={form.compatibilityCategoryId}
          onChange={set('compatibilityCategoryId')}
          options={compat.map((c) => ({ value: c.id, label: labelOf(c) }))}
          placeholder={t('questionnaire.editor.noCompatCategory')}
          error={fieldErrors.compatibilityCategoryId}
        />
      ) : (
        <ReadOnlyField label={t('questionnaire.editor.compatCategory')} value={compatName(null, form.compatibilityCategoryId || null)} hint={t('questionnaire.editor.compatNeedsPermission')} />
      )}
      <NumberField label={t('common.position')} value={form.position} onChange={set('position')} error={fieldErrors.position} min={0} step={1} />
      <CheckboxField label={t('common.active')} hint={t('questionnaire.categories.activeHint')} checked={form.isActive} onChange={set('isActive')} />
      <TranslationEditor fields={FIELDS} value={form.translations} onChange={set('translations')} errors={scopedErrors(fieldErrors, 'translations')} />
    </FormDialog>
  );
}
