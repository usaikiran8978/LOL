'use client';

import { adminAcceptInvite } from '@amora/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/fields';
import { FormError } from '@/components/ui/states';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api/client';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import type { FieldErrors } from '@/lib/forms/validate';

/** Public page behind the invite email link: sets the first password (`/accept-invite?token=…`). */
export function AcceptInviteScreen() {
  const api = useAdminApi();
  const token = useSearchParams().get('token') ?? '';
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  async function save() {
    const extra: FieldErrors = confirm !== password ? { confirm: t('admins.acceptInvite.mismatch') } : {};
    const ok = await submit(adminAcceptInvite, { token, password }, (data) => api.admins.acceptInvite(data), extra);
    if (ok) {
      setDone(true);
      setPassword('');
      setConfirm('');
    }
  }

  const invalidToken = (error instanceof ApiError && error.code === 'TOKEN_INVALID') || !!fieldErrors.token;

  return (
    <main className="centered">
      <div className="card card--narrow stack">
        <h1>{t('admins.acceptInvite.title')}</h1>
        {!token ? (
          <p className="alert alert--error" role="alert">{t('admins.acceptInvite.missingToken')}</p>
        ) : done ? (
          <>
            <p className="alert alert--success" role="status">{t('admins.acceptInvite.done')}</p>
            <Link href="/login" className="btn btn--primary btn--md">{t('admins.acceptInvite.goToLogin')}</Link>
          </>
        ) : (
          <form noValidate className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <p>{t('admins.acceptInvite.intro')}</p>
            {invalidToken ? <FormError message={t('admins.acceptInvite.invalidToken')} /> : null}
            {error && !invalidToken ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
            <TextField
              label={t('admins.acceptInvite.password')}
              hint={t('admins.acceptInvite.passwordHint')}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              error={fieldErrors.password}
              required
              maxLength={128}
              data-autofocus
            />
            <TextField
              label={t('admins.acceptInvite.confirmPassword')}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
              error={fieldErrors.confirm}
              required
              maxLength={128}
            />
            <div className="row">
              <Button type="submit" disabled={busy}>{busy ? t('admins.acceptInvite.submitting') : t('admins.acceptInvite.submit')}</Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
