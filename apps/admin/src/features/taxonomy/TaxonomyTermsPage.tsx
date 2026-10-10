'use client';

import { TAXONOMY_KINDS, adminTermUpsert, type TaxonomyKind } from '@amora/shared';
import { useState } from 'react';
import { TranslationEditor, translationsFromServer, translationsToPayload, type TranslationFieldSpec, type TranslationValues } from '@/components/editors/TranslationEditor';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { TaxonomyTerm } from '@/lib/api/admin-api';
import { useAdminApi } from '@/lib/auth/session';
import { scopedErrors, parseJsonText } from '@/lib/forms/validate';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';

const FIELDS: TranslationFieldSpec<'label' | 'description'>[] = [
  { name: 'label', labelKey: 'taxonomy.fields.label', maxLength: 120 },
  { name: 'description', labelKey: 'taxonomy.fields.description', kind: 'textarea', optional: true, maxLength: 500 },
];

const kindLabel = (k: TaxonomyKind) => t(`taxonomy.kinds.${k}`);

export function TaxonomyTermsPage() {
  const api = useAdminApi();
  const [kind, setKind] = useState<TaxonomyKind>(TAXONOMY_KINDS[0]);
  const terms = useResource(() => api.taxonomy.terms(kind), [api, kind]);
  const [editing, setEditing] = useState<TaxonomyTerm | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title={t('taxonomy.title')}
        intro={t('taxonomy.intro')}
        actions={<Button onClick={() => setEditing('new')}>{t('taxonomy.newTerm')}</Button>}
      />
      <div className="filters">
        <SelectField
          label={t('taxonomy.kind')}
          value={kind}
          onChange={(v) => setKind(v as TaxonomyKind)}
          options={TAXONOMY_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
          className="field--inline"
        />
      </div>
      {terms.status === 'loading' ? <LoadingState /> : null}
      {terms.status === 'error' ? <ErrorState error={terms.error} onRetry={terms.reload} /> : null}
      {terms.status === 'success' && terms.data.length === 0 ? <EmptyState message={t('taxonomy.empty')} /> : null}
      {terms.status === 'success' && terms.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="table__caption">{kindLabel(kind)}</caption>
            <thead>
              <tr>
                <th scope="col">{t('common.key')}</th>
                <th scope="col">{t('taxonomy.labelEn')}</th>
                <th scope="col">{t('common.position')}</th>
                <th scope="col">{t('taxonomy.sensitive')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {terms.data.map((term) => (
                <tr key={term.id}>
                  <td><code>{term.key}</code></td>
                  <td>{term.translations.en?.label ?? '—'}</td>
                  <td>{term.position}</td>
                  <td><BoolBadge value={term.is_sensitive} /></td>
                  <td><BoolBadge value={term.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(term)} aria-label={`${t('common.edit')} ${term.key}`}>{t('common.edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? (
        <TermDialog
          kind={kind}
          term={editing === 'new' ? null : editing}
          siblings={terms.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={terms.reload}
        />
      ) : null}
    </>
  );
}

function TermDialog({ kind, term, siblings, onClose, onSaved }: { kind: TaxonomyKind; term: TaxonomyTerm | null; siblings: TaxonomyTerm[]; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [key, setKey] = useState(term?.key ?? '');
  const [parentId, setParentId] = useState(term?.parent_id ?? '');
  const [position, setPosition] = useState<number | undefined>(term?.position ?? 0);
  const [isSensitive, setSensitive] = useState(term?.is_sensitive ?? false);
  const [isActive, setActive] = useState(term?.is_active ?? true);
  const [metadata, setMetadata] = useState(JSON.stringify(term?.metadata ?? {}, null, 2));
  const [translations, setTranslations] = useState<TranslationValues<'label' | 'description'>>(() => translationsFromServer(FIELDS, term?.translations));

  async function save() {
    const meta = parseJsonText(metadata);
    const metaOk = meta.ok && meta.value !== null && typeof meta.value === 'object' && !Array.isArray(meta.value);
    const payload = {
      // kind and key are immutable on edit (the API rejects changes); always send the stored values.
      kind: term?.kind ?? kind,
      key: term?.key ?? key.trim(),
      parentId: parentId || null,
      position,
      isSensitive,
      isActive,
      metadata: metaOk ? meta.value : {},
      translations: translationsToPayload(FIELDS, translations),
    };
    const ok = await submit(adminTermUpsert, payload, (data) => (term ? api.taxonomy.updateTerm(term.id, data) : api.taxonomy.createTerm(data)), metaOk ? {} : { metadata: t(meta.ok ? 'validation.jsonObject' : 'validation.invalidJson') });
    if (ok) {
      notify(term ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog
      title={term ? t('taxonomy.editTerm', { key: term.key }) : t('taxonomy.createTerm', { kind: kindLabel(kind) })}
      onClose={onClose}
      onSubmit={() => void save()}
      busy={busy}
      error={error}
      fieldErrors={fieldErrors}
      size="lg"
    >
      <div className="grid grid--2">
        <ReadOnlyField label={t('taxonomy.kind')} value={kindLabel(term?.kind ?? kind)} hint={t('common.immutableHint')} />
        {term ? (
          <ReadOnlyField label={t('common.key')} value={term.key} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('common.key')} hint={t('validation.keyFormat')} value={key} onChange={setKey} error={fieldErrors.key} required spellCheck={false} data-autofocus />
        )}
        <SelectField
          label={t('taxonomy.parent')}
          value={parentId}
          onChange={setParentId}
          placeholder={t('taxonomy.noParent')}
          options={siblings.filter((s) => s.id !== term?.id).map((s) => ({ value: s.id, label: s.translations.en?.label ?? s.key }))}
          error={fieldErrors.parentId}
        />
        <NumberField label={t('common.position')} min={0} step={1} value={position} onChange={setPosition} error={fieldErrors.position} />
      </div>
      <CheckboxField label={t('taxonomy.sensitive')} hint={t('taxonomy.sensitiveHint')} checked={isSensitive} onChange={setSensitive} />
      <CheckboxField label={t('common.active')} checked={isActive} onChange={setActive} />
      <TranslationEditor fields={FIELDS} value={translations} onChange={setTranslations} errors={scopedErrors(fieldErrors, 'translations')} />
      <TextAreaField label={t('taxonomy.metadata')} value={metadata} onChange={setMetadata} rows={4} error={fieldErrors.metadata} spellCheck={false} className="code-input" />
    </FormDialog>
  );
}
