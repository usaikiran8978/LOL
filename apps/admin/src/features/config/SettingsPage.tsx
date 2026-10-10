'use client';

import { adminSettingUpsert } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { SettingRow, SettingValueType } from '@/lib/api/admin-api';
import { useAdminApi } from '@/lib/auth/session';
import { parseJsonText, type FieldErrors } from '@/lib/forms/validate';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';

const TYPES: SettingValueType[] = ['string', 'number', 'boolean', 'json', 'duration'];
const KEY_RE = /^[a-z0-9_.]{2,100}$/;

export function formatSettingValue(s: SettingRow): string {
  if (s.is_secret) return t('settings.secretHidden');
  if (s.value === null || s.value === undefined) return '—';
  return typeof s.value === 'string' ? s.value : JSON.stringify(s.value);
}

export function SettingsPage() {
  const api = useAdminApi();
  const settings = useResource(() => api.config.settings(), [api]);
  const [editing, setEditing] = useState<SettingRow | 'new' | null>(null);

  return (
    <>
      <PageHeader title={t('settings.title')} intro={t('settings.intro')} actions={<Button onClick={() => setEditing('new')}>{t('settings.newSetting')}</Button>} />
      {settings.status === 'loading' ? <LoadingState /> : null}
      {settings.status === 'error' ? <ErrorState error={settings.error} onRetry={settings.reload} /> : null}
      {settings.status === 'success' && settings.data.length === 0 ? <EmptyState message={t('settings.empty')} /> : null}
      {settings.status === 'success' && settings.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('settings.key')}</th>
                <th scope="col">{t('settings.valueType')}</th>
                <th scope="col">{t('settings.value')}</th>
                <th scope="col">{t('common.description')}</th>
                <th scope="col">{t('settings.updatedAt')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {settings.data.map((s) => (
                <tr key={s.key}>
                  <td><code>{s.key}</code>{s.is_secret ? <> <span className="badge">{t('settings.secret')}</span></> : null}</td>
                  <td>{t(`settings.types.${s.value_type}`)}</td>
                  <td><code>{formatSettingValue(s)}</code></td>
                  <td>{s.description ?? '—'}</td>
                  <td><time dateTime={s.updated_at}>{new Date(s.updated_at).toLocaleString()}</time></td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)} aria-label={`${t('common.edit')} ${s.key}`}>{t('common.edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <SettingDialog setting={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={settings.reload} /> : null}
    </>
  );
}

function initialText(s: SettingRow | null): string {
  if (!s || s.is_secret || s.value === null || s.value === undefined) return '';
  if (s.value_type === 'json') return JSON.stringify(s.value, null, 2);
  return typeof s.value === 'string' ? s.value : '';
}

function SettingDialog({ setting, onClose, onSaved }: { setting: SettingRow | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const secret = setting?.is_secret ?? false;
  const [key, setKey] = useState(setting?.key ?? '');
  const [valueType, setValueType] = useState<SettingValueType>(setting?.value_type ?? 'string');
  const [description, setDescription] = useState(setting?.description ?? '');
  const [text, setText] = useState(() => initialText(setting));
  const [num, setNum] = useState<number | undefined>(typeof setting?.value === 'number' && !secret ? setting.value : undefined);
  const [bool, setBool] = useState(setting?.value === true);

  function currentValue(): { value: unknown; error?: string } {
    // Secrets are entered as text (masked) whatever their type, then coerced to the stored type.
    if (secret) {
      if (text === '') return { value: undefined, error: t('validation.required') };
      if (valueType === 'string') return { value: text };
      if (valueType === 'boolean') return text === 'true' || text === 'false' ? { value: text === 'true' } : { value: undefined, error: t('validation.invalid') };
      if (valueType === 'json') {
        const parsed = parseJsonText(text);
        return parsed.ok ? { value: parsed.value } : { value: undefined, error: t('validation.invalidJson') };
      }
      const n = Number(text);
      return Number.isFinite(n) ? { value: n } : { value: undefined, error: t('validation.notNumber') };
    }
    switch (valueType) {
      case 'string':
        return { value: text };
      case 'number':
      case 'duration':
        return num === undefined || !Number.isFinite(num) ? { value: undefined, error: t('validation.notNumber') } : { value: num };
      case 'boolean':
        return { value: bool };
      case 'json': {
        if (!text.trim()) return { value: undefined, error: t('validation.required') };
        const parsed = parseJsonText(text);
        return parsed.ok ? { value: parsed.value } : { value: undefined, error: t('validation.invalidJson') };
      }
    }
  }

  async function save() {
    const finalKey = setting?.key ?? key.trim();
    const v = currentValue();
    const extra: FieldErrors = {};
    if (v.error) extra.value = v.error;
    if (!KEY_RE.test(finalKey)) extra.key = t('settings.keyHint');
    const ok = await submit(adminSettingUpsert, { value: v.value, valueType, description: description.trim() || undefined }, (d) => api.config.upsertSetting(finalKey, d), extra);
    if (ok) {
      notify(setting ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    }
  }

  const valueError = fieldErrors.value;
  let valueEditor;
  if (secret) {
    valueEditor = (
      <TextField
        label={t('settings.secretInput')}
        hint={t('settings.secretHint')}
        type="password"
        autoComplete="new-password"
        value={text}
        onChange={setText}
        error={valueError}
        required
      />
    );
  } else if (valueType === 'boolean') {
    valueEditor = <CheckboxField label={t('settings.trueLabel')} checked={bool} onChange={setBool} error={valueError} />;
  } else if (valueType === 'number' || valueType === 'duration') {
    valueEditor = (
      <NumberField
        label={t('settings.value')}
        hint={valueType === 'duration' ? t('settings.durationHint') : undefined}
        step="any"
        value={num}
        onChange={setNum}
        error={valueError}
        required
      />
    );
  } else if (valueType === 'json') {
    valueEditor = <TextAreaField label={t('settings.value')} value={text} onChange={setText} rows={8} error={valueError} required spellCheck={false} className="code-input" />;
  } else {
    valueEditor = <TextAreaField label={t('settings.value')} value={text} onChange={setText} rows={2} error={valueError} />;
  }

  return (
    <FormDialog title={setting ? t('settings.editSetting', { key: setting.key }) : t('settings.newSetting')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors}>
      {setting ? (
        <ReadOnlyField label={t('settings.key')} value={setting.key} hint={t('common.immutableHint')} />
      ) : (
        <TextField label={t('settings.key')} hint={t('settings.keyHint')} value={key} onChange={setKey} error={fieldErrors.key} required data-autofocus spellCheck={false} />
      )}
      {/* Secret settings keep their type: the value is write-only and the stored type is what the server reads. */}
      {secret ? (
        <ReadOnlyField label={t('settings.valueType')} value={t(`settings.types.${valueType}`)} />
      ) : (
        <SelectField label={t('settings.valueType')} value={valueType} onChange={(v) => setValueType(v as SettingValueType)} options={TYPES.map((ty) => ({ value: ty, label: t(`settings.types.${ty}`) }))} error={fieldErrors.valueType} />
      )}
      {valueEditor}
      <TextAreaField label={t('common.description')} value={description} onChange={setDescription} error={fieldErrors.description} rows={2} maxLength={500} />
    </FormDialog>
  );
}
