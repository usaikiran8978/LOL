'use client';

import { adminCaseUpdate } from '@amora/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { SEVERITIES, type CaseDetail } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { validate } from '@/lib/forms/validate';
import { enumOptions } from './labels';

type Update = z.output<typeof adminCaseUpdate>;
const UPDATABLE = ['open', 'in_review', 'escalated', 'dismissed', 'closed'] as const;

/**
 * Status / severity / assignment (`PUT cases/:id`, moderation.view). The API additionally requires
 * moderation.assign to assign others or unassign, and moderation.escalate to set "escalated".
 */
export function CaseUpdateDialog({ c, onClose, onSaved }: { c: CaseDetail; onClose: () => void; onSaved: () => void }) {
  const { api, can } = useSession();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const canAssign = can('moderation.assign');
  const statuses = UPDATABLE.filter((s) => s !== 'escalated' || can('moderation.escalate') || c.status === 'escalated');
  const [form, setForm] = useState({
    status: (UPDATABLE as readonly string[]).includes(c.status) ? c.status : '',
    severity: c.severity as string,
    resolutionKey: '',
    assign: 'keep',
    assigneeId: '',
  });
  const [confirming, setConfirming] = useState<Update | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((s) => ({ ...s, [k]: v }));
  const closing = form.status === 'dismissed' || form.status === 'closed';

  function review() {
    const value: Record<string, unknown> = {};
    if (form.status && form.status !== c.status) value.status = form.status;
    if (form.severity !== c.severity) value.severity = form.severity;
    if (closing && form.resolutionKey.trim()) value.resolutionKey = form.resolutionKey.trim();
    if (form.assign === 'me') value.assignTo = 'me';
    else if (form.assign === 'none') value.assignTo = null;
    else if (form.assign === 'other') value.assignTo = form.assigneeId.trim();
    const v = validate(adminCaseUpdate, value);
    if (!v.ok) {
      const { assignTo, ...rest } = v.errors;
      return setFieldErrors(assignTo ? { ...rest, assigneeId: assignTo } : rest);
    }
    setFieldErrors({});
    if (Object.keys(v.data).length === 0) return onClose();
    // Dismissing or closing resolves the case (dismissal also dismisses its reports) — confirm first.
    if (v.data.status === 'dismissed' || v.data.status === 'closed') return setConfirming(v.data);
    void apply(v.data);
  }

  async function apply(data: Update) {
    const ok = await send(() => api.safety.updateCase(c.id, data));
    if (ok) {
      notify(t('common.saved'));
      onSaved();
      onClose();
    }
    return ok;
  }

  return (
    <>
      <FormDialog title={t('safety.update.title')} onClose={onClose} onSubmit={review} busy={busy} error={error} fieldErrors={fieldErrors}>
        <SelectField label={t('safety.cases.status')} value={form.status} onChange={set('status')} error={fieldErrors.status} placeholder={t('safety.update.keepStatus')} options={enumOptions('caseStatus', statuses)} />
        {!can('moderation.escalate') ? <p className="muted">{t('safety.update.escalateNeedsPermission')}</p> : null}
        <SelectField label={t('safety.cases.severity')} hint={t('safety.update.severityHint')} value={form.severity} onChange={set('severity')} error={fieldErrors.severity} options={enumOptions('severity', SEVERITIES)} />
        {closing ? (
          <TextField label={t('safety.update.resolutionKey')} hint={t('safety.update.resolutionHint')} value={form.resolutionKey} onChange={set('resolutionKey')} error={fieldErrors.resolutionKey} maxLength={60} spellCheck={false} />
        ) : null}
        <SelectField
          label={t('safety.update.assignment')}
          value={form.assign}
          onChange={set('assign')}
          options={[
            { value: 'keep', label: t('safety.update.keepAssignment') },
            { value: 'me', label: t('safety.update.assignMe') },
            ...(canAssign ? [{ value: 'other', label: t('safety.update.assignOther') }, { value: 'none', label: t('safety.update.unassign') }] : []),
          ]}
        />
        {!canAssign ? <p className="muted">{t('safety.update.assignNeedsPermission')}</p> : null}
        {form.assign === 'other' ? (
          <TextField label={t('safety.update.assigneeId')} hint={t('safety.update.assigneeHint')} value={form.assigneeId} onChange={set('assigneeId')} error={fieldErrors.assigneeId} required spellCheck={false} />
        ) : null}
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('safety.update.confirmCloseTitle', { status: t(`safety.caseStatus.${confirming.status === 'dismissed' ? 'dismissed' : 'closed'}`) })}
          body={confirming.status === 'dismissed' ? t('safety.update.confirmDismissBody') : t('safety.update.confirmCloseBody')}
          confirmLabel={t('common.confirm')}
          tone="danger"
          onConfirm={async () => {
            await apply(confirming);
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
