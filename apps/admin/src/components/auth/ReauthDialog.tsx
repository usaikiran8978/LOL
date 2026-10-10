'use client';

import { t } from '@/i18n';
import type { LoginInput } from '@/lib/auth/session';
import { Dialog } from '../ui/Dialog';
import { LoginForm } from './LoginForm';

/**
 * Re-obtains a CSRF token mid-session. The API has no CSRF refresh endpoint, so a fresh login is the only way;
 * the pending mutation resumes once it succeeds.
 */
export function ReauthDialog({ email, onSubmit, onCancel }: { email: string; onSubmit: (input: LoginInput) => Promise<void>; onCancel: () => void }) {
  return (
    <Dialog title={t('auth.reauthTitle')} onClose={onCancel} size="sm">
      <p>{t('auth.reauthBody')}</p>
      <LoginForm fixedEmail={email || undefined} onSubmit={onSubmit} onCancel={onCancel} submitLabel={t('auth.reauthSubmit')} />
    </Dialog>
  );
}
