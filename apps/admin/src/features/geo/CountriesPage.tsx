'use client';

import { adminCountryUpsert } from '@amora/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { CountryRow } from '@/lib/api/admin-api';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { validate } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';

type CountryPayload = z.output<typeof adminCountryUpsert>;

export function CountriesPage() {
  const api = useAdminApi();
  const countries = useResource(() => api.geo.countries(), [api]);
  const [editing, setEditing] = useState<CountryRow | 'new' | null>(null);

  return (
    <>
      <PageHeader title={t('countries.title')} intro={t('countries.intro')} actions={<Button onClick={() => setEditing('new')}>{t('countries.newCountry')}</Button>} />
      {countries.status === 'loading' ? <LoadingState /> : null}
      {countries.status === 'error' ? <ErrorState error={countries.error} onRetry={countries.reload} /> : null}
      {countries.status === 'success' && countries.data.length === 0 ? <EmptyState message={t('countries.empty')} /> : null}
      {countries.status === 'success' && countries.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('countries.code')}</th>
                <th scope="col">{t('countries.name')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('countries.minAge')}</th>
                <th scope="col">{t('countries.dataRegion')}</th>
                <th scope="col">{t('countries.privacyRegime')}</th>
                <th scope="col">{t('countries.idVerification')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {countries.data.map((c) => (
                <tr key={c.code}>
                  <td><code>{c.code}</code></td>
                  <td>{c.name}</td>
                  <td><BoolBadge value={c.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                  <td>{c.min_age ?? t('countries.notConfigured')}</td>
                  <td>{c.data_region ?? '—'}</td>
                  <td>{c.privacy_regime ?? '—'}</td>
                  <td><BoolBadge value={c.identity_verification_available} /></td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label={`${t('common.edit')} ${c.name}`}>{t('common.edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <CountryDialog country={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={countries.reload} /> : null}
    </>
  );
}

function CountryDialog({ country, onClose, onSaved }: { country: CountryRow | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [confirming, setConfirming] = useState<CountryPayload | null>(null);
  // Defaults for a missing config row mirror the database column defaults.
  const [f, setF] = useState({
    code: country?.code ?? '',
    name: country?.name ?? '',
    defaultLocale: country?.default_locale ?? 'en',
    defaultCurrency: country?.default_currency ?? '',
    measurement: country?.measurement ?? 'metric',
    isActive: country?.is_active ?? true,
    minAge: (country?.min_age ?? 18) as number | undefined,
    emergencyNumber: country?.emergency_number ?? '',
    crossedPathsAllowed: country?.crossed_paths_allowed ?? false,
    identityVerificationAvailable: country?.identity_verification_available ?? false,
    religionFieldEnabled: country?.religion_field_enabled ?? true,
    dataRegion: country?.data_region ?? 'global',
    privacyRegime: country?.privacy_regime ?? '',
    dataRetentionDays: (country?.data_retention_days ?? 730) as number | undefined,
  });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function persist(data: CountryPayload) {
    const ok = await send(() => api.geo.upsertCountry(data));
    if (ok) {
      notify(t('common.saved'));
      onSaved();
      onClose();
    }
  }

  function save() {
    const v = validate(adminCountryUpsert, {
      code: f.code.trim().toUpperCase(),
      name: f.name.trim(),
      defaultLocale: f.defaultLocale.trim(),
      defaultCurrency: f.defaultCurrency.trim().toUpperCase(),
      measurement: f.measurement,
      isActive: f.isActive,
      config: {
        minAge: f.minAge,
        emergencyNumber: f.emergencyNumber.trim() || null,
        crossedPathsAllowed: f.crossedPathsAllowed,
        identityVerificationAvailable: f.identityVerificationAvailable,
        religionFieldEnabled: f.religionFieldEnabled,
        dataRegion: f.dataRegion.trim(),
        privacyRegime: f.privacyRegime.trim() || null,
        dataRetentionDays: f.dataRetentionDays,
      },
    });
    if (!v.ok) return setFieldErrors(v.errors);
    setFieldErrors({});
    // Deactivating a live country blocks new sign-ups there; make that an explicit decision.
    if (country?.is_active && !v.data.isActive) return setConfirming(v.data);
    void persist(v.data);
  }

  const e = fieldErrors;
  return (
    <>
      <FormDialog title={country ? t('countries.editCountry', { name: country.name }) : t('countries.newCountry')} onClose={onClose} onSubmit={save} busy={busy} error={error} fieldErrors={fieldErrors} size="lg">
        <div className="grid grid--3">
          {country ? (
            <ReadOnlyField label={t('countries.code')} value={country.code} hint={t('common.immutableHint')} />
          ) : (
            <TextField label={t('countries.code')} hint={t('countries.codeHint')} value={f.code} onChange={set('code')} error={e.code} required maxLength={2} data-autofocus />
          )}
          <TextField label={t('countries.name')} value={f.name} onChange={set('name')} error={e.name} required maxLength={100} />
          <TextField label={t('countries.defaultLocale')} value={f.defaultLocale} onChange={set('defaultLocale')} error={e.defaultLocale} required />
          <TextField label={t('countries.defaultCurrency')} hint={t('countries.currencyHint')} value={f.defaultCurrency} onChange={set('defaultCurrency')} error={e.defaultCurrency} required maxLength={3} />
          <SelectField
            label={t('countries.measurement')}
            value={f.measurement}
            onChange={(v) => set('measurement')(v as 'metric' | 'imperial')}
            options={[{ value: 'metric', label: t('countries.metric') }, { value: 'imperial', label: t('countries.imperial') }]}
            error={e.measurement}
          />
        </div>
        <CheckboxField label={t('common.active')} checked={f.isActive} onChange={set('isActive')} />
        <fieldset>
          <legend>{t('countries.compliance')}</legend>
          <div className="grid grid--3">
            <NumberField label={t('countries.minAge')} min={18} max={25} step={1} value={f.minAge} onChange={set('minAge')} error={e['config.minAge']} required />
            <TextField label={t('countries.emergencyNumber')} hint={t('countries.emergencyHint')} value={f.emergencyNumber} onChange={set('emergencyNumber')} error={e['config.emergencyNumber']} maxLength={20} />
            <NumberField label={t('countries.retentionDays')} min={30} max={3650} step={1} value={f.dataRetentionDays} onChange={set('dataRetentionDays')} error={e['config.dataRetentionDays']} required />
            <TextField label={t('countries.dataRegion')} value={f.dataRegion} onChange={set('dataRegion')} error={e['config.dataRegion']} maxLength={20} required />
            <TextField label={t('countries.privacyRegime')} hint={t('countries.privacyRegimeHint')} value={f.privacyRegime} onChange={set('privacyRegime')} error={e['config.privacyRegime']} maxLength={20} />
          </div>
          <CheckboxField label={t('countries.crossedPaths')} checked={f.crossedPathsAllowed} onChange={set('crossedPathsAllowed')} />
          <CheckboxField label={t('countries.idVerification')} checked={f.identityVerificationAvailable} onChange={set('identityVerificationAvailable')} />
          <CheckboxField label={t('countries.religionField')} checked={f.religionFieldEnabled} onChange={set('religionFieldEnabled')} />
        </fieldset>
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('countries.deactivateTitle', { name: confirming.name })}
          body={t('countries.deactivateBody')}
          confirmLabel={t('countries.deactivateConfirm')}
          tone="danger"
          onConfirm={() => persist(confirming)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
