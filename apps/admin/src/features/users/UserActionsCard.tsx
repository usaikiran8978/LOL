'use client';

import { adminUserAction, type Permission } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { NumberField, TextAreaField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { apiFieldErrors } from '@/lib/api/errors';
import type { UserActionKind, UserDetail } from '@/lib/api/modules/users';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { validate, type FieldErrors } from '@/lib/forms/validate';
import { GrantDialog } from './GrantDialog';
import { Card } from './UserSections';

type ManagedAction = Exclude<UserActionKind, 'verify' | 'unverify'>;

/** Mirrors the per-action permission map in AdminUsersController.action (safety-admin.controller.ts). */
const ACTIONS: Array<{ action: ManagedAction; permission: Permission; applies: (u: UserDetail) => boolean; danger?: boolean }> = [
  { action: 'suspend', permission: 'users.suspend', applies: (u) => ['pending', 'active', 'restricted'].includes(u.status), danger: true },
  { action: 'unsuspend', permission: 'users.suspend', applies: (u) => u.status === 'suspended' },
  { action: 'ban', permission: 'users.ban', applies: (u) => !['banned', 'deleted'].includes(u.status), danger: true },
  { action: 'unban', permission: 'users.ban', applies: (u) => u.status === 'banned' },
  { action: 'restore', permission: 'users.restore', applies: (u) => u.status === 'deactivated' },
  { action: 'force_logout', permission: 'users.force_logout', applies: (u) => u.status !== 'deleted' },
  { action: 'reset_lockout', permission: 'users.reset_controls', applies: (u) => u.status !== 'deleted' },
];

const nameOf = (u: UserDetail) => u.profile?.display_name ?? u.id;

export function UserActionsCard({ user, onChanged, onGranted }: { user: UserDetail; onChanged: () => void; onGranted: () => void }) {
  const { can } = useSession();
  const [active, setActive] = useState<ManagedAction | null>(null);
  const [granting, setGranting] = useState(false);
  const available = ACTIONS.filter((a) => can(a.permission) && a.applies(user));
  const canGrant = can('billing.grant') && user.status !== 'deleted';
  const def = ACTIONS.find((a) => a.action === active);

  return (
    <Card title={t('users.actions.title')} id="user-actions">
      {available.length === 0 && !canGrant ? <p className="muted">{t('users.actions.none')}</p> : (
        <div className="row">
          {available.map((a) => (
            <Button key={a.action} variant={a.danger ? 'danger' : 'secondary'} onClick={() => setActive(a.action)}>{t(`users.actions.${a.action}`)}</Button>
          ))}
          {canGrant ? <Button variant="secondary" onClick={() => setGranting(true)}>{t('users.actions.grant')}</Button> : null}
        </div>
      )}
      {active && def ? (
        <UserActionDialog user={user} action={active} danger={!!def.danger} onClose={() => setActive(null)} onDone={onChanged} />
      ) : null}
      {granting ? <GrantDialog userId={user.id} name={nameOf(user)} onClose={() => setGranting(false)} onDone={onGranted} /> : null}
    </Card>
  );
}

function UserActionDialog({ user, action, danger, onClose, onDone }: { user: UserDetail; action: ManagedAction; danger: boolean; onClose: () => void; onDone: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const [reasonKey, setReasonKey] = useState('');
  const [note, setNote] = useState('');
  const [hours, setHours] = useState<number | undefined>(undefined);
  const [errors, setErrors] = useState<FieldErrors>({});
  const label = t(`users.actions.${action}`);

  return (
    <ConfirmDialog
      title={t('users.actions.confirmTitle', { action: label, name: nameOf(user) })}
      body={t(`users.actions.bodies.${action}`)}
      confirmLabel={label}
      tone={danger ? 'danger' : 'primary'}
      onClose={onClose}
      onConfirm={async () => {
        const v = validate(adminUserAction, {
          action,
          reasonKey: reasonKey.trim(),
          note: note.trim() || undefined,
          durationHours: action === 'suspend' ? hours : undefined,
        });
        // The API requires a duration for suspensions (the shared schema leaves it optional for other actions).
        const extra: FieldErrors = action === 'suspend' && hours === undefined ? { durationHours: t('validation.required') } : {};
        const all = { ...(v.ok ? {} : v.errors), ...extra };
        if (!v.ok || Object.keys(all).length) {
          setErrors(all);
          return false;
        }
        setErrors({});
        try {
          await api.users.action(user.id, v.data);
        } catch (e) {
          setErrors(apiFieldErrors(e));
          throw e;
        }
        notify(t(`users.actions.done.${action}`));
        onDone();
      }}
    >
      <TextField
        label={t('users.actions.reasonKey')}
        hint={t('users.actions.reasonKeyHint')}
        value={reasonKey}
        onChange={setReasonKey}
        error={errors.reasonKey}
        required
        maxLength={60}
        spellCheck={false}
        autoComplete="off"
      />
      {action === 'suspend' ? (
        <NumberField label={t('users.actions.durationHours')} hint={t('users.actions.durationHint')} value={hours} onChange={setHours} error={errors.durationHours} required min={1} max={8760} step={1} />
      ) : null}
      <TextAreaField label={t('users.actions.note')} hint={t('users.actions.noteHint')} value={note} onChange={setNote} error={errors.note} maxLength={5000} rows={3} />
    </ConfirmDialog>
  );
}
