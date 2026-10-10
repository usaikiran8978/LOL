'use client';

import { adminChannelConfig } from '@amora/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { ChannelConfigRow, ProviderChannel } from '@/lib/api/modules/notifications';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { parseList, validate } from '@/lib/forms/validate';
import { KeyValueEditor, rowsFromRecord, rowsToRecord, type KvRow } from './KeyValueEditor';
import { channelLabel } from './shared';

export const PROVIDER_CHANNELS: readonly ProviderChannel[] = ['push', 'email', 'sms'];
// Same rule the controller applies to the `:provider` path segment.
const PROVIDER_RE = /^[a-z0-9_]{2,30}$/;

interface Form {
  channel: ProviderChannel;
  provider: string;
  isEnabled: boolean;
  priority: number | undefined;
  settings: KvRow[];
  countryCodes: string;
  /** Write-only: blank keeps the stored reference. */
  newSecretRef: string;
  clearSecretRef: boolean;
}

function toForm(row: ChannelConfigRow | null): Form {
  return {
    channel: row?.channel ?? 'email',
    provider: row?.provider ?? '',
    isEnabled: row?.is_enabled ?? false,
    priority: row?.priority ?? 0,
    settings: rowsFromRecord(row?.settings),
    countryCodes: (row?.country_codes ?? []).join(', '),
    newSecretRef: '',
    clearSecretRef: false,
  };
}

interface Pending {
  channel: ProviderChannel;
  provider: string;
  body: z.output<typeof adminChannelConfig>;
}

/**
 * Create/edit a delivery provider. The stored secret reference is never displayed: the field is write-only and
 * the existing value is re-sent unchanged unless the admin replaces or clears it (the PUT replaces the row).
 */
export function ChannelDialog({ row, onClose, onSaved }: { row: ChannelConfigRow | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [form, setForm] = useState<Form>(() => toForm(row));
  const [pending, setPending] = useState<Pending | null>(null);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((s) => ({ ...s, [k]: v }));
  const hasSecret = !!row?.secret_ref;

  function review() {
    const provider = form.provider.trim();
    const settings = rowsToRecord(form.settings);
    const errors: Record<string, string> = {};
    if (!row && !PROVIDER_RE.test(provider)) errors.provider = t('notifications.channelsPage.providerInvalid');
    for (const [k, v] of Object.entries(settings.errors)) errors[`settings.${k}`] = v;
    const secretRef = form.clearSecretRef ? null : form.newSecretRef.trim() || row?.secret_ref || null;
    const codes = parseList(form.countryCodes).map((c) => c.toUpperCase());
    const v = validate(adminChannelConfig, { isEnabled: form.isEnabled, priority: form.priority, settings: settings.value, secretRef, countryCodes: codes.length ? codes : null });
    const all = { ...(v.ok ? {} : v.errors), ...errors };
    if (!v.ok || Object.keys(all).length) {
      // Country-code errors arrive per index; surface them on the single list input.
      const countryError = Object.entries(all).find(([k]) => k.startsWith('countryCodes'))?.[1];
      setFieldErrors({ ...all, ...(countryError ? { countryCodes: countryError } : {}), ...(all.secretRef ? { newSecretRef: all.secretRef } : {}) });
      return;
    }
    setFieldErrors({});
    // Provider routing changes affect live delivery immediately, so every save is confirmed.
    setPending({ channel: row?.channel ?? form.channel, provider: row?.provider ?? provider, body: v.data });
  }

  async function apply(p: Pending) {
    const ok = await send(() => api.notifications.upsertChannel(p.channel, p.provider, p.body));
    if (ok) {
      notify(t('notifications.channelsPage.saved', { channel: channelLabel(p.channel), provider: p.provider }));
      onSaved();
      onClose();
    }
  }

  return (
    <>
      <FormDialog
        title={row ? t('notifications.channelsPage.editTitle', { channel: channelLabel(row.channel), provider: row.provider }) : t('notifications.channelsPage.newTitle')}
        onClose={onClose}
        onSubmit={review}
        busy={busy}
        error={error}
        fieldErrors={fieldErrors}
        size="lg"
      >
        {row ? (
          <div className="grid grid--2">
            <ReadOnlyField label={t('notifications.channelsPage.channel')} value={channelLabel(row.channel)} />
            <ReadOnlyField label={t('notifications.channelsPage.provider')} value={row.provider} hint={t('common.immutableHint')} />
          </div>
        ) : (
          <div className="grid grid--2">
            <SelectField label={t('notifications.channelsPage.channel')} value={form.channel} onChange={(v) => set('channel')(v as ProviderChannel)} options={PROVIDER_CHANNELS.map((c) => ({ value: c, label: channelLabel(c) }))} required />
            <TextField label={t('notifications.channelsPage.provider')} hint={t('notifications.channelsPage.providerHint')} value={form.provider} onChange={set('provider')} error={fieldErrors.provider} required spellCheck={false} maxLength={30} data-autofocus />
          </div>
        )}
        <CheckboxField label={t('notifications.channelsPage.enabled')} hint={t('notifications.channelsPage.enabledHint')} checked={form.isEnabled} onChange={set('isEnabled')} />
        <NumberField label={t('notifications.channelsPage.priority')} hint={t('notifications.channelsPage.priorityHint')} value={form.priority} onChange={set('priority')} error={fieldErrors.priority} min={0} max={100} step={1} />
        <TextField label={t('notifications.channelsPage.countries')} hint={t('notifications.channelsPage.countriesHint')} value={form.countryCodes} onChange={set('countryCodes')} error={fieldErrors.countryCodes} spellCheck={false} />
        <KeyValueEditor
          legend={t('notifications.channelsPage.settings')}
          hint={t('notifications.channelsPage.settingsHint')}
          rows={form.settings}
          onChange={set('settings')}
          typed
          errors={Object.fromEntries(Object.entries(fieldErrors).filter(([k]) => k.startsWith('settings.')).map(([k, v]) => [k.slice('settings.'.length), v]))}
        />
        <fieldset className="field">
          <legend className="field__label">{t('notifications.channelsPage.secret')}</legend>
          <p className="field__hint">{hasSecret ? t('notifications.channelsPage.secretSet') : t('notifications.channelsPage.secretUnset')}</p>
          <TextField
            label={hasSecret ? t('notifications.channelsPage.secretReplace') : t('notifications.channelsPage.secretNew')}
            hint={t('notifications.channelsPage.secretHint')}
            type="password"
            autoComplete="new-password"
            value={form.newSecretRef}
            onChange={set('newSecretRef')}
            error={fieldErrors.newSecretRef}
            disabled={form.clearSecretRef}
            maxLength={200}
          />
          {hasSecret ? <CheckboxField label={t('notifications.channelsPage.secretClear')} checked={form.clearSecretRef} onChange={set('clearSecretRef')} /> : null}
        </fieldset>
      </FormDialog>
      {pending ? (
        <ConfirmDialog
          title={t('notifications.channelsPage.confirmTitle', { channel: channelLabel(pending.channel), provider: pending.provider })}
          body={pending.body.isEnabled ? t('notifications.channelsPage.confirmBody') : t('notifications.channelsPage.confirmDisableBody')}
          confirmLabel={t('common.save')}
          tone={pending.body.isEnabled ? 'primary' : 'danger'}
          onConfirm={async () => {
            await apply(pending);
          }}
          onClose={() => setPending(null)}
        />
      ) : null}
    </>
  );
}
