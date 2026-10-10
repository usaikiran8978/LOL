'use client';

import { adminDealBreakerUpsert, TAXONOMY_KINDS } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t, tDynamic } from '@/i18n';
import type { DealBreakerMode, DealBreakerRow, DealBreakerSubject } from '@/lib/api/modules/matching';
import { useAdminApi, useSession } from '@/lib/auth/session';
import type { FieldErrors } from '@/lib/forms/validate';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';
import { MatchingTabs } from './shared';

const SUBJECTS = adminDealBreakerUpsert.shape.subjectType.options;
const MODES = adminDealBreakerUpsert.shape.mode.options;

/** Deal-breaker catalog: what users may (or always) hard-filter on. */
export function DealBreakersPage() {
  const api = useAdminApi();
  const { can } = useSession();
  const rows = useResource(() => api.matching.dealBreakers(), [api]);
  const [editing, setEditing] = useState<DealBreakerRow | 'new' | null>(null);
  const canEdit = can('matching.edit');

  return (
    <>
      <PageHeader
        title={t('matching.dealBreakers.title')}
        intro={t('matching.dealBreakers.intro')}
        actions={canEdit ? <Button onClick={() => setEditing('new')}>{t('matching.dealBreakers.new')}</Button> : null}
      />
      <MatchingTabs />
      {rows.status === 'loading' ? <LoadingState /> : null}
      {rows.status === 'error' ? <ErrorState error={rows.error} onRetry={rows.reload} /> : null}
      {rows.status === 'success' && rows.data.length === 0 ? <EmptyState message={t('matching.dealBreakers.empty')} /> : null}
      {rows.status === 'success' && rows.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('common.key')}</th>
                <th scope="col">{t('matching.dealBreakers.subjectType')}</th>
                <th scope="col">{t('matching.dealBreakers.target')}</th>
                <th scope="col">{t('matching.dealBreakers.mode')}</th>
                <th scope="col">{t('matching.dealBreakers.requiresEntitlement')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((d) => (
                <tr key={d.id}>
                  <td><code>{d.key}</code></td>
                  <td>{tDynamic(`matching.dealBreakers.subjects.${d.subject_type}`, d.subject_type)}</td>
                  <td>{d.question_id ? <code>{d.question_id}</code> : d.attribute_kind ? <code>{d.attribute_kind}</code> : '—'}</td>
                  <td>{tDynamic(`matching.dealBreakers.modes.${d.mode}`, d.mode)}</td>
                  <td>{d.requires_entitlement ? <code>{d.requires_entitlement}</code> : '—'}</td>
                  <td><BoolBadge value={d.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                  <td className="table__actions">
                    {canEdit ? <Button variant="ghost" size="sm" onClick={() => setEditing(d)} aria-label={`${t('common.edit')} ${d.key}`}>{t('common.edit')}</Button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <DealBreakerDialog row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={rows.reload} /> : null}
    </>
  );
}

function DealBreakerDialog({ row, onClose, onSaved }: { row: DealBreakerRow | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [key, setKey] = useState(row?.key ?? '');
  const [subjectType, setSubject] = useState<DealBreakerSubject>(row?.subject_type ?? 'attribute');
  const [questionId, setQuestionId] = useState(row?.question_id ?? '');
  const [attributeKind, setAttributeKind] = useState(row?.attribute_kind ?? '');
  const [mode, setMode] = useState<DealBreakerMode>(row?.mode ?? 'user_optional');
  const [entitlement, setEntitlement] = useState(row?.requires_entitlement ?? '');
  const [isActive, setActive] = useState(row?.is_active ?? true);

  async function save() {
    // The API requires the subject's target (questionId / attributeKind) — mirror that rule on the exact field.
    const extra: FieldErrors = {};
    if (subjectType === 'question' && !questionId.trim()) extra.questionId = t('validation.required');
    if (subjectType === 'attribute' && !attributeKind.trim()) extra.attributeKind = t('validation.required');
    const payload = {
      key: row?.key ?? key.trim(),
      subjectType,
      questionId: subjectType === 'question' ? questionId.trim() || null : null,
      attributeKind: subjectType === 'attribute' ? attributeKind.trim() || null : null,
      mode,
      requiresEntitlement: entitlement.trim() || null,
      isActive,
    };
    const ok = await submit(adminDealBreakerUpsert, payload, (d) => api.matching.upsertDealBreaker(d), extra);
    if (ok) {
      notify(row ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={row ? t('matching.dealBreakers.editTitle', { key: row.key }) : t('matching.dealBreakers.new')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors}>
      <div className="grid grid--2">
        {row ? (
          <ReadOnlyField label={t('common.key')} value={row.key} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('common.key')} hint={t('validation.keyFormat')} value={key} onChange={setKey} error={fieldErrors.key} required data-autofocus spellCheck={false} />
        )}
        <SelectField
          label={t('matching.dealBreakers.subjectType')}
          value={subjectType}
          onChange={(v) => setSubject(v as DealBreakerSubject)}
          options={SUBJECTS.map((s) => ({ value: s, label: t(`matching.dealBreakers.subjects.${s}`) }))}
          error={fieldErrors.subjectType}
          required
        />
        {subjectType === 'question' ? (
          <TextField label={t('matching.dealBreakers.questionId')} hint={t('matching.dealBreakers.questionIdHint')} value={questionId} onChange={setQuestionId} error={fieldErrors.questionId} required spellCheck={false} />
        ) : null}
        {subjectType === 'attribute' ? (
          <SelectField
            label={t('matching.dealBreakers.attributeKind')}
            value={attributeKind}
            onChange={setAttributeKind}
            options={[...TAXONOMY_KINDS, ...(attributeKind && !(TAXONOMY_KINDS as readonly string[]).includes(attributeKind) ? [attributeKind] : [])].map((k) => ({ value: k, label: k }))}
            placeholder={t('matching.dealBreakers.chooseKind')}
            error={fieldErrors.attributeKind}
            required
          />
        ) : null}
        <SelectField
          label={t('matching.dealBreakers.mode')}
          value={mode}
          onChange={(v) => setMode(v as DealBreakerMode)}
          options={MODES.map((m) => ({ value: m, label: t(`matching.dealBreakers.modes.${m}`) }))}
          error={fieldErrors.mode}
          required
        />
        <TextField label={t('matching.dealBreakers.requiresEntitlement')} hint={t('matching.dealBreakers.entitlementHint')} value={entitlement} onChange={setEntitlement} error={fieldErrors.requiresEntitlement} maxLength={50} spellCheck={false} />
      </div>
      <CheckboxField label={t('common.active')} checked={isActive} onChange={setActive} />
    </FormDialog>
  );
}
