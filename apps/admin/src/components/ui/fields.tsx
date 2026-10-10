'use client';

import { useId, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

/** Label + control + hint + error wiring shared by every input (aria-describedby / aria-invalid). */
export function FieldShell({ label, hint, error, required, children, className }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' field--invalid' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={id} className="field__label">
        {label}
        {required ? <span aria-hidden="true" className="field__required"> *</span> : null}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint ? <p id={hintId} className="field__hint">{hint}</p> : null}
      {error ? <p id={errorId} className="field__error" role="alert">{error}</p> : null}
    </div>
  );
}

type BaseInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'>;

export function TextField({ label, hint, error, value, onChange, required, type = 'text', className, ...rest }: BaseInput & {
  label: string; hint?: string; error?: string; value: string; onChange: (value: string) => void; type?: 'text' | 'email' | 'password' | 'search' | 'datetime-local';
}) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <input
          {...rest}
          id={id}
          type={type}
          className="input"
          value={value}
          required={required}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

/**
 * Number input that keeps the raw text while typing; parent receives `number | undefined` so zod reports
 * empty/invalid input instead of the field silently becoming 0.
 */
export function NumberField({ label, hint, error, value, onChange, required, className, ...rest }: Omit<BaseInput, 'min' | 'max' | 'step'> & {
  label: string; hint?: string; error?: string; value: number | undefined; onChange: (value: number | undefined) => void; min?: number; max?: number; step?: number | 'any';
}) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <input
          {...rest}
          id={id}
          type="number"
          className="input"
          value={value === undefined || Number.isNaN(value) ? '' : value}
          required={required}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )}
    </FieldShell>
  );
}

export function TextAreaField({ label, hint, error, value, onChange, required, className, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & {
  label: string; hint?: string; error?: string; value: string; onChange: (value: string) => void;
}) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <textarea
          {...rest}
          id={id}
          className="input input--textarea"
          value={value}
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

export interface Option {
  value: string;
  label: string;
}

export function SelectField({ label, hint, error, value, onChange, options, required, disabled, placeholder, className }: {
  label: string; hint?: string; error?: string; value: string; onChange: (value: string) => void; options: Option[];
  required?: boolean; disabled?: boolean; placeholder?: string; className?: string;
}) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          className="input"
          value={value}
          required={required}
          disabled={disabled}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export function CheckboxField({ label, hint, checked, onChange, disabled, error }: {
  label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; error?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="field field--checkbox">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
      {hint ? <p id={hintId} className="field__hint">{hint}</p> : null}
      {error ? <p id={errorId} className="field__error" role="alert">{error}</p> : null}
    </div>
  );
}

/** Read-only display of an immutable identifier (key/kind/code on edit). */
export function ReadOnlyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">{label}</label>
      <input id={id} className="input" value={value} readOnly aria-readonly="true" aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint ? <p id={`${id}-hint`} className="field__hint">{hint}</p> : null}
    </div>
  );
}
