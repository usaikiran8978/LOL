'use client';

import { adminEventUpdate } from '@amora/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import type { AdminEventDetail, AdminEventRow, EventVisibility } from '@/lib/api/modules/events';
import { useAdminApi } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { isoToLocalInput, localInputToIso, validate } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';
import { CityField } from './EventPickers';

const VISIBILITIES: EventVisibility[] = ['public', 'unlisted', 'premium_only'];
type Body = z.output<typeof adminEventUpdate>;

export interface EditForm {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  cityId: string;
  venueName: string;
  venueAddress: string;
  latitude: number | undefined;
  longitude: number | undefined;
  isOnline: boolean;
  capacity: number | undefined;
  minAge: number | undefined;
  maxAge: number | undefined;
  visibility: EventVisibility;
  preEventMatching: boolean;
  chatEnabled: boolean;
  priceMinor: number | undefined;
  currency: string;
}

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? undefined : Number(v));

/** Every field prefilled from `GET admin/events/:id`. */
export function formFromDetail(e: AdminEventDetail): EditForm {
  return {
    title: e.title, description: e.description, startsAt: isoToLocalInput(e.starts_at), endsAt: isoToLocalInput(e.ends_at), timezone: e.timezone, cityId: e.city_id,
    venueName: e.venue_name ?? '', venueAddress: e.venue_address ?? '', latitude: num(e.latitude), longitude: num(e.longitude), isOnline: e.is_online,
    capacity: e.capacity ?? undefined, minAge: e.min_age ?? undefined, maxAge: e.max_age ?? undefined, visibility: e.visibility,
    preEventMatching: e.pre_event_matching, chatEnabled: e.chat_enabled, priceMinor: num(e.price_minor) ?? 0, currency: e.currency ?? '',
  };
}

/** Only fields that differ from the loaded values; emptied optional fields are sent as null (cleared). */
export function changedFields(f: EditForm, start: EditForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const text = (k: 'title' | 'description' | 'timezone' | 'cityId') => { if (f[k].trim() !== start[k].trim()) out[k] = f[k].trim(); };
  const clearable = (k: 'venueName' | 'venueAddress') => { if (f[k].trim() !== start[k].trim()) out[k] = f[k].trim() || null; };
  const nullableNum = (k: 'latitude' | 'longitude' | 'capacity' | 'minAge' | 'maxAge') => { if (f[k] !== start[k]) out[k] = f[k] ?? null; };
  const flag = (k: 'isOnline' | 'preEventMatching' | 'chatEnabled') => { if (f[k] !== start[k]) out[k] = f[k]; };
  text('title'); text('description'); text('timezone'); text('cityId');
  if (f.startsAt !== start.startsAt) out.startsAt = localInputToIso(f.startsAt) ?? f.startsAt;
  if (f.endsAt !== start.endsAt) out.endsAt = localInputToIso(f.endsAt) ?? f.endsAt;
  clearable('venueName'); clearable('venueAddress');
  nullableNum('latitude'); nullableNum('longitude'); nullableNum('capacity'); nullableNum('minAge'); nullableNum('maxAge');
  flag('isOnline'); flag('preEventMatching'); flag('chatEnabled');
  if (f.visibility !== start.visibility) out.visibility = f.visibility;
  if ((f.priceMinor ?? 0) !== (start.priceMinor ?? 0)) out.priceMinor = f.priceMinor ?? 0;
  const currency = f.currency.trim().toUpperCase();
  if (currency && currency !== start.currency) out.currency = currency;
  return out;
}

/** Mirrors EventsService.adminUpdate: these changes notify registered / waitlisted people of a published event. */
const MOVES = ['startsAt', 'endsAt', 'venueName', 'venueAddress', 'cityId', 'isOnline', 'latitude', 'longitude'];
export const notifiesAttendees = (status: string, body: Record<string, unknown>) => status === 'published' && MOVES.some((k) => body[k] !== undefined);

