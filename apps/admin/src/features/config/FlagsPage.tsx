'use client';

import { useState } from 'react';
import type { z } from 'zod';
import type { adminFlagUpsert } from '@amora/shared';
import { FlagRuleEditor } from '@/components/editors/FlagRuleEditor';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, ReadOnlyField, TextAreaField, TextField } from '@/components/ui/fields';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { FlagRow } from '@/lib/api/admin-api';
import { useAdminApi } from '@/lib/auth/session';
import { flagToForm, validateFlagForm, type FlagForm } from '@/lib/flags';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';

export function FlagsPage() {
  const api = useAdminApi();
  const data = useResource(async () => {
    const [flags, segments] = await Promise.all([api.config.flags(), api.config.segments()]);
    return { flags, segmentKeys: segments.map((s) => s.key) };
  }, [api]);
  const [editing, setEditing] = useState<FlagRow | 'new' | null>(null);

  return (
    <>
      <PageHeader title={t('flags.title')} intro={t('flags.intro')} actions={<Button onClick={() => setEditing('new')}>{t('flags.newFlag')}</Button>} />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.flags.length === 0 ? <EmptyState message={t('flags.empty')} /> : null}
      {data.status === 'success' && data.data.flags.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('flags.key')}</th>
                <th scope="col">{t('common.description')}</th>
                <th scope="col">{t('flags.enabled')}</th>
                <th scope="col">{t('flags.defaultValue')}</th>
                <th scope="col">{t('flags.rules')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {data.data.flags.map((f) => (
                <tr key={f.id}>
                  <td><code>{f.key}</code></td>
                  <td>{f.description ?? '—'}</td>
                  <td><BoolBadge value={f.enabled} on={t('flags.on')} off={t('flags.off')} /></td>
                  <td><BoolBadge value={f.default_value} on={t('flags.on')} off={t('flags.off')} /></td>
                  <td>{t('flags.rulesCount', { count: f.rules.length })}</td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(f)} aria-label={`${t('common.edit')} ${f.key}`}>{t('common.edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing && data.status === 'success' ? (
        <FlagDialog flag={editing === 'new' ? null : editing} segmentKeys={data.data.segmentKeys} onClose={() => setEditing(null)} onSaved={data.reload} />
      ) : null}
    </>
  );
}

const EMPTY_FLAG: FlagForm = { key: '', description: '', enabled: false, defaultValue: false, rules: [] };

function FlagDialog({ flag, segmentKeys, onClose, onSaved }: { flag: FlagRow | null; segmentKeys: string[]; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [form, setForm] = useState<FlagForm>(() => (flag ? flagToForm(flag) : EMPTY_FLAG));
  const [confirming, setConfirming] = useState<z.output<typeof adminFlagUpsert> | null>(null);
  const set = <K extends keyof FlagForm>(k: K) => (v: FlagForm[K]) => setForm((s) => ({ ...s, [k]: v }));

  function review() {
    const v = validateFlagForm(form);
    if (!v.ok) return setFieldErrors(v.errors);
    setFieldErrors({});
    // Flags apply to live traffic immediately, so every save is confirmed.
    setConfirming(v.data);
  }

  async function apply(data: z.output<typeof adminFlagUpsert>) {
    const ok = await send(() => api.config.upsertFlag(data));
    if (ok) {
      notify(t('common.saved'));
      onSaved();
      onClose();
    }
  }

  return (
    <>
      <FormDialog title={flag ? t('flags.editFlag', { key: flag.key }) : t('flags.newFlag')} onClose={onClose} onSubmit={review} busy={busy} error={error} fieldErrors={fieldErrors} size="lg">
        {flag ? (
          <ReadOnlyField label={t('flags.key')} value={flag.key} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('flags.key')} hint={t('flags.keyHint')} value={form.key} onChange={set('key')} error={fieldErrors.key} required data-autofocus spellCheck={false} />
        )}
        <TextAreaField label={t('common.description')} value={form.description} onChange={set('description')} error={fieldErrors.description} rows={2} maxLength={500} />
        <CheckboxField label={t('flags.enabled')} hint={t('flags.enabledHint')} checked={form.enabled} onChange={set('enabled')} />
        <CheckboxField label={t('flags.defaultValue')} hint={t('flags.defaultHint')} checked={form.defaultValue} onChange={set('defaultValue')} />
        <FlagRuleEditor rules={form.rules} onChange={set('rules')} segmentKeys={segmentKeys} errors={fieldErrors} />
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('flags.confirmTitle')}
          body={t('flags.confirmBody')}
          confirmLabel={t('flags.confirmAction')}
          onConfirm={() => apply(confirming)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
