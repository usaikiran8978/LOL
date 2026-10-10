'use client';

import { adminTemplateVersionInput } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { NotificationChannel, NotificationTemplate, TemplateVersionDetail } from '@/lib/api/modules/notifications';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { parseList } from '@/lib/forms/validate';
import { CHANNEL_FIELDS, channelLabel, undeclaredVariables } from './shared';

export interface ContentDraft {
  locale: string;
  channel: NotificationChannel;
  title: string;
  subject: string;
  body: string;
  htmlBody: string;
}

export interface VersionSeed {
  variables: string[];
  contents: ContentDraft[];
  /** Version the draft was copied from (for the dialog title). */
  from?: number;
}

const blankContent = (locale: string, channel: NotificationChannel): ContentDraft => ({ locale, channel, title: '', subject: '', body: '', htmlBody: '' });

export function blankSeed(tpl: NotificationTemplate): VersionSeed {
  return { variables: [], contents: tpl.channels.map((c) => blankContent('en', c)) };
}

export function seedFromVersion(v: TemplateVersionDetail): VersionSeed {
  return {
    from: v.version,
    variables: v.variables,
    contents: v.contents.map((c) => ({ locale: c.locale, channel: c.channel, title: c.title ?? '', subject: c.subject ?? '', body: c.body, htmlBody: c.html_body ?? '' })),
  };
}

/** Request body: fields the channel does not use and blank optional fields are omitted. */
function toPayload(variables: string[], contents: ContentDraft[]) {
  return {
    variables,
    contents: contents.map((c) => {
      const f = CHANNEL_FIELDS[c.channel];
      return {
        locale: c.locale.trim(),
        channel: c.channel,
        ...(f.title && c.title.trim() ? { title: c.title } : {}),
        ...(f.subject && c.subject.trim() ? { subject: c.subject } : {}),
        body: c.body,
        ...(f.html && c.htmlBody.trim() ? { htmlBody: c.htmlBody } : {}),
      };
    }),
  };
}

/** Creates a new draft version (versions are immutable once created; "editing" means drafting a new one). */
export function VersionEditorDialog({ template, seed, onClose, onCreated }: { template: NotificationTemplate; seed: VersionSeed; onClose: () => void; onCreated: (version: number) => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [variablesText, setVariablesText] = useState(seed.variables.join(', '));
  const [contents, setContents] = useState<ContentDraft[]>(seed.contents);
  const [newLocale, setNewLocale] = useState('');
  const [newChannel, setNewChannel] = useState<NotificationChannel>(template.channels[0] ?? 'in_app');
  const [addError, setAddError] = useState<string | undefined>();

  const update = (i: number, patch: Partial<ContentDraft>) => setContents((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const missingEn = template.channels.filter((ch) => !contents.some((c) => c.locale.trim() === 'en' && c.channel === ch));

  function addContent() {
    const loc = newLocale.trim();
    if (!loc) return setAddError(t('validation.required'));
    if (contents.some((c) => c.locale.trim() === loc && c.channel === newChannel)) return setAddError(t('notifications.versions.duplicateContent'));
    setAddError(undefined);
    setContents((cs) => [...cs, blankContent(loc, newChannel)]);
    setNewLocale('');
  }

  async function save() {
    const variables = parseList(variablesText);
    const payload = toPayload(variables, contents);
    const extra: Record<string, string> = {};
    const undeclared = undeclaredVariables(payload.contents.flatMap((c) => [c.title, c.subject, c.body, c.htmlBody]), variables);
    if (undeclared.length) extra.variables = t('notifications.versions.undeclared', { names: undeclared.join(', ') });
    const seen = new Set<string>();
    payload.contents.forEach((c, i) => {
      const id = `${c.locale}|${c.channel}`;
      if (seen.has(id)) extra[`contents.${i}.locale`] = t('notifications.versions.duplicateContent');
      seen.add(id);
    });
    const ok = await submit(adminTemplateVersionInput, payload, async (d) => {
      const created = await api.notifications.createVersion(template.key, d);
      notify(t('notifications.versions.created', { version: created.version }));
      onCreated(created.version);
    }, extra);
    if (ok) onClose();
  }

  return (
    <FormDialog
      title={seed.from ? t('notifications.versions.newFromTitle', { key: template.key, version: seed.from }) : t('notifications.versions.newTitle', { key: template.key })}
      onClose={onClose}
      onSubmit={() => void save()}
      busy={busy}
      error={error}
      fieldErrors={fieldErrors}
      size="lg"
      submitLabel={t('notifications.versions.createDraft')}
    >
      <TextField
        label={t('notifications.versions.variables')}
        hint={t('notifications.versions.variablesHint')}
        value={variablesText}
        onChange={setVariablesText}
        error={fieldErrors.variables}
        spellCheck={false}
        data-autofocus
      />
      {missingEn.length ? <p className="field__hint">{t('notifications.versions.missingEn', { channels: missingEn.map(channelLabel).join(', ') })}</p> : null}
      {fieldErrors.contents ? <p className="field__error" role="alert">{fieldErrors.contents}</p> : null}
      {contents.map((c, i) => {
        const f = CHANNEL_FIELDS[c.channel];
        const tag = `${c.locale} · ${channelLabel(c.channel)}`;
        const err = (name: string) => fieldErrors[`contents.${i}.${name}`];
        return (
          <fieldset key={`${i}-${c.locale}-${c.channel}`} className="card stack">
            <legend className="card__title">{tag}</legend>
            {err('locale') || err('channel') ? <p className="field__error" role="alert">{err('locale') ?? err('channel')}</p> : null}
            {f.title ? <TextField label={t('notifications.versions.fieldTitle', { tag })} value={c.title} onChange={(v) => update(i, { title: v })} error={err('title')} maxLength={200} dir="auto" /> : null}
            {f.subject ? <TextField label={t('notifications.versions.fieldSubject', { tag })} value={c.subject} onChange={(v) => update(i, { subject: v })} error={err('subject')} maxLength={200} dir="auto" /> : null}
            <TextAreaField label={t('notifications.versions.fieldBody', { tag })} value={c.body} onChange={(v) => update(i, { body: v })} error={err('body')} required maxLength={5000} rows={3} dir="auto" />
            {f.html ? <TextAreaField label={t('notifications.versions.fieldHtml', { tag })} hint={t('notifications.versions.htmlHint')} value={c.htmlBody} onChange={(v) => update(i, { htmlBody: v })} error={err('htmlBody')} rows={5} spellCheck={false} /> : null}
            <Button variant="ghost" size="sm" onClick={() => setContents((cs) => cs.filter((_, j) => j !== i))} aria-label={`${t('common.remove')} ${tag}`}>{t('common.remove')}</Button>
          </fieldset>
        );
      })}
      <div className="row row--end">
        <TextField label={t('notifications.versions.newLocale')} hint={t('notifications.versions.localeHint')} value={newLocale} onChange={setNewLocale} error={addError} spellCheck={false} maxLength={10} />
        <SelectField label={t('notifications.versions.newChannel')} value={newChannel} onChange={(v) => setNewChannel(v as NotificationChannel)} options={template.channels.map((c) => ({ value: c, label: channelLabel(c) }))} />
        <Button variant="secondary" onClick={addContent}>{t('notifications.versions.addContent')}</Button>
      </div>
    </FormDialog>
  );
}
