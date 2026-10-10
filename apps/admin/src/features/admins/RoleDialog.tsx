'use client';

import { adminRoleUpsert, SYSTEM_ROLES } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { ReadOnlyField, TextAreaField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { AdminRoleRow } from '@/lib/api/modules/admins';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import type { FieldErrors } from '@/lib/forms/validate';
import { collapseErrors, escalationMessage, isKnownPermission, permissionLabel, roleDescription, roleLabel } from './labels';
import { PermissionChecklist } from './PermissionChecklist';

const KEY_RE = /^[a-z0-9_]{2,64}$/;

/** Read-only view of a system role. */
export function SystemRoleDialog({ role, onClose }: { role: AdminRoleRow; onClose: () => void }) {
  return (
    <Dialog title={t('admins.rolesPage.viewTitle', { key: role.key })} onClose={onClose} size="lg" footer={<Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>}>
      <p className="alert alert--info">{t('admins.rolesPage.systemReadOnly')}</p>
      <ReadOnlyField label={t('admins.rolesPage.name')} value={roleLabel(role, role.key)} />
      <ReadOnlyField label={t('admins.rolesPage.description')} value={roleDescription(role) ?? ''} />
      <h3>{t('admins.rolesPage.permissions')}</h3>
      <PermissionChecklist selected={role.permissions} onChange={() => {}} held={role.permissions} readOnly />
    </Dialog>
  );
}

/** Create (role null) or edit a custom role. */
export function RoleDialog({ role, existingKeys, onClose, onSaved }: { role: AdminRoleRow | null; existingKeys: string[]; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const held = useSession().admin?.permissions ?? [];
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [key, setKey] = useState('');
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);
  const errors = collapseErrors(fieldErrors);
  const escalation = escalationMessage(error);
  const unheld = permissions.filter((p) => isKnownPermission(p) && !held.includes(p));
  const unknown = permissions.filter((p) => !isKnownPermission(p));

  async function save() {
    const roleKey = role?.key ?? key.trim();
    const extra: FieldErrors = {};
    if (!role) {
      if (!KEY_RE.test(roleKey)) extra.key = roleKey ? t('validation.invalidFormat') : t('validation.required');
      else if (roleKey in SYSTEM_ROLES) extra.key = t('admins.rolesPage.keyReserved');
      else if (existingKeys.includes(roleKey)) extra.key = t('admins.rolesPage.keyTaken');
    }
    const body = { name, description: description.trim() ? description : undefined, permissions: [...permissions].sort() };
    const ok = await submit(adminRoleUpsert, body, (data) => api.admins.upsertRole(roleKey, data), extra);
    if (ok) {
      notify(t('admins.rolesPage.saved', { key: roleKey }));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog
      title={role ? t('admins.rolesPage.editTitle', { key: role.key }) : t('admins.rolesPage.newTitle')}
      onClose={onClose}
      onSubmit={() => void save()}
      busy={busy}
      error={escalation ? null : error}
      fieldErrors={errors}
      size="lg"
    >
      {escalation ? <p className="alert alert--error" role="alert">{escalation}</p> : null}
      {role ? (
        <ReadOnlyField label={t('admins.rolesPage.key')} value={role.key} hint={t('common.immutableHint')} />
      ) : (
        <TextField label={t('admins.rolesPage.key')} hint={t('admins.rolesPage.keyHint')} value={key} onChange={setKey} error={errors.key} required spellCheck={false} autoComplete="off" maxLength={64} data-autofocus />
      )}
      <TextField label={t('admins.rolesPage.name')} value={name} onChange={setName} error={errors.name} required maxLength={80} />
      <TextAreaField label={t('admins.rolesPage.description')} value={description} onChange={setDescription} error={errors.description} rows={2} maxLength={300} />
      {unheld.length ? <p className="alert alert--info">{t('admins.rolesPage.unheldWarning', { permissions: unheld.map(permissionLabel).join(', ') })}</p> : null}
      {unknown.length ? <p className="alert alert--info">{t('admins.rolesPage.unknownPermissions', { permissions: unknown.join(', ') })}</p> : null}
      <h3>{t('admins.rolesPage.permissions')}</h3>
      <PermissionChecklist selected={permissions} onChange={setPermissions} held={held} error={errors.permissions} />
    </FormDialog>
  );
}
