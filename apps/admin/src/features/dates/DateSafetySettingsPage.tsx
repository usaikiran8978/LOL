'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { NumberField } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { DateSafetySetting } from '@/lib/api/modules/dates';
import { useSession } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';
import { validate } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';
import { DatesTabs } from './DatesTabs';

export function DateSafetySettingsPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="date_safety.manage" permissions={admin?.permissions ?? []}>
      <SettingsList />
    </RequirePermission>
  );
}

function SettingsList() {
  const { api } = useSession();
  const data = useResource(() => api.dates.safetySettings(), [api]);
  const [editing, setEditing] = useState<DateSafetySetting | null>(null);

  return (
    <>
      <PageHeader title={t('dates.safety.title')} intro={t('dates.safety.intro')} />
      <DatesTabs />
      <p className="muted">{t('dates.safety.flagHint')}</p>
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.length === 0 ? <EmptyState message={t('dates.safety.empty')} /> : null}
      {data.status === 'success' && data.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="table__caption">{t('dates.safety.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('dates.safety.setting')}</th>
                <th scope="col" className="num">{t('dates.safety.value')}</th>
                <th scope="col">{t('dates.safety.range')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((s) => (
                <tr key={s.key}>
                  <td>
                    {s.description}
                    <br />
                    <code className="muted">{s.key}</code>
                  </td>
                  <td className="num"><strong>{formatNumber(s.value)}</strong></td>
                  <td>{t('dates.safety.rangeValue', { min: formatNumber(s.min), max: formatNumber(s.max) })}</td>
                  <td className="table__actions">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`${t('dates.safety.edit')} ${s.key}`}>{t('dates.safety.edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <EditSettingDialog setting={editing} onClose={() => setEditing(null)} onSaved={data.reload} /> : null}
    </>
  );
}

/** `PUT admin/dates/safety/settings/:key` — a bounded integer; the API rejects values outside [min, max]. */
function EditSettingDialog({ setting, onClose, onSaved }: { setting: DateSafetySetting; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const notify = useNotify();
  const [value, setValue] = useState<number | undefined>(setting.value);
  const [error, setError] = useState<string | undefined>();
  const schema = z.number().int().min(setting.min).max(setting.max);

  return (
    <ConfirmDialog
      title={t('dates.safety.editTitle', { key: setting.key })}
      body={<p>{setting.description}</p>}
      confirmLabel={t('dates.safety.confirmAction')}
      onClose={onClose}
      onConfirm={async () => {
        const v = validate(schema, value);
        if (!v.ok) {
          setError(v.errors['']);
          return false;
        }
        setError(undefined);
        await api.dates.updateSafetySetting(setting.key, v.data);
        notify(t('dates.safety.saved', { key: setting.key }));
        onSaved();
      }}
    >
      <NumberField
        label={t('dates.safety.value')}
        hint={t('dates.safety.valueHint', { min: formatNumber(setting.min), max: formatNumber(setting.max) })}
        value={value}
        onChange={setValue}
        error={error}
        min={setting.min}
        max={setting.max}
        step={1}
        required
      />
      <p className="muted">{t('dates.safety.confirmBody', { key: setting.key, before: formatNumber(setting.value), after: value === undefined ? '—' : formatNumber(value) })}</p>
    </ConfirmDialog>
  );
}
