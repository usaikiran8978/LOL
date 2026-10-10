'use client';

import { adminLoginRequest } from '@amora/shared';
import { useState } from 'react';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api/client';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { LoginInput } from '@/lib/auth/session';
import { validate, type FieldErrors } from '@/lib/forms/validate';
import { Button } from '../ui/Button';
import { TextField } from '../ui/fields';
import { FormError } from '../ui/states';

interface Props {
  onSubmit: (input: LoginInput) => Promise<void>;
  /** Re-authentication pins the email to the current admin. */
  fixedEmail?: string;
  submitLabel?: string;
  onCancel?: () => void;
}

/** Email + password, revealing the TOTP field when the server answers MFA_REQUIRED. */
export function LoginForm({ onSubmit, fixedEmail, submitLabel, onCancel }: Props) {
  const [email, setEmail] = useState(fixedEmail ?? '');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const input = { email, password, totp: needsTotp ? totp : undefined };
    const v = validate(adminLoginRequest, input);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(v.data);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MFA_REQUIRED') {
        setNeedsTotp(true);
      } else {
        setError(e);
      }
      // Never keep a rejected password in memory longer than needed.
      if (!(e instanceof ApiError && e.code === 'MFA_REQUIRED')) setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
      {needsTotp && !error ? <p className="alert alert--info" role="status">{t('errors.MFA_REQUIRED')}</p> : null}
      <TextField
        label={t('auth.email')}
        type="email"
        autoComplete="username"
        value={email}
        onChange={setEmail}
        readOnly={!!fixedEmail}
        required
        error={errors.email}
        data-autofocus={!fixedEmail || undefined}
      />
      <TextField
        label={t('auth.password')}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        required
        error={errors.password}
        data-autofocus={fixedEmail ? true : undefined}
      />
      {needsTotp ? (
        <TextField
          label={t('auth.totp')}
          hint={t('auth.totpHint')}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={totp}
          onChange={(v) => setTotp(v.replace(/\D/g, ''))}
          required
          error={errors.totp}
          autoFocus
        />
      ) : null}
      <div className="row">
        {onCancel ? <Button variant="secondary" onClick={onCancel} disabled={busy}>{t('common.cancel')}</Button> : null}
        <Button type="submit" disabled={busy}>{busy ? t('auth.submitting') : (submitLabel ?? t('auth.submit'))}</Button>
      </div>
    </form>
  );
}
