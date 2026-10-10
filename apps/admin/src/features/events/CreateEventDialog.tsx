'use client';

import { useState } from 'react';
import type { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { adminEventCreate } from '@/lib/api/modules/events';
import { useAdminApi } from '@/lib/auth/session';
import { formatMoney } from '@/lib/format';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { localInputToIso, validate } from '@/lib/forms/validate';
import { CategoryField, CityField, InterestsField } from './EventPickers';

type Visibility = 'public' | 'unlisted' | 'premium_only';
const VISIBILITIES: Visibility[] = ['public', 'unlisted', 'premium_only'];
type Body = z.output<typeof adminEventCreate>;

interface Form {
  title: string;
  description: string;
  categoryKey: string;
  cityId: string;
  venueName: string;
  venueAddress: string;
  latitude: number | undefined;
  longitude: number | undefined;
  isOnline: boolean;
  startsAt: string;
  endsAt: string;
  timezone: string;
  capacity: number | undefined;
  minAge: number | undefined;
  maxAge: number | undefined;
  interestIds: string[];
  preEventMatching: boolean;
  chatEnabled: boolean;
  visibility: Visibility;
  priceMinor: number | undefined;
  currency: string;
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

const initial = (): Form => ({
  title: '', description: '', categoryKey: '', cityId: '', venueName: '', venueAddress: '', latitude: undefined, longitude: undefined, isOnline: false,
  startsAt: '', endsAt: '', timezone: browserTimeZone(), capacity: undefined, minAge: undefined, maxAge: undefined, interestIds: [],
  preEventMatching: false, chatEnabled: true, visibility: 'public', priceMinor: undefined, currency: '',
});

const opt = (s: string) => s.trim() || undefined;

/** Builds the request body: blank optional inputs are omitted, local date-times become UTC ISO strings. */
function toPayload(f: Form) {
  return {
    title: f.title.trim(), description: f.description.trim(), categoryKey: f.categoryKey.trim(), cityId: f.cityId.trim(),
    venueName: opt(f.venueName), venueAddress: opt(f.venueAddress), latitude: f.latitude, longitude: f.longitude, isOnline: f.isOnline,
    startsAt: localInputToIso(f.startsAt) ?? undefined, endsAt: localInputToIso(f.endsAt) ?? undefined, timezone: f.timezone.trim(),
    capacity: f.capacity, minAge: f.minAge, maxAge: f.maxAge, interestIds: f.interestIds, preEventMatching: f.preEventMatching, chatEnabled: f.chatEnabled,
    visibility: f.visibility, priceMinor: f.priceMinor || undefined, currency: f.priceMinor ? opt(f.currency.toUpperCase()) : undefined,
  };
}

/** Platform-organized event (`POST admin/events`). The API publishes it immediately, so creation is confirmed. */
export function CreateEventDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [f, setF] = useState<Form>(initial);
  const [confirming, setConfirming] = useState<Body | null>(null);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  function review() {
    const v = validate(adminEventCreate, toPayload(f));
    const extra: Record<string, string> = {};
    if (f.priceMinor && !f.currency.trim()) extra.currency = t('events.form.currencyRequired');
    if (!v.ok || Object.keys(extra).length) {
      const errors = { ...(v.ok ? {} : v.errors), ...extra };
      const interestError = Object.entries(errors).find(([k]) => k.startsWith('interestIds'))?.[1];
      return setFieldErrors({ ...errors, ...(interestError ? { interestIds: interestError } : {}) });
    }
    setFieldErrors({});
    setConfirming(v.data);
  }

  async function create(body: Body) {
    const ok = await send(async () => {
      await api.events.create(body);
      notify(t('events.form.created', { title: body.title }));
    });
    if (ok) {
      onCreated();
      onClose();
    }
  }

  return (
    <>
      <FormDialog title={t('events.form.title')} onClose={onClose} onSubmit={review} busy={busy} error={error} fieldErrors={fieldErrors} size="lg" submitLabel={t('events.form.review')}>
        <TextField label={t('events.form.eventTitle')} value={f.title} onChange={set('title')} error={fieldErrors.title} required maxLength={120} data-autofocus dir="auto" />
        <TextAreaField label={t('events.form.description')} value={f.description} onChange={set('description')} error={fieldErrors.description} required maxLength={5000} rows={4} dir="auto" />
        <div className="grid grid--2">
          <CategoryField value={f.categoryKey} onChange={set('categoryKey')} error={fieldErrors.categoryKey} />
          <SelectField label={t('events.form.visibility')} value={f.visibility} onChange={(v) => set('visibility')(v as Visibility)} options={VISIBILITIES.map((v) => ({ value: v, label: t(`events.visibility.${v}`) }))} error={fieldErrors.visibility} />
        </div>

        <fieldset className="field">
          <legend className="field__label">{t('events.form.schedule')}</legend>
          <div className="grid grid--3">
            <TextField label={t('events.form.startsAt')} type="datetime-local" value={f.startsAt} onChange={set('startsAt')} error={fieldErrors.startsAt} required />
            <TextField label={t('events.form.endsAt')} type="datetime-local" value={f.endsAt} onChange={set('endsAt')} error={fieldErrors.endsAt} required />
            <TextField label={t('events.form.timezone')} hint={t('events.form.timezoneHint')} value={f.timezone} onChange={set('timezone')} error={fieldErrors.timezone} required spellCheck={false} maxLength={64} />
          </div>
          <p className="field__hint">{t('events.form.scheduleHint')}</p>
        </fieldset>

        <fieldset className="field">
          <legend className="field__label">{t('events.form.venue')}</legend>
          <CityField value={f.cityId} onChange={set('cityId')} error={fieldErrors.cityId} />
          <CheckboxField label={t('events.form.isOnline')} checked={f.isOnline} onChange={set('isOnline')} />
          <div className="grid grid--2">
            <TextField label={t('events.form.venueName')} value={f.venueName} onChange={set('venueName')} error={fieldErrors.venueName} maxLength={200} dir="auto" />
            <TextField label={t('events.form.venueAddress')} hint={t('events.form.venueAddressHint')} value={f.venueAddress} onChange={set('venueAddress')} error={fieldErrors.venueAddress} maxLength={400} dir="auto" />
            <NumberField label={t('events.form.latitude')} value={f.latitude} onChange={set('latitude')} error={fieldErrors.latitude} min={-90} max={90} step="any" />
            <NumberField label={t('events.form.longitude')} value={f.longitude} onChange={set('longitude')} error={fieldErrors.longitude} min={-180} max={180} step="any" />
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="field__label">{t('events.form.attendance')}</legend>
          <div className="grid grid--3">
            <NumberField label={t('events.form.capacity')} hint={t('events.form.capacityHint')} value={f.capacity} onChange={set('capacity')} error={fieldErrors.capacity} min={2} max={10000} step={1} />
            <NumberField label={t('events.form.minAge')} value={f.minAge} onChange={set('minAge')} error={fieldErrors.minAge} min={18} max={99} step={1} />
            <NumberField label={t('events.form.maxAge')} value={f.maxAge} onChange={set('maxAge')} error={fieldErrors.maxAge} min={18} max={120} step={1} />
          </div>
          <CheckboxField label={t('events.form.preEventMatching')} hint={t('events.form.preEventMatchingHint')} checked={f.preEventMatching} onChange={set('preEventMatching')} />
          <CheckboxField label={t('events.form.chatEnabled')} checked={f.chatEnabled} onChange={set('chatEnabled')} />
        </fieldset>

        <InterestsField value={f.interestIds} onChange={set('interestIds')} error={fieldErrors.interestIds} />

        <fieldset className="field">
          <legend className="field__label">{t('events.form.pricing')}</legend>
          <div className="grid grid--2">
            <NumberField label={t('events.form.priceMinor')} hint={t('events.form.priceMinorHint')} value={f.priceMinor} onChange={set('priceMinor')} error={fieldErrors.priceMinor} min={0} step={1} />
            <TextField label={t('events.form.currency')} hint={t('events.form.currencyHint')} value={f.currency} onChange={(v) => set('currency')(v.toUpperCase())} error={fieldErrors.currency} maxLength={3} spellCheck={false} />
          </div>
        </fieldset>
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('events.form.confirmTitle', { title: confirming.title })}
          body={
            <>
              <p>{t('events.form.confirmBody')}</p>
              {confirming.priceMinor ? <p>{t('events.form.confirmPrice', { price: formatMoney(confirming.priceMinor, confirming.currency ?? null) })}</p> : null}
            </>
          }
          confirmLabel={t('events.form.publish')}
          onConfirm={async () => {
            // On failure the confirmation closes and the form underneath shows the server error.
            await create(confirming);
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
