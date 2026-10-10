'use client';

import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { NumberField, SelectField } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t, tDynamic } from '@/i18n';
import { RETENTION_ACTIONS, retentionUpdateSchema, type RetentionAction, type RetentionPolicy } from '@/lib/api/modules/privacy';
import { useAdminApi } from '@/lib/auth/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { validate } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';

const entityLabel = (e: string) => tDynamic(`privacy.retention.entities.${e}`, e);
const actionLabel = (a: string) => tDynamic(`privacy.retention.actions.${a}`, a);
const daysLabel = (d: number) => t('privacy.retention.daysValue', { days: formatNumber(d, 0) });

function overridesSummary(o: Record<string, unknown> | null | undefined): string {
  const entries = Object.entries(o ?? {});
  if (entries.length === 0) return t('privacy.retention.noOverrides');
  return entries.map(([country, v]) => `${country}: ${typeof v === 'number' ? formatNumber(v, 0) : JSON.stringify(v)}`).join(', ');
}

export function RetentionPage() {
  const api = useAdminApi();
  const policies = useResource(() => api.privacy.retention(), [api]);
  const [editing, setEditing] = useState<RetentionPolicy | null>(null);

  return (
    <>
      <PageHeader title={t('privacy.retention.title')} intro={t('privacy.retention.intro')} />
      {policies.status === 'loading' ? <LoadingState /> : null}
      {policies.status === 'error' ? <ErrorState error={policies.error} onRetry={policies.reload} /> : null}
      {policies.status === 'success' && policies.data.length === 0 ? <EmptyState message={t('privacy.retention.empty')} /> : null}
      {policies.status === 'success' && policies.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">{t('privacy.retention.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('privacy.retention.entity')}</th>
                <th scope="col">{t('privacy.retention.days')}</th>
                <th scope="col">{t('privacy.retention.action')}</th>
                <th scope="col">{t('privacy.retention.overrides')}</th>
                <th scope="col">{t('privacy.retention.updatedAt')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {policies.data.map((p) => (
                <tr key={p.entity}>
                  <td>{entityLabel(p.entity)}<br /><code className="muted">{p.entity}</code></td>
                  <td className="num">{daysLabel(p.retention_days)}</td>
                  <td>{actionLabel(p.action)}</td>
                  <td>{overridesSummary(p.country_overrides)}</td>
                  <td>{formatDateTime(p.updated_at)}</td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(p)} aria-label={`${t('privacy.retention.edit')} ${entityLabel(p.entity)}`}>{t('privacy.retention.edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <EditRetentionDialog policy={editing} onClose={() => setEditing(null)} onSaved={policies.reload} /> : null}
    </>
  );
}

/** Edit form first, then an explicit confirmation: a shorter period makes the retention job delete data for good. */
function EditRetentionDialog({ policy, onClose, onSaved }: { policy: RetentionPolicy; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { fieldErrors, setFieldErrors } = useFormSubmit();
  const [days, setDays] = useState<number | undefined>(policy.retention_days);
  const [action, setAction] = useState<RetentionAction>(policy.action);
  const [confirming, setConfirming] = useState<{ retentionDays: number; action: RetentionAction } | null>(null);

  function review() {
    const v = validate(retentionUpdateSchema, { retentionDays: days, action });
    if (!v.ok) return setFieldErrors(v.errors);
    setFieldErrors({});
    setConfirming(v.data);
  }

  if (confirming) {
    return (
      <ConfirmDialog
        title={t('privacy.retention.confirmTitle')}
        body={t('privacy.retention.confirmBody', {
          entity: entityLabel(policy.entity),
          fromDays: formatNumber(policy.retention_days, 0),
          fromAction: actionLabel(policy.action),
          toDays: formatNumber(confirming.retentionDays, 0),
          toAction: actionLabel(confirming.action),
        })}
        tone="danger"
        confirmLabel={t('privacy.retention.confirm')}
        onClose={onClose}
        onConfirm={async () => {
          await api.privacy.updateRetention(policy.entity, confirming);
          notify(t('privacy.retention.done'));
          onSaved();
        }}
      />
    );
  }

  return (
    <FormDialog
      title={t('privacy.retention.editTitle', { entity: entityLabel(policy.entity) })}
      onClose={onClose}
      onSubmit={review}
      busy={false}
      error={null}
      fieldErrors={fieldErrors}
      submitLabel={t('common.save')}
    >
      <NumberField label={t('privacy.retention.retentionDays')} hint={t('privacy.retention.retentionDaysHint')} value={days} onChange={setDays} error={fieldErrors.retentionDays} required min={1} max={3650} step={1} data-autofocus />
      <SelectField label={t('privacy.retention.action')} value={action} onChange={(v) => setAction(v as RetentionAction)} error={fieldErrors.action} options={RETENTION_ACTIONS.map((a) => ({ value: a, label: actionLabel(a) }))} required />
      <p className="muted">{t('privacy.retention.overrides')}: {overridesSummary(policy.country_overrides)} — {t('privacy.retention.overridesReadOnly')}</p>
    </FormDialog>
  );
}
