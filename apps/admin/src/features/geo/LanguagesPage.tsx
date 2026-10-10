'use client';

import { adminLanguageUpsert } from '@amora/shared';
import { useState } from 'react';
import { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, ReadOnlyField, TextField } from '@/components/ui/fields';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { LanguageRow } from '@/lib/api/admin-api';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';

// The contract allows empty names; a nameless language is never intended, so the console also requires one.
const languageForm = adminLanguageUpsert.extend({ name: z.string().trim().min(1).max(80), nativeName: z.string().trim().min(1).max(80) });

export function LanguagesPage() {
  const api = useAdminApi();
  const languages = useResource(() => api.geo.languages(), [api]);
  const [editing, setEditing] = useState<LanguageRow | 'new' | null>(null);

  return (
    <>
      <PageHeader title={t('languages.title')} intro={t('languages.intro')} actions={<Button onClick={() => setEditing('new')}>{t('languages.newLanguage')}</Button>} />
      {languages.status === 'loading' ? <LoadingState /> : null}
      {languages.status === 'error' ? <ErrorState error={languages.error} onRetry={languages.reload} /> : null}
      {languages.status === 'success' && languages.data.length === 0 ? <EmptyState message={t('languages.empty')} /> : null}
      {languages.status === 'success' && languages.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('languages.code')}</th>
                <th scope="col">{t('languages.name')}</th>
                <th scope="col">{t('languages.nativeName')}</th>
                <th scope="col">{t('languages.rtl')}</th>
                <th scope="col">{t('languages.appLocale')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {languages.data.map((l) => (
                <tr key={l.code}>
                  <td><code>{l.code}</code></td>
                  <td>{l.name}</td>
                  <td dir={l.is_rtl ? 'rtl' : 'ltr'} lang={l.code}>{l.native_name}</td>
                  <td><BoolBadge value={l.is_rtl} /></td>
                  <td><BoolBadge value={l.is_app_locale} /></td>
                  <td><BoolBadge value={l.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(l)} aria-label={`${t('common.edit')} ${l.name}`}>{t('common.edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <LanguageDialog language={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={languages.reload} /> : null}
    </>
  );
}

function LanguageDialog({ language, onClose, onSaved }: { language: LanguageRow | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [f, setF] = useState({
    code: language?.code ?? '',
    name: language?.name ?? '',
    nativeName: language?.native_name ?? '',
    isRtl: language?.is_rtl ?? false,
    isAppLocale: language?.is_app_locale ?? false,
    isActive: language?.is_active ?? true,
  });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    const ok = await submit(languageForm, { ...f, code: f.code.trim() }, (d) => api.geo.upsertLanguage(d));
    if (ok) {
      notify(language ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={language ? t('languages.editLanguage', { name: language.name }) : t('languages.newLanguage')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors}>
      <div className="grid grid--2">
        {language ? (
          <ReadOnlyField label={t('languages.code')} value={language.code} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('languages.code')} hint={t('languages.codeHint')} value={f.code} onChange={set('code')} error={fieldErrors.code} required data-autofocus />
        )}
        <TextField label={t('languages.name')} value={f.name} onChange={set('name')} error={fieldErrors.name} required maxLength={80} />
        <TextField label={t('languages.nativeName')} value={f.nativeName} onChange={set('nativeName')} error={fieldErrors.nativeName} required maxLength={80} dir={f.isRtl ? 'rtl' : 'auto'} />
      </div>
      <CheckboxField label={t('languages.rtl')} checked={f.isRtl} onChange={set('isRtl')} />
      <CheckboxField label={t('languages.appLocale')} hint={t('languages.appLocaleHint')} checked={f.isAppLocale} onChange={set('isAppLocale')} />
      <CheckboxField label={t('common.active')} checked={f.isActive} onChange={set('isActive')} />
    </FormDialog>
  );
}
