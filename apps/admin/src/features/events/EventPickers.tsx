'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CheckboxField, SelectField, TextField } from '@/components/ui/fields';
import { ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import type { CityRow } from '@/lib/api/admin-api';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { parseList } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';

/*
 * The event form references taxonomy terms, cities and interests by key/id. Their admin list endpoints need
 * taxonomy.manage / geo.manage, so admins without those permissions type the identifiers instead.
 */

const label = (translations: Record<string, Partial<Record<string, string | null>>>, fallback: string, field = 'label') => translations.en?.[field] ?? fallback;

export function CategoryField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const api = useAdminApi();
  const { can } = useSession();
  const allowed = can('taxonomy.manage');
  const terms = useResource(() => (allowed ? api.taxonomy.terms('event_category') : Promise.resolve(null)), [api, allowed]);
  if (allowed && terms.status === 'loading') return <LoadingState />;
  if (allowed && terms.status === 'error') return <ErrorState error={terms.error} onRetry={terms.reload} />;
  if (terms.status === 'success' && terms.data) {
    const options = terms.data.filter((x) => x.is_active).map((x) => ({ value: x.key, label: label(x.translations, x.key) }));
    return <SelectField label={t('events.form.category')} value={value} onChange={onChange} options={options} placeholder={t('events.form.choose')} error={error} required />;
  }
  return <TextField label={t('events.form.category')} hint={t('events.form.categoryKeyHint')} value={value} onChange={onChange} error={error} required spellCheck={false} maxLength={50} />;
}

function CitySearch({ value, onChange, error, required }: { value: string; onChange: (v: string) => void; error?: string; required: boolean }) {
  const api = useAdminApi();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CityRow[] | null>(null);
  const [searchError, setSearchError] = useState<unknown>(null);

  async function search() {
    setBusy(true);
    setSearchError(null);
    try {
      setResults((await api.geo.cities({ q: q.trim() || undefined, limit: 20 })).items);
    } catch (e) {
      setSearchError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row row--end">
        <TextField
          label={t('events.form.citySearch')}
          type="search"
          value={q}
          onChange={setQ}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
        />
        <Button variant="secondary" onClick={() => void search()} disabled={busy}>{busy ? t('events.form.searching') : t('events.form.searchCities')}</Button>
      </div>
      {searchError ? <FormError message={errorMessage(searchError)} requestId={requestIdOf(searchError)} /> : null}
      {results ? (
        <SelectField
          label={t('events.form.city')}
          value={value}
          onChange={onChange}
          options={results.map((c) => ({ value: c.id, label: [c.name, c.admin_region, c.country_code].filter(Boolean).join(', ') }))}
          placeholder={results.length ? t('events.form.choose') : t('events.form.noCities')}
          error={error}
          required={required}
        />
      ) : error ? <p className="field__error" role="alert">{error}</p> : <p className="field__hint">{t('events.form.citySearchHint')}</p>}
    </div>
  );
}

/** `required: false` (edit form): an empty value means "keep the current city". */
export function CityField({ value, onChange, error, required = true, hint }: { value: string; onChange: (v: string) => void; error?: string; required?: boolean; hint?: string }) {
  const { can } = useSession();
  if (can('geo.manage')) return <CitySearch value={value} onChange={onChange} error={error} required={required} />;
  return <TextField label={t('events.form.cityId')} hint={hint ?? t('events.form.cityIdHint')} value={value} onChange={onChange} error={error} required={required} spellCheck={false} maxLength={36} />;
}

/** `hint` overrides the event-specific hint (other forms reuse the picker with different limits). */
export function InterestsField({ value, onChange, error, hint }: { value: string[]; onChange: (v: string[]) => void; error?: string; hint?: string }) {
  const api = useAdminApi();
  const { can } = useSession();
  const allowed = can('taxonomy.manage');
  const interests = useResource(() => (allowed ? api.taxonomy.interests() : Promise.resolve(null)), [api, allowed]);
  const [text, setText] = useState(value.join(', '));

  if (allowed && interests.status === 'loading') return <LoadingState />;
  if (allowed && interests.status === 'error') return <ErrorState error={interests.error} onRetry={interests.reload} />;
  if (interests.status === 'success' && interests.data) {
    const active = interests.data.filter((i) => i.is_active);
    return (
      <fieldset className="field">
        <legend className="field__label">{t('events.form.interests')}</legend>
        <p className="field__hint">{hint ?? t('events.form.interestsHint')}</p>
        {active.length === 0 ? <p className="muted">{t('events.form.noInterests')}</p> : null}
        <div className="grid grid--3">
          {active.map((i) => (
            <CheckboxField
              key={i.id}
              label={label(i.translations, i.key)}
              checked={value.includes(i.id)}
              onChange={(on) => onChange(on ? [...value, i.id] : value.filter((x) => x !== i.id))}
            />
          ))}
        </div>
        {error ? <p className="field__error" role="alert">{error}</p> : null}
      </fieldset>
    );
  }
  return (
    <TextField
      label={t('events.form.interestIds')}
      hint={hint ?? t('events.form.interestIdsHint')}
      value={text}
      onChange={(v) => {
        setText(v);
        onChange(parseList(v));
      }}
      error={error}
      spellCheck={false}
    />
  );
}
