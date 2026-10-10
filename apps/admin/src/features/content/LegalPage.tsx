'use client';

import { adminLegalCreate, adminLegalPublish } from '@amora/shared';
import { useState } from 'react';
import { MarkdownEditor, MarkdownPreview } from '@/components/editors/MarkdownEditor';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, SelectField, TextField } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui/states';
import { t } from '@/i18n';
import type { LegalDocType, LegalDocument, LegalSummary } from '@/lib/api/admin-api';
import { useAdminApi } from '@/lib/auth/session';
import { localInputToIso, validate } from '@/lib/forms/validate';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';

const DOC_TYPES = adminLegalCreate.shape.docType.options;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : t('legal.notYetEffective'));
const docTypeLabel = (d: LegalDocType) => t(`legal.docTypes.${d}`);

interface DraftSeed {
  docType: LegalDocType;
  locale: string;
  countryCode: string;
  title: string;
  bodyMarkdown: string;
  requiresReacceptance: boolean;
}

export function LegalPage() {
  const api = useAdminApi();
  const docs = useResource(() => api.content.legal(), [api]);
  const [viewing, setViewing] = useState<LegalSummary | null>(null);
  const [drafting, setDrafting] = useState<DraftSeed | null>(null);
  const [publishing, setPublishing] = useState<LegalSummary | null>(null);

  const blank: DraftSeed = { docType: 'terms', locale: 'en', countryCode: '', title: '', bodyMarkdown: '', requiresReacceptance: false };

  return (
    <>
      <PageHeader title={t('legal.title')} intro={t('legal.intro')} actions={<Button onClick={() => setDrafting(blank)}>{t('legal.newDraft')}</Button>} />
      {docs.status === 'loading' ? <LoadingState /> : null}
      {docs.status === 'error' ? <ErrorState error={docs.error} onRetry={docs.reload} /> : null}
      {docs.status === 'success' && docs.data.length === 0 ? <EmptyState message={t('legal.empty')} /> : null}
      {docs.status === 'success' && docs.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('legal.docType')}</th>
                <th scope="col">{t('legal.version')}</th>
                <th scope="col">{t('legal.locale')}</th>
                <th scope="col">{t('legal.country')}</th>
                <th scope="col">{t('legal.docTitle')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('legal.effectiveAt')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {docs.data.map((d) => (
                <tr key={d.id}>
                  <td>{docTypeLabel(d.doc_type)}</td>
                  <td>{t('legal.versionShort', { version: d.version })}</td>
                  <td>{d.locale}</td>
                  <td>{d.country_code ?? t('legal.global')}</td>
                  <td>{d.title}</td>
                  <td><StatusBadge status={d.status} /></td>
                  <td>{d.status === 'draft' ? '—' : fmt(d.effective_at)}</td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setViewing(d)} aria-label={`${t('common.view')} ${docTypeLabel(d.doc_type)} ${t('legal.versionShort', { version: d.version })} ${d.locale}`}>{t('common.view')}</Button>
                    {d.status === 'draft' ? (
                      <Button size="sm" onClick={() => setPublishing(d)} aria-label={`${t('legal.publish')} ${docTypeLabel(d.doc_type)} ${t('legal.versionShort', { version: d.version })} ${d.locale}`}>{t('legal.publish')}</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {viewing ? (
        <ViewDialog
          summary={viewing}
          onClose={() => setViewing(null)}
          onNewVersion={(doc) => {
            setViewing(null);
            setDrafting({ docType: doc.doc_type, locale: doc.locale, countryCode: doc.country_code ?? '', title: doc.title, bodyMarkdown: doc.body_md, requiresReacceptance: doc.requires_reacceptance });
          }}
        />
      ) : null}
      {drafting ? <DraftDialog seed={drafting} onClose={() => setDrafting(null)} onCreated={docs.reload} /> : null}
      {publishing ? <PublishDialog doc={publishing} onClose={() => setPublishing(null)} onPublished={docs.reload} /> : null}
    </>
  );
}

function ViewDialog({ summary, onClose, onNewVersion }: { summary: LegalSummary; onClose: () => void; onNewVersion: (doc: LegalDocument) => void }) {
  const api = useAdminApi();
  const doc = useResource(() => api.content.legalDoc(summary.id), [api, summary.id]);
  return (
    <Dialog
      title={t('legal.viewTitle', { title: summary.title, version: summary.version })}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
          {doc.status === 'success' ? <Button onClick={() => onNewVersion(doc.data)}>{t('legal.newVersionFrom')}</Button> : null}
        </>
      }
    >
      <p className="row">
        <StatusBadge status={summary.status} />
        <span>{docTypeLabel(summary.doc_type)} · {summary.locale} · {summary.country_code ?? t('legal.global')}</span>
        {summary.requires_reacceptance ? <span className="badge">{t('legal.requiresReacceptance')}</span> : null}
      </p>
      {summary.status !== 'draft' ? <p className="muted">{t('legal.readOnly')}</p> : null}
      {doc.status === 'loading' ? <LoadingState /> : null}
      {doc.status === 'error' ? <ErrorState error={doc.error} onRetry={doc.reload} /> : null}
      {doc.status === 'success' ? <MarkdownPreview source={doc.data.body_md} /> : null}
    </Dialog>
  );
}

function DraftDialog({ seed, onClose, onCreated }: { seed: DraftSeed; onClose: () => void; onCreated: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [f, setF] = useState(seed);
  const set = <K extends keyof DraftSeed>(k: K) => (v: DraftSeed[K]) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    const payload = { ...f, locale: f.locale.trim(), title: f.title.trim(), countryCode: f.countryCode.trim().toUpperCase() || null };
    const ok = await submit(adminLegalCreate, payload, async (d) => {
      const created = await api.content.createLegal(d);
      notify(t('legal.draftCreated', { version: created.version }));
    });
    if (ok) {
      onCreated();
      onClose();
    }
  }

  return (
    <FormDialog title={t('legal.newDraftTitle')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} size="lg" submitLabel={t('common.create')}>
      <div className="grid grid--3">
        <SelectField label={t('legal.docType')} value={f.docType} onChange={(v) => set('docType')(v as LegalDocType)} options={DOC_TYPES.map((d) => ({ value: d, label: docTypeLabel(d) }))} error={fieldErrors.docType} />
        <TextField label={t('legal.locale')} value={f.locale} onChange={set('locale')} error={fieldErrors.locale} required />
        <TextField label={t('legal.country')} hint={t('legal.countryHint')} value={f.countryCode} onChange={set('countryCode')} error={fieldErrors.countryCode} maxLength={2} />
      </div>
      <TextField label={t('legal.docTitle')} value={f.title} onChange={set('title')} error={fieldErrors.title} required maxLength={200} data-autofocus />
      <MarkdownEditor label={t('legal.body')} value={f.bodyMarkdown} onChange={set('bodyMarkdown')} error={fieldErrors.bodyMarkdown} required rows={16} />
      <CheckboxField label={t('legal.requiresReacceptance')} hint={t('legal.requiresReacceptanceHint')} checked={f.requiresReacceptance} onChange={set('requiresReacceptance')} />
    </FormDialog>
  );
}

function PublishDialog({ doc, onClose, onPublished }: { doc: LegalSummary; onClose: () => void; onPublished: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const [effective, setEffective] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();

  return (
    <ConfirmDialog
      title={t('legal.publishTitle', { docType: docTypeLabel(doc.doc_type), version: doc.version, locale: doc.locale })}
      body={t('legal.publishBody')}
      confirmLabel={t('legal.publish')}
      onConfirm={async () => {
        const iso = localInputToIso(effective);
        if (effective && !iso) {
          setFieldError(t('validation.invalidDate'));
          return false;
        }
        const v = validate(adminLegalPublish, { effectiveAt: iso ?? undefined });
        if (!v.ok) {
          setFieldError(v.errors.effectiveAt ?? t('validation.invalidDate'));
          return false;
        }
        setFieldError(undefined);
        await api.content.publishLegal(doc.id, v.data);
        notify(t('legal.published'));
        onPublished();
      }}
      onClose={onClose}
    >
      <TextField label={t('legal.effectiveAtInput')} hint={t('legal.effectiveAtHint')} type="datetime-local" value={effective} onChange={setEffective} error={fieldError} />
    </ConfirmDialog>
  );
}
