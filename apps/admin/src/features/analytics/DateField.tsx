'use client';

import { FieldShell } from '@/components/ui/fields';

/** `<input type="date">` (YYYY-MM-DD); the shared TextField does not offer the date type. */
export function DateField({ label, hint, error, value, onChange, required, min, max }: {
  label: string; hint?: string; error?: string; value: string; onChange: (value: string) => void; required?: boolean; min?: string; max?: string;
}) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          type="date"
          className="input"
          value={value}
          min={min}
          max={max}
          required={required}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}
