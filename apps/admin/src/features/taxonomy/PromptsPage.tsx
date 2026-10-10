'use client';

import { adminPromptUpsert } from '@amora/shared';
import { useState } from 'react';
import { TranslationEditor, translationsFromServer, translationsToPayload, type TranslationFieldSpec, type TranslationValues } from '@/components/editors/TranslationEditor';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, TextField } from '@/components/ui/fields';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { ProfilePrompt } from '@/lib/api/admin-api';
import { useAdminApi } from '@/lib/auth/session';
import { scopedErrors } from '@/lib/forms/validate';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';

const FIELDS: TranslationFieldSpec<'text'>[] = [{ name: 'text', labelKey: 'prompts.fields.text', maxLength: 200 }];

export function PromptsPage() {
  const api = useAdminApi();
  const prompts = useResource(() => api.taxonomy.prompts(), [api]);
  const [editing, setEditing] = useState<ProfilePrompt | 'new' | null>(null);

  return (
    <>
      <PageHeader title={t('prompts.title')} intro={t('prompts.intro')} actions={<Button onClick={() => setEditing('new')}>{t('prompts.newPrompt')}</Button>} />
      {prompts.status === 'loading' ? <LoadingState /> : null}
      {prompts.status === 'error' ? <ErrorState error={prompts.error} onRetry={prompts.reload} /> : null}
      {prompts.status === 'success' && prompts.data.length === 0 ? <EmptyState message={t('prompts.empty')} /> : null}
      {prompts.status === 'success' && prompts.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('common.key')}</th>
                <th scope="col">{t('prompts.text')}</th>
                <th scope="col">{t('prompts.category')}</th>
                <th scope="col">{t('common.position')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {prompts.data.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.key}</code></td>
                  <td>{p.translations.en?.text ?? '—'}</td>
                  <td>{p.category}</td>
                  <td>{p.position}</td>
                  <td><BoolBadge value={p.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(p)} aria-label={`${t('common.edit')} ${p.key}`}>{t('common.edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <PromptDialog prompt={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={prompts.reload} /> : null}
    </>
  );
}

function PromptDialog({ prompt, onClose, onSaved }: { prompt: ProfilePrompt | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [key, setKey] = useState(prompt?.key ?? '');
  const [category, setCategory] = useState(prompt?.category ?? 'general');
  const [position, setPosition] = useState<number | undefined>(prompt?.position ?? 0);
  const [isActive, setActive] = useState(prompt?.is_active ?? true);
  const [translations, setTranslations] = useState<TranslationValues<'text'>>(() => translationsFromServer(FIELDS, prompt?.translations));

  async function save() {
    const payload = { key: prompt?.key ?? key.trim(), category: category.trim() || undefined, position, isActive, translations: translationsToPayload(FIELDS, translations) };
    const ok = await submit(adminPromptUpsert, payload, (d) => (prompt ? api.taxonomy.updatePrompt(prompt.id, d) : api.taxonomy.createPrompt(d)));
    if (ok) {
      notify(prompt ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={prompt ? t('prompts.editPrompt', { key: prompt.key }) : t('prompts.newPrompt')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors}>
      <div className="grid grid--2">
        {prompt ? (
          <ReadOnlyField label={t('common.key')} value={prompt.key} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('common.key')} hint={t('validation.keyFormat')} value={key} onChange={setKey} error={fieldErrors.key} required data-autofocus />
        )}
        <TextField label={t('prompts.category')} value={category} onChange={setCategory} error={fieldErrors.category} maxLength={50} />
        <NumberField label={t('common.position')} min={0} step={1} value={position} onChange={setPosition} error={fieldErrors.position} />
      </div>
      <CheckboxField label={t('common.active')} checked={isActive} onChange={setActive} />
      <TranslationEditor fields={FIELDS} value={translations} onChange={setTranslations} errors={scopedErrors(fieldErrors, 'translations')} />
    </FormDialog>
  );
}
