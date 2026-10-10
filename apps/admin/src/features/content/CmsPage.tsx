'use client';

import { adminCmsUpsert } from '@amora/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { TranslationEditor, translationsFromServer, translationsToPayload, type TranslationFieldSpec, type TranslationValues } from '@/components/editors/TranslationEditor';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui/states';
import { t } from '@/i18n';
import type { CmsEntryRow, CmsKind } from '@/lib/api/admin-api';
import { useAdminApi } from '@/lib/auth/session';
import { isoToLocalInput, localInputToIso, parseList, scopedErrors, validate, type FieldErrors } from '@/lib/forms/validate';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';

const KINDS = adminCmsUpsert.shape.kind.options;
const STATUSES = adminCmsUpsert.shape.status.options;
const FIELDS: TranslationFieldSpec<'title' | 'bodyMarkdown'>[] = [
  { name: 'title', labelKey: 'cms.fields.title', maxLength: 200 },
  { name: 'bodyMarkdown', labelKey: 'cms.fields.bodyMarkdown', kind: 'markdown' },
];
type CmsPayload = z.output<typeof adminCmsUpsert>;

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

export function CmsPage() {
  const api = useAdminApi();
  const notify = useNotify();
  const [kind, setKind] = useState<CmsKind | ''>('');
  const entries = useResource(() => api.content.cms(kind || undefined), [api, kind]);
  const [editing, setEditing] = useState<CmsEntryRow | 'new' | null>(null);
  const [archiving, setArchiving] = useState<CmsEntryRow | null>(null);

  return (
    <>
      <PageHeader title={t('cms.title')} intro={t('cms.intro')} actions={<Button onClick={() => setEditing('new')}>{t('cms.newEntry')}</Button>} />
      <div className="filters">
        <SelectField
          label={t('cms.kind')}
          value={kind}
          onChange={(v) => setKind(v as CmsKind | '')}
          placeholder={t('cms.allKinds')}
          options={KINDS.map((k) => ({ value: k, label: t(`cms.kinds.${k}`) }))}
          className="field--inline"
        />
      </div>
      {entries.status === 'loading' ? <LoadingState /> : null}
      {entries.status === 'error' ? <ErrorState error={entries.error} onRetry={entries.reload} /> : null}
      {entries.status === 'success' && entries.data.length === 0 ? <EmptyState message={t('cms.empty')} /> : null}
      {entries.status === 'success' && entries.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('common.key')}</th>
                <th scope="col">{t('cms.titleField')}</th>
                <th scope="col">{t('cms.kind')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('cms.targeting')}</th>
                <th scope="col">{t('cms.window')}</th>
                <th scope="col">{t('cms.locales')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {entries.data.map((e) => (
                <tr key={e.id}>
                  <td><code>{e.key}</code></td>
                  <td>{e.translations.en?.title ?? '—'}</td>
                  <td>{t(`cms.kinds.${e.kind}`)}</td>
                  <td><StatusBadge status={e.status} /></td>
                  <td>{e.country_codes?.length ? e.country_codes.join(', ') : t('cms.allCountries')}</td>
                  <td>{fmt(e.publish_at) || fmt(e.unpublish_at) ? `${fmt(e.publish_at) ?? '…'} → ${fmt(e.unpublish_at) ?? '…'}` : t('cms.noWindow')}</td>
                  <td>{Object.keys(e.translations).sort().join(', ')}</td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(e)} aria-label={`${t('common.edit')} ${e.key}`}>{t('common.edit')}</Button>
                    {e.status !== 'archived' ? (
                      <Button variant="ghost" size="sm" onClick={() => setArchiving(e)} aria-label={`${t('cms.archive')} ${e.key}`}>{t('cms.archive')}</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <CmsDialog entry={editing === 'new' ? null : editing} defaultKind={kind || 'faq'} onClose={() => setEditing(null)} onSaved={entries.reload} /> : null}
      {archiving ? (
        <ConfirmDialog
          title={t('cms.archiveTitle', { key: archiving.key })}
          body={t('cms.archiveBody')}
          confirmLabel={t('cms.archive')}
          tone="danger"
          onConfirm={async () => {
            await api.content.archiveCms(archiving.key);
            notify(t('cms.archived'));
            entries.reload();
          }}
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </>
  );
}

function CmsDialog({ entry, defaultKind, onClose, onSaved }: { entry: CmsEntryRow | null; defaultKind: CmsKind; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [confirming, setConfirming] = useState<CmsPayload | null>(null);
  const [f, setF] = useState({
    key: entry?.key ?? '',
    kind: entry?.kind ?? defaultKind,
    category: entry?.category ?? '',
    position: (entry?.position ?? 0) as number | undefined,
    status: entry?.status ?? 'draft',
    targeted: !!entry?.country_codes?.length,
    countryCodes: (entry?.country_codes ?? []).join(', '),
    publishAt: isoToLocalInput(entry?.publish_at),
    unpublishAt: isoToLocalInput(entry?.unpublish_at),
  });
  const [translations, setTranslations] = useState<TranslationValues<'title' | 'bodyMarkdown'>>(() => translationsFromServer(FIELDS, entry?.translations));
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function persist(data: CmsPayload) {
    const ok = await send(() => api.content.upsertCms(data));
    if (ok) {
      notify(entry ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    }
  }

  function save() {
    const publishAt = localInputToIso(f.publishAt);
    const unpublishAt = localInputToIso(f.unpublishAt);
    const v = validate(adminCmsUpsert, {
      key: entry?.key ?? f.key.trim(),
      kind: f.kind,
      category: f.category.trim() || undefined,
      position: f.position,
      countryCodes: f.targeted ? parseList(f.countryCodes).map((c) => c.toUpperCase()) : null,
      status: f.status,
      publishAt,
      unpublishAt,
      translations: translationsToPayload(FIELDS, translations),
    });
    const errors: FieldErrors = v.ok ? {} : { ...v.errors };
    if (f.targeted && parseList(f.countryCodes).length === 0) errors.countryCodes = t('validation.required');
    if (publishAt && unpublishAt && unpublishAt <= publishAt) errors.unpublishAt = t('validation.windowOrder');
    for (const k of Object.keys(errors)) if (/^countryCodes\.\d+$/.test(k)) errors.countryCodes ??= errors[k]!;
    if (!v.ok || Object.keys(errors).length) return setFieldErrors(errors);
    setFieldErrors({});
    // Moving an entry to "published" makes it user-visible: confirm explicitly.
    if (v.data.status === 'published' && entry?.status !== 'published') return setConfirming(v.data);
    void persist(v.data);
  }

  const e = fieldErrors;
  return (
    <>
      <FormDialog title={entry ? t('cms.editEntry', { key: entry.key }) : t('cms.newEntry')} onClose={onClose} onSubmit={save} busy={busy} error={error} fieldErrors={fieldErrors} size="lg">
        <div className="grid grid--3">
          {entry ? (
            <ReadOnlyField label={t('common.key')} value={entry.key} hint={t('common.immutableHint')} />
          ) : (
            <TextField label={t('common.key')} hint={t('cms.keyHint')} value={f.key} onChange={set('key')} error={e.key} required data-autofocus spellCheck={false} />
          )}
          <SelectField label={t('cms.kind')} value={f.kind} onChange={(v) => set('kind')(v as CmsKind)} options={KINDS.map((k) => ({ value: k, label: t(`cms.kinds.${k}`) }))} error={e.kind} />
          <SelectField label={t('common.status')} value={f.status} onChange={(v) => set('status')(v as CmsEntryRow['status'])} options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} error={e.status} />
          <TextField label={t('cms.category')} value={f.category} onChange={set('category')} error={e.category} maxLength={50} />
          <NumberField label={t('common.position')} min={0} step={1} value={f.position} onChange={set('position')} error={e.position} />
        </div>
        <fieldset>
          <legend>{t('cms.targeting')}</legend>
          <div className="row" role="radiogroup" aria-label={t('cms.targeting')}>
            <label><input type="radio" name="cms-targeting" checked={!f.targeted} onChange={() => set('targeted')(false)} /> {t('cms.allCountries')}</label>
            <label><input type="radio" name="cms-targeting" checked={f.targeted} onChange={() => set('targeted')(true)} /> {t('cms.specificCountries')}</label>
          </div>
          {f.targeted ? <TextField label={t('cms.countryCodes')} hint={t('flags.countryCodesHint')} value={f.countryCodes} onChange={set('countryCodes')} error={e.countryCodes} required /> : null}
        </fieldset>
        <fieldset>
          <legend>{t('cms.window')}</legend>
          <div className="grid grid--2">
            <TextField label={t('cms.publishAt')} type="datetime-local" value={f.publishAt} onChange={set('publishAt')} error={e.publishAt} />
            <TextField label={t('cms.unpublishAt')} type="datetime-local" value={f.unpublishAt} onChange={set('unpublishAt')} error={e.unpublishAt} />
          </div>
        </fieldset>
        <TranslationEditor fields={FIELDS} value={translations} onChange={setTranslations} errors={scopedErrors(fieldErrors, 'translations')} />
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('cms.publishTitle', { key: confirming.key })}
          body={t('cms.publishBody')}
          confirmLabel={t('cms.publishConfirm')}
          onConfirm={() => persist(confirming)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
