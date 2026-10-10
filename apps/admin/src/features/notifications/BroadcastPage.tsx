'use client';

import { adminBroadcast } from '@amora/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { SelectField, TextField } from '@/components/ui/fields';
import { ErrorState, FormError, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';
import { parseList, validate, type FieldErrors } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';
import { KeyValueEditor, rowsToRecord, type KvRow } from './KeyValueEditor';
import { NotificationsTabs } from './shared';

type Body = z.output<typeof adminBroadcast>;

/** `/notifications/broadcast` — system announcement to active users by country/segment (notifications.broadcast). */
export function BroadcastPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="notifications.broadcast" permissions={admin?.permissions ?? []}>
      <Broadcast />
    </RequirePermission>
  );
}

/** Template keys for a select when the admin may read templates; otherwise the key is typed. */
function TemplateKeyField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const api = useAdminApi();
  const { can } = useSession();
  const canList = can('notifications.manage');
  const templates = useResource(() => (canList ? api.notifications.templates() : Promise.resolve(null)), [api, canList]);
  if (canList && templates.status === 'loading') return <LoadingState />;
  if (canList && templates.status === 'error') return <ErrorState error={templates.error} onRetry={templates.reload} />;
  if (templates.status === 'success' && templates.data) {
    const usable = templates.data.filter((x) => x.is_active && x.versions.some((v) => v.status === 'published'));
    return (
      <SelectField
        label={t('notifications.broadcast.template')}
        hint={t('notifications.broadcast.templateSelectHint')}
        value={value}
        onChange={onChange}
        options={usable.map((x) => ({ value: x.key, label: x.key }))}
        placeholder={t('notifications.broadcast.choose')}
        error={error}
        required
      />
    );
  }
  return <TextField label={t('notifications.broadcast.template')} hint={t('notifications.broadcast.templateHint')} value={value} onChange={onChange} error={error} required spellCheck={false} maxLength={64} />;
}

function Broadcast() {
  const api = useAdminApi();
  const notify = useNotify();
  const [templateKey, setTemplateKey] = useState('');
  const [segmentKey, setSegmentKey] = useState('');
  const [countries, setCountries] = useState('');
  const [variables, setVariables] = useState<KvRow[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [estimate, setEstimate] = useState<{ signature: string; count: number } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState<Body | null>(null);

  function build(dryRun: boolean): Body | null {
    const vars = rowsToRecord(variables);
    const codes = parseList(countries).map((c) => c.toUpperCase());
    const v = validate(adminBroadcast, { templateKey: templateKey.trim(), segmentKey: segmentKey.trim() || null, countryCodes: codes.length ? codes : null, variables: vars.value, dryRun });
    const extra = Object.fromEntries(Object.entries(vars.errors).map(([k, m]) => [`variables.${k}`, m]));
    if (!v.ok || Object.keys(extra).length) {
      const all = { ...(v.ok ? {} : v.errors), ...extra };
      const countryError = Object.entries(all).find(([k]) => k.startsWith('countryCodes'))?.[1];
      setErrors({ ...all, ...(countryError ? { countryCodes: countryError } : {}) });
      return null;
    }
    setErrors({});
    return v.data;
  }

  const signature = (b: Body) => JSON.stringify({ ...b, dryRun: undefined });

  async function runEstimate() {
    const body = build(true);
    if (!body) return;
    setEstimating(true);
    setEstimateError(null);
    try {
      const r = await api.notifications.broadcast(body);
      setEstimate({ signature: signature(body), count: r.dryRun ? r.audienceUpperBound : r.queued });
    } catch (e) {
      setEstimateError(e);
      setEstimate(null);
    } finally {
      setEstimating(false);
    }
  }

  function review() {
    const body = build(false);
    if (body) setConfirming(body);
  }

  const kvErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('variables.')).map(([k, v]) => [k.slice('variables.'.length), v]));
  const knownCount = confirming && estimate?.signature === signature(confirming) ? estimate.count : null;

  return (
    <>
      <PageHeader title={t('notifications.broadcast.title')} intro={t('notifications.broadcast.intro')} />
      <NotificationsTabs />
      <form className="card stack" noValidate onSubmit={(e) => { e.preventDefault(); review(); }} aria-label={t('notifications.broadcast.title')}>
        <TemplateKeyField value={templateKey} onChange={setTemplateKey} error={errors.templateKey} />
        <div className="grid grid--2">
          <TextField label={t('notifications.broadcast.segment')} hint={t('notifications.broadcast.segmentHint')} value={segmentKey} onChange={setSegmentKey} error={errors.segmentKey} spellCheck={false} maxLength={64} />
          <TextField label={t('notifications.broadcast.countries')} hint={t('notifications.broadcast.countriesHint')} value={countries} onChange={setCountries} error={errors.countryCodes} spellCheck={false} />
        </div>
        <KeyValueEditor legend={t('notifications.broadcast.variables')} hint={t('notifications.broadcast.variablesHint')} rows={variables} onChange={setVariables} errors={kvErrors} />
        {estimateError ? <FormError message={errorMessage(estimateError)} requestId={requestIdOf(estimateError)} /> : null}
        {estimate ? (
          <div className="kpis" aria-live="polite">
            <div className="kpi">
              <p className="kpi__label">{t('notifications.broadcast.audience')}</p>
              <p className="kpi__value">{formatNumber(estimate.count)}</p>
            </div>
          </div>
        ) : null}
        {estimate ? <p className="muted">{t('notifications.broadcast.audienceHint')}</p> : null}
        <div className="row">
          <Button variant="secondary" onClick={() => void runEstimate()} disabled={estimating}>{estimating ? t('notifications.broadcast.estimating') : t('notifications.broadcast.estimate')}</Button>
          <Button type="submit" variant="danger">{t('notifications.broadcast.send')}</Button>
        </div>
      </form>
      {confirming ? (
        <ConfirmDialog
          title={t('notifications.broadcast.confirmTitle')}
          body={
            <>
              <p>{t('notifications.broadcast.confirmBody', { key: confirming.templateKey })}</p>
              <p>{knownCount !== null ? t('notifications.broadcast.confirmAudience', { count: formatNumber(knownCount) }) : t('notifications.broadcast.confirmNoEstimate')}</p>
            </>
          }
          confirmLabel={t('notifications.broadcast.send')}
          tone="danger"
          confirmPhrase={confirming.templateKey}
          onConfirm={async () => {
            const r = await api.notifications.broadcast(confirming);
            notify(t('notifications.broadcast.queued', { count: formatNumber(r.dryRun ? 0 : r.queued) }));
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
