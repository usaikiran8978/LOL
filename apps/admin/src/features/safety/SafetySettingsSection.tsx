'use client';

import { adminSettingUpsert } from '@amora/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, TextAreaField, TextField } from '@/components/ui/fields';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import type { SettingRow } from '@/lib/api/admin-api';
import { useSession } from '@/lib/auth/session';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { validate, type FieldErrors } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';
import { label } from './labels';
import { IMAGE_POLICY_DEFAULT, imagePolicySchema, oncallSchema, SAFETY_SETTINGS, SLA_DEFAULT, slaSchema, validDaysSchema, type SafetySetting } from './safetySettings';

type Sla = typeof SLA_DEFAULT;
type ImagePolicy = typeof IMAGE_POLICY_DEFAULT;
type Body = z.output<typeof adminSettingUpsert>;

function current(s: SafetySetting, rows: SettingRow[]): { value: unknown; row: SettingRow | undefined } {
  const row = rows.find((r) => r.key === s.key);
  return { value: row && row.value !== null && row.value !== undefined ? row.value : s.fallback, row };
}

function display(s: SafetySetting, value: unknown): string {
  switch (s.kind) {
    case 'sla': {
      const v = { ...SLA_DEFAULT, ...(value as Partial<Sla>) };
      return (['critical', 'high', 'medium', 'low'] as const).map((k) => `${label('severity', k)}: ${t('safety.thresholds.hours', { hours: formatNumber(v[k]) })}`).join(' · ');
    }
    case 'imagePolicy': {
      const v = { ...IMAGE_POLICY_DEFAULT, ...(value as Partial<ImagePolicy>) };
      return t('safety.settings.imagePolicySummary', { reject: formatPercent(v.rejectConfidence), review: formatPercent(v.reviewConfidence), rejectCount: v.rejectLabels.length, reviewCount: v.reviewLabels.length });
    }
    case 'boolean':
      return value === true ? t('common.yes') : t('common.no');
    case 'email':
      return typeof value === 'string' && value ? value : t('safety.settings.notSet');
    case 'days':
      return t('safety.settings.days', { days: formatNumber(Number(value)) });
  }
}

/** Safety-related system settings. Only rendered for admins with `settings.manage` (the endpoint's permission). */
export function SafetySettingsSection() {
  const { api, can } = useSession();
  const allowed = can('settings.manage');
  return (
    <section className="section" aria-labelledby="safety-settings">
      <h2 id="safety-settings">{t('safety.settings.title')}</h2>
      {allowed ? <SettingsTable load={() => api.config.settings()} /> : <p className="alert alert--info">{t('safety.settings.noPermission')}</p>}
    </section>
  );
}

function SettingsTable({ load }: { load: () => Promise<SettingRow[]> }) {
  const { api } = useSession();
  const data = useResource(load, [api]);
  const [editing, setEditing] = useState<SafetySetting | null>(null);
  if (data.status === 'loading') return <LoadingState />;
  if (data.status === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;
  return (
    <>
      <p className="muted">{t('safety.settings.intro')}</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('safety.settings.setting')}</th>
              <th scope="col">{t('safety.settings.value')}</th>
              <th scope="col">{t('safety.settings.updatedAt')}</th>
              <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {SAFETY_SETTINGS.map((s) => {
              const { value, row } = current(s, data.data);
              return (
                <tr key={s.key}>
                  <td>{t(`safety.settings.names.${s.id}`)}<br /><code className="muted">{s.key}</code><div className="muted">{t(`safety.settings.hints.${s.id}`)}</div></td>
                  <td>{display(s, value)}{!row ? <div className="muted">{t('safety.settings.default')}</div> : null}</td>
                  <td>{row ? formatDateTime(row.updated_at) : '—'}</td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)} aria-label={`${t('common.edit')} ${s.key}`}>{t('common.edit')}</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing ? <SettingDialog setting={editing} initial={current(editing, data.data)} onClose={() => setEditing(null)} onSaved={data.reload} /> : null}
    </>
  );
}

interface Draft {
  sla: { critical: number | undefined; high: number | undefined; medium: number | undefined; low: number | undefined };
  rejectLabels: string;
  reviewLabels: string;
  rejectConfidence: number | undefined;
  reviewConfidence: number | undefined;
  bool: boolean;
  email: string;
  days: number | undefined;
}

function toDraft(s: SafetySetting, value: unknown): Draft {
  const sla = { ...SLA_DEFAULT, ...(s.kind === 'sla' ? (value as Partial<Sla>) : {}) };
  const policy = { ...IMAGE_POLICY_DEFAULT, ...(s.kind === 'imagePolicy' ? (value as Partial<ImagePolicy>) : {}) };
  return {
    sla,
    rejectLabels: policy.rejectLabels.join('\n'),
    reviewLabels: policy.reviewLabels.join('\n'),
    rejectConfidence: policy.rejectConfidence,
    reviewConfidence: policy.reviewConfidence,
    bool: value === true,
    email: typeof value === 'string' ? value : '',
    days: typeof value === 'number' ? value : undefined,
  };
}

const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);