/** `PUT admin/events/:id` — loads the full event first so every field is prefilled. Not offered for cancelled / completed events. */
export function EditEventDialog({ event, onClose, onSaved }: { event: AdminEventRow; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const detail = useResource(() => api.events.detail(event.id), [api, event.id]);
  if (detail.status !== 'success') {
    return (
      <Dialog title={t('events.edit.title', { title: event.title })} onClose={onClose} size="lg">
        {detail.status === 'loading' ? <LoadingState /> : <ErrorState error={detail.error} onRetry={detail.reload} />}
      </Dialog>
    );
  }
  return <EditForm event={event} detail={detail.data} onClose={onClose} onSaved={onSaved} />;
}

function EditForm({ event, detail, onClose, onSaved }: { event: AdminEventRow; detail: AdminEventDetail; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [start] = useState<EditForm>(() => formFromDetail(detail));
  const [f, setF] = useState<EditForm>(start);
  const [changeNote, setChangeNote] = useState('');
  const [nothing, setNothing] = useState(false);
  const [confirming, setConfirming] = useState<Body | null>(null);
  const set = <K extends keyof EditForm>(k: K) => (v: EditForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const people = event.registered_count + event.waitlist_count;

  async function save(body: Body) {
    const ok = await send(async () => {
      await api.events.update(event.id, body);
      notify(t('events.edit.saved', { title: body.title ?? detail.title }));
    });
    if (ok) {
      onSaved();
      onClose();
    }
  }

  function review() {
    const changes = changedFields(f, start);
    if (Object.keys(changes).length === 0) {
      setFieldErrors({});
      return setNothing(true);
    }
    setNothing(false);
    const v = validate(adminEventUpdate, { ...changes, changeNote: changeNote.trim() || undefined });
    const extra: Record<string, string> = {};
    if ((f.priceMinor ?? 0) > 0 && !f.currency.trim()) extra.currency = t('events.form.currencyRequired');
    if (!v.ok || Object.keys(extra).length) return setFieldErrors({ ...(v.ok ? {} : v.errors), ...extra });
    setFieldErrors({});
    if (notifiesAttendees(detail.status, v.data)) setConfirming(v.data);
    else void save(v.data);
  }

  return (
    <>
      <FormDialog title={t('events.edit.title', { title: event.title })} onClose={onClose} onSubmit={review} busy={busy} error={error} fieldErrors={fieldErrors} size="lg" submitLabel={t('common.save')}>
        <p className="alert alert--info" role="note">{t('events.edit.notifyNote')}</p>
        {nothing ? <p className="alert alert--error" role="alert">{t('events.edit.nothingChanged')}</p> : null}
        <TextField label={t('events.form.eventTitle')} value={f.title} onChange={set('title')} error={fieldErrors.title} required maxLength={120} data-autofocus dir="auto" />
        <TextAreaField label={t('events.form.description')} value={f.description} onChange={set('description')} error={fieldErrors.description} required maxLength={5000} rows={4} dir="auto" />
        <SelectField label={t('events.form.visibility')} value={f.visibility} onChange={(v) => set('visibility')(v as EventVisibility)} options={VISIBILITIES.map((v) => ({ value: v, label: t(`events.visibility.${v}`) }))} error={fieldErrors.visibility} />

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
          <p className="field__hint">{t('events.edit.currentCity', { city: `${detail.city}, ${detail.country_code}` })}</p>
          <CityField value={f.cityId} onChange={set('cityId')} error={fieldErrors.cityId} />
          <CheckboxField label={t('events.form.isOnline')} checked={f.isOnline} onChange={set('isOnline')} />
          <div className="grid grid--2">
            <TextField label={t('events.form.venueName')} hint={t('events.edit.clearHint')} value={f.venueName} onChange={set('venueName')} error={fieldErrors.venueName} maxLength={200} dir="auto" />
            <TextField label={t('events.form.venueAddress')} hint={t('events.form.venueAddressHint')} value={f.venueAddress} onChange={set('venueAddress')} error={fieldErrors.venueAddress} maxLength={400} dir="auto" />
            <NumberField label={t('events.form.latitude')} hint={t('events.edit.clearHint')} value={f.latitude} onChange={set('latitude')} error={fieldErrors.latitude} min={-90} max={90} step="any" />
            <NumberField label={t('events.form.longitude')} hint={t('events.edit.clearHint')} value={f.longitude} onChange={set('longitude')} error={fieldErrors.longitude} min={-180} max={180} step="any" />
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="field__label">{t('events.form.attendance')}</legend>
          <div className="grid grid--3">
            <NumberField
              label={t('events.form.capacity')}
              hint={t('events.edit.capacityHint', { count: formatNumber(event.registered_count) })}
              value={f.capacity}
              onChange={set('capacity')}
              error={fieldErrors.capacity}
              min={Math.max(2, event.registered_count)}
              max={10000}
              step={1}
            />
            <NumberField label={t('events.form.minAge')} hint={t('events.edit.clearHint')} value={f.minAge} onChange={set('minAge')} error={fieldErrors.minAge} min={18} max={99} step={1} />
            <NumberField label={t('events.form.maxAge')} hint={t('events.edit.clearHint')} value={f.maxAge} onChange={set('maxAge')} error={fieldErrors.maxAge} min={18} max={120} step={1} />
          </div>
          <CheckboxField label={t('events.form.preEventMatching')} hint={t('events.form.preEventMatchingHint')} checked={f.preEventMatching} onChange={set('preEventMatching')} />
          <CheckboxField label={t('events.form.chatEnabled')} checked={f.chatEnabled} onChange={set('chatEnabled')} />
        </fieldset>

        <fieldset className="field">
          <legend className="field__label">{t('events.form.pricing')}</legend>
          <div className="grid grid--2">
            <NumberField label={t('events.form.priceMinor')} hint={t('events.form.priceMinorHint')} value={f.priceMinor} onChange={set('priceMinor')} error={fieldErrors.priceMinor} min={0} step={1} />
            <TextField label={t('events.form.currency')} hint={t('events.form.currencyHint')} value={f.currency} onChange={(v) => set('currency')(v.toUpperCase())} error={fieldErrors.currency} maxLength={3} spellCheck={false} />
          </div>
        </fieldset>

        <TextAreaField label={t('events.edit.changeNote')} hint={t('events.edit.changeNoteHint')} value={changeNote} onChange={setChangeNote} error={fieldErrors.changeNote} maxLength={500} rows={2} dir="auto" />
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('events.edit.confirmTitle', { title: confirming.title ?? detail.title })}
          body={t('events.edit.confirmBody', { count: formatNumber(people) })}
          confirmLabel={t('events.edit.confirmAction')}
          onConfirm={async () => {
            // On failure the confirmation closes and the form underneath shows the server error.
            await save(confirming);
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
