'use client';

import { adminInterestCategoryUpsert, adminInterestUpsert } from '@amora/shared';
import { useState } from 'react';
import { TranslationEditor, translationsFromServer, translationsToPayload, type TranslationFieldSpec, type TranslationValues } from '@/components/editors/TranslationEditor';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { Interest, InterestCategory } from '@/lib/api/admin-api';
import { useAdminApi } from '@/lib/auth/session';
import { scopedErrors } from '@/lib/forms/validate';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';

const FIELDS: TranslationFieldSpec<'label'>[] = [{ name: 'label', labelKey: 'interests.fields.label', maxLength: 80 }];
const label = (x: { key: string; translations: Record<string, { label?: string | null }> }) => x.translations.en?.label ?? x.key;

export function InterestsPage() {
  const api = useAdminApi();
  const data = useResource(async () => {
    const [categories, interests] = await Promise.all([api.taxonomy.categories(), api.taxonomy.interests()]);
    return { categories, interests };
  }, [api]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editingCategory, setEditingCategory] = useState<InterestCategory | 'new' | null>(null);
  const [editingInterest, setEditingInterest] = useState<Interest | 'new' | null>(null);

  if (data.status === 'loading') return <><PageHeader title={t('interests.title')} intro={t('interests.intro')} /><LoadingState /></>;
  if (data.status === 'error') return <><PageHeader title={t('interests.title')} intro={t('interests.intro')} /><ErrorState error={data.error} onRetry={data.reload} /></>;

  const { categories, interests } = data.data;
  const categoryName = new Map(categories.map((c) => [c.id, label(c)]));
  const visible = categoryFilter ? interests.filter((i) => i.category_id === categoryFilter) : interests;

  return (
    <>
      <PageHeader title={t('interests.title')} intro={t('interests.intro')} />

      <section className="section" aria-labelledby="categories-heading">
        <div className="row row--between">
          <h2 id="categories-heading">{t('interests.categories')}</h2>
          <Button onClick={() => setEditingCategory('new')}>{t('interests.newCategory')}</Button>
        </div>
        {categories.length === 0 ? (
          <EmptyState message={t('interests.emptyCategories')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('common.key')}</th>
                  <th scope="col">{t('taxonomy.labelEn')}</th>
                  <th scope="col">{t('interests.icon')}</th>
                  <th scope="col">{t('common.position')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td><code>{c.key}</code></td>
                    <td>{label(c)}</td>
                    <td>{c.icon ?? '—'}</td>
                    <td>{c.position}</td>
                    <td><BoolBadge value={c.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                    <td className="table__actions">
                      <Button variant="ghost" size="sm" onClick={() => setEditingCategory(c)} aria-label={`${t('common.edit')} ${c.key}`}>{t('common.edit')}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="interests-heading">
        <div className="row row--between">
          <h2 id="interests-heading">{t('interests.interests')}</h2>
          <Button onClick={() => setEditingInterest('new')} disabled={categories.length === 0} title={categories.length === 0 ? t('interests.needCategory') : undefined}>
            {t('interests.newInterest')}
          </Button>
        </div>
        {categories.length === 0 ? <p className="muted">{t('interests.needCategory')}</p> : null}
        <div className="filters">
          <SelectField
            label={t('interests.category')}
            value={categoryFilter}
            onChange={setCategoryFilter}
            placeholder={t('interests.allCategories')}
            options={categories.map((c) => ({ value: c.id, label: label(c) }))}
            className="field--inline"
          />
        </div>
        {visible.length === 0 ? (
          <EmptyState message={t('interests.emptyInterests')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('common.key')}</th>
                  <th scope="col">{t('taxonomy.labelEn')}</th>
                  <th scope="col">{t('interests.category')}</th>
                  <th scope="col">{t('common.position')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <tr key={i.id}>
                    <td><code>{i.key}</code></td>
                    <td>{label(i)}</td>
                    <td>{categoryName.get(i.category_id) ?? '—'}</td>
                    <td>{i.position}</td>
                    <td><BoolBadge value={i.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                    <td className="table__actions">
                      <Button variant="ghost" size="sm" onClick={() => setEditingInterest(i)} aria-label={`${t('common.edit')} ${i.key}`}>{t('common.edit')}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editingCategory ? (
        <CategoryDialog category={editingCategory === 'new' ? null : editingCategory} onClose={() => setEditingCategory(null)} onSaved={data.reload} />
      ) : null}
      {editingInterest ? (
        <InterestDialog
          interest={editingInterest === 'new' ? null : editingInterest}
          categories={categories}
          defaultCategory={categoryFilter}
          onClose={() => setEditingInterest(null)}
          onSaved={data.reload}
        />
      ) : null}
    </>
  );
}

function CategoryDialog({ category, onClose, onSaved }: { category: InterestCategory | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [key, setKey] = useState(category?.key ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '');
  const [position, setPosition] = useState<number | undefined>(category?.position ?? 0);
  const [isActive, setActive] = useState(category?.is_active ?? true);
  const [translations, setTranslations] = useState<TranslationValues<'label'>>(() => translationsFromServer(FIELDS, category?.translations));

  async function save() {
    const payload = { key: category?.key ?? key.trim(), icon: icon.trim() || undefined, position, isActive, translations: translationsToPayload(FIELDS, translations) };
    const ok = await submit(adminInterestCategoryUpsert, payload, (d) => (category ? api.taxonomy.updateCategory(category.id, d) : api.taxonomy.createCategory(d)));
    if (ok) {
      notify(category ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={category ? t('interests.editCategory', { key: category.key }) : t('interests.newCategory')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors}>
      <div className="grid grid--2">
        {category ? (
          <ReadOnlyField label={t('common.key')} value={category.key} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('common.key')} hint={t('validation.keyFormat')} value={key} onChange={setKey} error={fieldErrors.key} required data-autofocus />
        )}
        <TextField label={t('interests.icon')} value={icon} onChange={setIcon} error={fieldErrors.icon} maxLength={50} />
        <NumberField label={t('common.position')} min={0} step={1} value={position} onChange={setPosition} error={fieldErrors.position} />
      </div>
      <CheckboxField label={t('common.active')} checked={isActive} onChange={setActive} />
      <TranslationEditor fields={FIELDS} value={translations} onChange={setTranslations} errors={scopedErrors(fieldErrors, 'translations')} />
    </FormDialog>
  );
}

function InterestDialog({ interest, categories, defaultCategory, onClose, onSaved }: {
  interest: Interest | null; categories: InterestCategory[]; defaultCategory: string; onClose: () => void; onSaved: () => void;
}) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [key, setKey] = useState(interest?.key ?? '');
  const [categoryId, setCategoryId] = useState(interest?.category_id ?? defaultCategory);
  const [icon, setIcon] = useState(interest?.icon ?? '');
  const [position, setPosition] = useState<number | undefined>(interest?.position ?? 0);
  const [isActive, setActive] = useState(interest?.is_active ?? true);
  const [translations, setTranslations] = useState<TranslationValues<'label'>>(() => translationsFromServer(FIELDS, interest?.translations));

  async function save() {
    const payload = { key: interest?.key ?? key.trim(), categoryId, icon: icon.trim() || undefined, position, isActive, translations: translationsToPayload(FIELDS, translations) };
    const ok = await submit(adminInterestUpsert, payload, (d) => (interest ? api.taxonomy.updateInterest(interest.id, d) : api.taxonomy.createInterest(d)));
    if (ok) {
      notify(interest ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={interest ? t('interests.editInterest', { key: interest.key }) : t('interests.newInterest')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors}>
      <div className="grid grid--2">
        {interest ? (
          <ReadOnlyField label={t('common.key')} value={interest.key} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('common.key')} hint={t('validation.keyFormat')} value={key} onChange={setKey} error={fieldErrors.key} required data-autofocus />
        )}
        <SelectField
          label={t('interests.category')}
          value={categoryId}
          onChange={setCategoryId}
          placeholder=""
          options={categories.map((c) => ({ value: c.id, label: label(c) }))}
          error={fieldErrors.categoryId}
          required
        />
        <TextField label={t('interests.icon')} value={icon} onChange={setIcon} error={fieldErrors.icon} maxLength={50} />
        <NumberField label={t('common.position')} min={0} step={1} value={position} onChange={setPosition} error={fieldErrors.position} />
      </div>
      <CheckboxField label={t('common.active')} checked={isActive} onChange={setActive} />
      <TranslationEditor fields={FIELDS} value={translations} onChange={setTranslations} errors={scopedErrors(fieldErrors, 'translations')} />
    </FormDialog>
  );
}
