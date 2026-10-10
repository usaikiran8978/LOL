'use client';

import { adminUserRolesUpdate } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { FormDialog } from '@/components/ui/FormDialog';
import { t } from '@/i18n';
import type { AdminRoleRow, AdminUserRow } from '@/lib/api/modules/admins';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { collapseErrors, escalationMessage, parseCountryScope } from './labels';
import { RolePicker } from './RolePicker';

/** The API stores one country scope per grant but applies the same scope to all roles of an admin. */
function initialScope(admin: AdminUserRow): string {
  const scoped = admin.roles.find((r) => r.countryScope && r.countryScope.length);
  return scoped?.countryScope?.join(', ') ?? '';
}

export function EditRolesDialog({ admin, roles, isSelf, onClose, onSaved }: {
  admin: AdminUserRow; roles: AdminRoleRow[]; isSelf: boolean; onClose: () => void; onSaved: () => void;
}) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [roleKeys, setRoleKeys] = useState<string[]>(() => admin.roles.map((r) => r.key));
  const [scope, setScope] = useState(() => initialScope(admin));
  const errors = collapseErrors(fieldErrors);
  const escalation = escalationMessage(error);

  async function save() {
    const ok = await submit(adminUserRolesUpdate, { roleKeys, countryScope: parseCountryScope(scope) }, (data) => api.admins.updateRoles(admin.id, data));
    if (ok) {
      notify(t('admins.editRoles.saved', { email: admin.email }));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={t('admins.editRoles.title', { email: admin.email })} onClose={onClose} onSubmit={() => void save()} busy={busy} error={escalation ? null : error} fieldErrors={errors} size="lg">
      {escalation ? <p className="alert alert--error" role="alert">{escalation}</p> : null}
      <p className={isSelf ? 'alert alert--info' : 'muted'}>{isSelf ? t('admins.editRoles.selfNote') : t('admins.editRoles.sessionsNote')}</p>
      <RolePicker roles={roles} selected={roleKeys} onChange={setRoleKeys} countryScope={scope} onCountryScopeChange={setScope} errors={errors} />
    </FormDialog>
  );
}
