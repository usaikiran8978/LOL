'use client';

import { adminMfaConfirm } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/fields';
import { FormError } from '@/components/ui/states';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api/client';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { MfaSetup } from '@/lib/api/modules/admins';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { validate } from '@/lib/forms/validate';

const isCode = (e: unknown, code: string) => e instanceof ApiError && e.code === code;

function CodeField({ value, onChange, error, autoFocus }: { value: string; onChange: (v: string) => void; error?: string; autoFocus?: boolean }) {
  return (
    <TextField
      label={t('admins.account.code')}
      hint={t('admins.account.codeHint')}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={6}
      value={value}
      onChange={(v) => onChange(v.replace(/\D/g, ''))}
      error={error}
      required
      data-autofocus={autoFocus || undefined}
    />
  );
}

/** Enrolment: start → show the secret / otpauth link once → confirm with a current code. */
export function MfaSetupPanel({ onChanged }: { onChanged: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const start = useFormSubmit();
  const confirm = useFormSubmit();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');

  async function begin() {
    await start.send(async () => {
      try {
        setSetup(await api.admins.mfaSetup());
      } catch (e) {
        // Already enabled (e.g. in another tab): refresh the page state instead of showing an error.
        if (isCode(e, 'CONFLICT')) return onChanged();
        throw e;
      }
    });
  }

  async function finish() {
    const ok = await confirm.submit(adminMfaConfirm, { code }, (data) => api.admins.mfaConfirm(data));
    if (ok) {
      setSetup(null);
      notify(t('admins.account.enabledDone'));
      onChanged();
    }
  }

  if (!setup) {
    return (
      <div className="stack">
        {start.error ? <FormError message={errorMessage(start.error)} requestId={requestIdOf(start.error)} /> : null}
        <Button onClick={() => void begin()} disabled={start.busy}>{start.busy ? t('admins.account.settingUp') : t('admins.account.setup')}</Button>
      </div>
    );
  }

  const wrong = isCode(confirm.error, 'OTP_INVALID');
  const stale = isCode(confirm.error, 'CONFLICT');
  return (
    <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void finish(); }}>
      <p>{t('admins.account.step1')}</p>
      <p className="alert alert--info">{t('admins.account.secretWarning')}</p>
      <div className="field">
        <span className="field__label" id="mfa-secret-label">{t('admins.account.secret')}</span>
        <code className="code" aria-labelledby="mfa-secret-label">{setup.secret}</code>
      </div>
      <div className="field">
        <span className="field__label" id="mfa-otpauth-label">{t('admins.account.otpauth')}</span>
        <code className="code pre-wrap" aria-labelledby="mfa-otpauth-label">{setup.otpauthUrl}</code>
        <a href={setup.otpauthUrl}>{t('admins.account.openInApp')}</a>
      </div>
      <p>{t('admins.account.step2')}</p>
      {confirm.error && !wrong && !stale ? <FormError message={errorMessage(confirm.error)} requestId={requestIdOf(confirm.error)} /> : null}
      {stale ? <FormError message={t('admins.account.notPending')} /> : null}
      <CodeField value={code} onChange={setCode} error={confirm.fieldErrors.code ?? (wrong ? t('admins.account.wrongCode') : undefined)} autoFocus />
      <div className="row">
        <Button type="submit" disabled={confirm.busy}>{confirm.busy ? t('common.saving') : t('admins.account.confirm')}</Button>
        <Button variant="secondary" onClick={() => { setSetup(null); setCode(''); }} disabled={confirm.busy}>{t('admins.account.cancelSetup')}</Button>
      </div>
    </form>
  );
}

/** Turning MFA off requires a current code (the API verifies it). */
export function MfaDisableButton({ onChanged }: { onChanged: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();

  function close() {
    setOpen(false);
    setCode('');
    setCodeError(undefined);
  }

  async function disable(): Promise<boolean> {
    const v = validate(adminMfaConfirm, { code });
    if (!v.ok) {
      setCodeError(v.errors.code);
      return false;
    }
    setCodeError(undefined);
    try {
      await api.admins.mfaDisable(v.data);
    } catch (e) {
      if (isCode(e, 'OTP_INVALID')) {
        setCodeError(t('admins.account.wrongCode'));
        return false;
      }
      throw e;
    }
    notify(t('admins.account.disabledDone'));
    onChanged();
    return true;
  }

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>{t('admins.account.disable')}</Button>
      {open ? (
        <ConfirmDialog title={t('admins.account.disableTitle')} body={t('admins.account.disableBody')} confirmLabel={t('admins.account.disable')} tone="danger" onConfirm={disable} onClose={close}>
          <CodeField value={code} onChange={setCode} error={codeError} />
        </ConfirmDialog>
      ) : null}
    </>
  );
}
