'use client';

import { adminUserInvite } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { AdminRoleRow } from '@/lib/api/modules/admins';
import { useAdminApi } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { collapseErrors, escalationMessage, parseCountryScope } from './labels';
import { RolePicker } from './RolePicker';

export function InviteDialog({ roles, onClose, onInvited }: { roles: AdminRoleRow[]; onClose: () => void; onInvited: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleKeys, setRoleKeys] = useState<string[]>([]);
  const [scope, setScope] = useState('');
  const errors = collapseErrors(fieldErrors);
  const escalation = escalationMessage(error);

  async function save() {
    const value = { email: email.trim(), displayName, roleKeys, countryScope: parseCountryScope(scope) };
    const ok = await submit(adminUserInvite, value, async (data) => {
      const res = await api.admins.invite(data);
      notify(t('admins.invite.sent', { email: data.email, expires: formatDateTime(res.inviteExpiresAt) }));
    });
    if (ok) {
      onInvited();
      onClose();
    }
  }

  return (
    <FormDialog title={t('admins.invite.title')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={escalation ? null : error} fieldErrors={errors} submitLabel={t('admins.invite.submit')} size="lg">
      {escalation ? <p className="alert alert--error" role="alert">{escalation}</p> : null}
      <p className="muted">{t('admins.invite.hint')}</p>
      <TextField label={t('admins.invite.email')} type="email" value={email} onChange={setEmail} error={errors.email} required autoComplete="off" data-autofocus />
      <TextField label={t('admins.invite.displayName')} value={displayName} onChange={setDisplayName} error={errors.displayName} required maxLength={80} />
      <RolePicker roles={roles} selected={roleKeys} onChange={setRoleKeys} countryScope={scope} onCountryScopeChange={setScope} errors={errors} />
    </FormDialog>
  );
}