function parse(s: SafetySetting, d: Draft): { ok: true; value: unknown } | { ok: false; errors: FieldErrors } {
  switch (s.kind) {
    case 'sla': {
      const v = validate(slaSchema, d.sla);
      return v.ok ? { ok: true, value: v.data } : v;
    }
    case 'imagePolicy': {
      const v = validate(imagePolicySchema, { rejectLabels: lines(d.rejectLabels), reviewLabels: lines(d.reviewLabels), rejectConfidence: d.rejectConfidence, reviewConfidence: d.reviewConfidence });
      if (!v.ok) return v;
      if (v.data.reviewConfidence > v.data.rejectConfidence) return { ok: false, errors: { reviewConfidence: t('safety.settings.reviewAboveReject') } };
      return { ok: true, value: v.data };
    }
    case 'boolean':
      return { ok: true, value: d.bool };
    case 'email': {
      const v = validate(oncallSchema, d.email.trim());
      return v.ok ? { ok: true, value: v.data } : { ok: false, errors: { email: t('safety.settings.emailInvalid') } };
    }
    case 'days': {
      const v = validate(validDaysSchema, d.days);
      return v.ok ? { ok: true, value: v.data } : { ok: false, errors: { days: v.errors[''] ?? t('validation.invalid') } };
    }
  }
}

function SettingDialog({ setting, initial, onClose, onSaved }: { setting: SafetySetting; initial: { value: unknown; row: SettingRow | undefined }; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [d, setD] = useState<Draft>(() => toDraft(setting, initial.value));
  const [confirming, setConfirming] = useState<Body | null>(null);
  const setSla = (k: keyof Draft['sla']) => (v: number | undefined) => setD((s) => ({ ...s, sla: { ...s.sla, [k]: v } }));
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));

  function review() {
    const p = parse(setting, d);
    if (!p.ok) return setFieldErrors(p.errors);
    const body = validate(adminSettingUpsert, { value: p.value, valueType: setting.valueType, description: initial.row?.description ?? undefined });
    if (!body.ok) return setFieldErrors(body.errors);
    setFieldErrors({});
    setConfirming(body.data);
  }

  async function apply(body: Body) {
    const ok = await send(() => api.config.upsertSetting(setting.key, body));
    if (ok) {
      notify(t('common.saved'));
      onSaved();
      onClose();
    }
  }

  return (
    <>
      <FormDialog title={t('safety.settings.editTitle', { name: t(`safety.settings.names.${setting.id}`) })} onClose={onClose} onSubmit={review} busy={busy} error={error} fieldErrors={fieldErrors}>
        <p className="muted">{t(`safety.settings.hints.${setting.id}`)}</p>
        {setting.kind === 'sla' ? (
          <div className="grid grid--2">
            {(['critical', 'high', 'medium', 'low'] as const).map((k) => (
              <NumberField key={k} label={t('safety.settings.slaFor', { severity: label('severity', k) })} value={d.sla[k]} onChange={setSla(k)} error={fieldErrors[k]} min={0} step="any" required />
            ))}
          </div>
        ) : null}
        {setting.kind === 'imagePolicy' ? (
          <>
            <div className="grid grid--2">
              <NumberField label={t('safety.settings.rejectConfidence')} value={d.rejectConfidence} onChange={set('rejectConfidence')} error={fieldErrors.rejectConfidence} min={0} max={1} step="any" required />
              <NumberField label={t('safety.settings.reviewConfidence')} value={d.reviewConfidence} onChange={set('reviewConfidence')} error={fieldErrors.reviewConfidence} min={0} max={1} step="any" required />
            </div>
            <TextAreaField label={t('safety.settings.rejectLabels')} hint={t('safety.settings.labelsHint')} value={d.rejectLabels} onChange={set('rejectLabels')} error={fieldErrors.rejectLabels} rows={5} />
            <TextAreaField label={t('safety.settings.reviewLabels')} hint={t('safety.settings.labelsHint')} value={d.reviewLabels} onChange={set('reviewLabels')} error={fieldErrors.reviewLabels} rows={5} />
          </>
        ) : null}
        {setting.kind === 'boolean' ? <CheckboxField label={t(`safety.settings.names.${setting.id}`)} checked={d.bool} onChange={set('bool')} /> : null}
        {setting.kind === 'email' ? <TextField type="email" label={t('safety.settings.email')} hint={t('safety.settings.emailHint')} value={d.email} onChange={set('email')} error={fieldErrors.email} /> : null}
        {setting.kind === 'days' ? <NumberField label={t('safety.settings.validDays')} value={d.days} onChange={set('days')} error={fieldErrors.days} min={1} max={3650} step={1} required /> : null}
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('safety.settings.confirmTitle', { name: t(`safety.settings.names.${setting.id}`) })}
          body={t('safety.settings.confirmBody')}
          confirmLabel={t('safety.rules.confirmAction')}
          onConfirm={() => apply(confirming)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
