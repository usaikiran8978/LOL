'use client';

import { adminTemplateCreate } from '@amora/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { NotificationCategory, NotificationChannel, NotificationTemplate } from '@/lib/api/modules/notifications';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { validate } from '@/lib/forms/validate';
import { CATEGORIES, CHANNELS, categoryLabel, channelLabel } from './shared';

interface Form {
  key: string;
  category: NotificationCategory;
  channels: NotificationChannel[];
  isTransactional: boolean;
  respectsQuietHours: boolean;
  deepLinkPattern: string;
  isActive: boolean;
}

const EMPTY: Form = { key: '', category: 'system', channels: ['in_app'], isTransactional: true, respectsQuietHours: true, deepLinkPattern: '', isActive: true };

function toForm(tpl: NotificationTemplate): Form {
  return {
    key: tpl.key, category: tpl.category, channels: tpl.channels, isTransactional: tpl.is_transactional, respectsQuietHours: tpl.respects_quiet_hours,
    deepLinkPattern: tpl.deep_link_pattern ?? '', isActive: tpl.is_active,
  };
}

/** Create a template or edit its delivery settings (`PUT admin/notifications/templates/:key`). */
export function TemplateDialog({ template, onClose, onSaved }: { template: NotificationTemplate | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [form, setForm] = useState<Form>(() => (template ? toForm(template) : EMPTY));
  const [confirming, setConfirming] = useState<z.output<typeof adminTemplateCreate> | null>(null);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((s) => ({ ...s, [k]: v }));
  const toggleChannel = (c: NotificationChannel, on: boolean) =>
    setForm((s) => ({ ...s, channels: on ? CHANNELS.filter((x) => x === c || s.channels.includes(x)) : s.channels.filter((x) => x !== c) }));

  async function apply(data: z.output<typeof adminTemplateCreate>) {
    const ok = await send(() => api.notifications.upsertTemplate(data));
    if (ok) {
      notify(template ? t('common.saved') : t('notifications.templates.created', { key: data.key }));
      onSaved();
      onClose();
    }
    return ok;
  }

  function review() {
    const v = validate(adminTemplateCreate, { ...form, key: form.key.trim(), deepLinkPattern: form.deepLinkPattern.trim() || null });
    if (!v.ok) return setFieldErrors(v.errors);
    setFieldErrors({});
    // Settings of an existing template apply to live sends immediately, so edits are confirmed.
    if (template) setConfirming(v.data);
    else void apply(v.data);
  }

  return (
    <>
      <FormDialog
        title={template ? t('notifications.templates.editTitle', { key: template.key }) : t('notifications.templates.newTitle')}
        onClose={onClose}
        onSubmit={review}
        busy={busy}
        error={error}
        fieldErrors={fieldErrors}
        submitLabel={template ? undefined : t('common.create')}
      >
        {template ? (
          <ReadOnlyField label={t('notifications.templates.key')} value={template.key} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('notifications.templates.key')} hint={t('notifications.templates.keyHint')} value={form.key} onChange={set('key')} error={fieldErrors.key} required data-autofocus spellCheck={false} maxLength={64} />
        )}
        <SelectField label={t('notifications.templates.category')} value={form.category} onChange={(v) => set('category')(v as NotificationCategory)} options={CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }))} error={fieldErrors.category} required />
        <fieldset className="field">
          <legend className="field__label">{t('notifications.templates.channels')}</legend>
          {CHANNELS.map((c) => (
            <CheckboxField key={c} label={channelLabel(c)} checked={form.channels.includes(c)} onChange={(on) => toggleChannel(c, on)} />
          ))}
          {fieldErrors.channels ? <p className="field__error" role="alert">{fieldErrors.channels}</p> : null}
        </fieldset>
        <CheckboxField label={t('notifications.templates.transactional')} hint={t('notifications.templates.transactionalHint')} checked={form.isTransactional} onChange={set('isTransactional')} />
        <CheckboxField label={t('notifications.templates.quietHours')} hint={t('notifications.templates.quietHoursHint')} checked={form.respectsQuietHours} onChange={set('respectsQuietHours')} />
        <TextField label={t('notifications.templates.deepLink')} hint={t('notifications.templates.deepLinkHint')} value={form.deepLinkPattern} onChange={set('deepLinkPattern')} error={fieldErrors.deepLinkPattern} maxLength={300} spellCheck={false} />
        <CheckboxField label={t('notifications.templates.active')} hint={t('notifications.templates.activeHint')} checked={form.isActive} onChange={set('isActive')} />
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('notifications.templates.confirmTitle', { key: confirming.key })}
          body={t('notifications.templates.confirmBody')}
          confirmLabel={t('common.save')}
          onConfirm={async () => {
            // On failure the confirmation closes and the settings dialog underneath shows the server error.
            await apply(confirming);
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
