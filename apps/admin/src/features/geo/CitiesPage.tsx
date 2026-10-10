'use client';

import { adminCityUpsert } from '@amora/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, SelectField, TextField } from '@/components/ui/fields';
import { BoolBadge, EmptyState, ErrorState, FormError, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { CityRow, CountryRow } from '@/lib/api/admin-api';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';

const PAGE_SIZE = 50;

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

export function CitiesPage() {
  const api = useAdminApi();
  const countries = useResource(() => api.geo.countries(), [api]);
  const [country, setCountry] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState<{ country?: string; q?: string }>({});
  const [items, setItems] = useState<CityRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [editing, setEditing] = useState<CityRow | 'new' | null>(null);

  useEffect(() => {
    let current = true;
    setStatus('loading');
    setMoreError(null);
    api.geo.cities({ ...query, limit: PAGE_SIZE }).then(
      (page) => {
        if (!current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setStatus('ready');
      },
      (e: unknown) => {
        if (!current) return;
        setError(e);
        setStatus('error');
      },
    );
    return () => { current = false; };
  }, [api, query, nonce]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const page = await api.geo.cities({ ...query, cursor, limit: PAGE_SIZE });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setMoreError(e);
    } finally {
      setMoreBusy(false);
    }
  }, [api, query, cursor]);

  const countryOptions = useMemo(() => (countries.data ?? []).map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })), [countries.data]);

  return (
    <>
      <PageHeader title={t('cities.title')} intro={t('cities.intro')} actions={<Button onClick={() => setEditing('new')}>{t('cities.newCity')}</Button>} />
      <form
        className="filters"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ country: country || undefined, q: search.trim().slice(0, 80) || undefined });
        }}
      >
        <SelectField label={t('cities.country')} value={country} onChange={setCountry} placeholder={t('cities.anyCountry')} options={countryOptions} className="field--inline" />
        <TextField label={t('cities.search')} type="search" value={search} onChange={setSearch} maxLength={80} className="field--inline" />
        <button type="submit" className="btn btn--primary btn--md">{t('common.apply')}</button>
      </form>
      {countries.status === 'error' ? <ErrorState error={countries.error} onRetry={countries.reload} /> : null}
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState error={error} onRetry={() => setNonce((n) => n + 1)} /> : null}
      {status === 'ready' && items.length === 0 ? <EmptyState message={t('cities.empty')} /> : null}
      {status === 'ready' && items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('cities.name')}</th>
                <th scope="col">{t('cities.country')}</th>
                <th scope="col">{t('cities.adminRegion')}</th>
                <th scope="col">{t('cities.timezone')}</th>
                <th scope="col">{t('cities.population')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.country_code}</td>
                  <td>{c.admin_region ?? '—'}</td>
                  <td>{c.timezone}</td>
                  <td>{c.population?.toLocaleString() ?? '—'}</td>
                  <td><BoolBadge value={c.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label={`${t('common.edit')} ${c.name}`}>{t('common.edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {moreError ? <FormError message={errorMessage(moreError)} requestId={requestIdOf(moreError)} /> : null}
          <div className="row pager">
            {cursor ? (
              <Button variant="secondary" onClick={() => void loadMore()} disabled={moreBusy}>{moreBusy ? t('common.loadingMore') : t('common.loadMore')}</Button>
            ) : (
              <span className="muted">{t('common.endOfList')}</span>
            )}
          </div>
        </div>
      ) : null}
      {editing ? (
        <CityDialog
          city={editing === 'new' ? null : editing}
          countries={countries.data ?? []}
          defaultCountry={country}
          onClose={() => setEditing(null)}
          onSaved={() => setNonce((n) => n + 1)}
        />
      ) : null}
    </>
  );
}

function CityDialog({ city, countries, defaultCountry, onClose, onSaved }: { city: CityRow | null; countries: CountryRow[]; defaultCountry: string; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const zones = useMemo(timeZones, []);
  const [f, setF] = useState({
    countryCode: city?.country_code ?? defaultCountry,
    name: city?.name ?? '',
    adminRegion: city?.admin_region ?? '',
    latitude: city?.latitude as number | undefined,
    longitude: city?.longitude as number | undefined,
    timezone: city?.timezone ?? '',
    population: (city?.population ?? undefined) as number | undefined,
    isActive: city?.is_active ?? true,
  });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const e = fieldErrors;
  const zoneError = f.timezone && f.timezone !== 'UTC' && zones.length > 0 && !zones.includes(f.timezone) ? t('validation.invalidOption') : undefined;

  async function save() {
    const payload = { ...f, name: f.name.trim(), adminRegion: f.adminRegion.trim() || undefined, timezone: f.timezone.trim() };
    const ok = await submit(adminCityUpsert, payload, (d) => (city ? api.geo.updateCity(city.id, d) : api.geo.createCity(d)), zoneError ? { timezone: zoneError } : {});
    if (ok) {
      notify(city ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={city ? t('cities.editCity', { name: city.name }) : t('cities.newCity')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} size="lg">
      <div className="grid grid--2">
        <SelectField
          label={t('cities.country')}
          value={f.countryCode}
          onChange={set('countryCode')}
          placeholder=""
          options={countries.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))}
          error={e.countryCode}
          required
        />
        <TextField label={t('cities.name')} value={f.name} onChange={set('name')} error={e.name} required maxLength={120} />
        <TextField label={t('cities.adminRegion')} value={f.adminRegion} onChange={set('adminRegion')} error={e.adminRegion} maxLength={120} />
        <TextField label={t('cities.timezone')} hint={t('cities.timezoneHint')} value={f.timezone} onChange={set('timezone')} error={e.timezone} required list="iana-zones" />
        <NumberField label={t('cities.latitude')} min={-90} max={90} step="any" value={f.latitude} onChange={set('latitude')} error={e.latitude} required />
        <NumberField label={t('cities.longitude')} min={-180} max={180} step="any" value={f.longitude} onChange={set('longitude')} error={e.longitude} required />
        <NumberField label={t('cities.population')} min={0} step={1} value={f.population} onChange={set('population')} error={e.population} />
      </div>
      <datalist id="iana-zones">
        {zones.map((z) => <option key={z} value={z} />)}
      </datalist>
      <CheckboxField label={t('common.active')} checked={f.isActive} onChange={set('isActive')} />
    </FormDialog>
  );
}
