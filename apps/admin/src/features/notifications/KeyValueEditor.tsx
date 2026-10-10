'use client';

import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';

export type KvType = 'string' | 'number' | 'boolean';

export interface KvRow {
  key: string;
  value: string;
  type: KvType;
}

export const emptyRow = (): KvRow => ({ key: '', value: '', type: 'string' });

export function rowsFromRecord(rec: Record<string, string | number | boolean> | null | undefined): KvRow[] {
  return Object.entries(rec ?? {}).map(([key, v]) => ({ key, value: String(v), type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string' }));
}

/**
 * Converts rows to a record. Returns per-row errors (keyed `${index}.key` / `${index}.value`) for blank or
 * duplicate keys and values that do not match their declared type. Rows with neither key nor value are ignored.
 */
export function rowsToRecord(rows: KvRow[]): { value: Record<string, string | number | boolean>; errors: Record<string, string> } {
  const value: Record<string, string | number | boolean> = {};
  const errors: Record<string, string> = {};
  rows.forEach((r, i) => {
    const key = r.key.trim();
    if (!key && !r.value.trim()) return;
    if (!key) {
      errors[`${i}.key`] = t('validation.required');
      return;
    }
    if (key in value) {
      errors[`${i}.key`] = t('notifications.kv.duplicateKey');
      return;
    }
    if (r.type === 'number') {
      const n = Number(r.value);
      if (r.value.trim() === '' || Number.isNaN(n)) errors[`${i}.value`] = t('validation.notNumber');
      else value[key] = n;
    } else if (r.type === 'boolean') {
      value[key] = r.value === 'true';
    } else {
      value[key] = r.value;
    }
  });
  return { value, errors };
}

/** Editable list of key/value pairs (template variables, provider settings). `typed` adds a value-type selector. */
export function KeyValueEditor({ legend, rows, onChange, typed, errors = {}, hint }: {
  legend: string; rows: KvRow[]; onChange: (rows: KvRow[]) => void; typed?: boolean; errors?: Record<string, string>; hint?: string;
}) {
  const update = (i: number, patch: Partial<KvRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="field">
      <legend className="field__label">{legend}</legend>
      {hint ? <p className="field__hint">{hint}</p> : null}
      {rows.length === 0 ? <p className="muted">{t('notifications.kv.none')}</p> : null}
      {rows.map((r, i) => (
        <div key={i} className="row row--end">
          <TextField label={t('notifications.kv.key', { n: i + 1 })} value={r.key} onChange={(v) => update(i, { key: v })} error={errors[`${i}.key`]} spellCheck={false} maxLength={64} />
          {typed ? (
            <SelectField
              label={t('notifications.kv.type', { n: i + 1 })}
              value={r.type}
              onChange={(v) => update(i, { type: v as KvType, value: v === 'boolean' ? 'false' : r.value })}
              options={(['string', 'number', 'boolean'] as const).map((x) => ({ value: x, label: t(`notifications.kv.types.${x}`) }))}
            />
          ) : null}
          {r.type === 'boolean' ? (
            <SelectField
              label={t('notifications.kv.value', { n: i + 1 })}
              value={r.value === 'true' ? 'true' : 'false'}
              onChange={(v) => update(i, { value: v })}
              options={[{ value: 'true', label: t('common.yes') }, { value: 'false', label: t('common.no') }]}
            />
          ) : (
            <TextField label={t('notifications.kv.value', { n: i + 1 })} value={r.value} onChange={(v) => update(i, { value: v })} error={errors[`${i}.value`]} maxLength={1000} />
          )}
          <Button variant="ghost" size="sm" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={t('notifications.kv.removeRow', { n: i + 1 })}>{t('common.remove')}</Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={() => onChange([...rows, emptyRow()])}>{t('notifications.kv.addRow')}</Button>
    </fieldset>
  );
}
