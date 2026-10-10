'use client';

import { useNotify } from '@/components/shell/notice';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { t } from '@/i18n';
import type { AdminOp, AdminUserRow } from '@/lib/api/modules/admins';
import { useAdminApi } from '@/lib/auth/session';

/** Confirms disable / enable / reset-mfa. Reset MFA is security-sensitive, so the email must be typed. */
export function AdminOpDialog({ admin, op, isSelf, onClose, onDone }: { admin: AdminUserRow; op: AdminOp; isSelf: boolean; onClose: () => void; onDone: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const email = admin.email;

  const copy = {
    disable: { title: t('admins.ops.disableTitle', { email }), body: t('admins.ops.disableBody'), label: t('admins.ops.disable'), done: t('admins.ops.disabledDone', { email }) },
    enable: { title: t('admins.ops.enableTitle', { email }), body: t('admins.ops.enableBody'), label: t('admins.ops.enable'), done: t('admins.ops.enabledDone', { email }) },
    'reset-mfa': { title: t('admins.ops.resetMfaTitle', { email }), body: t('admins.ops.resetMfaBody'), label: t('admins.ops.resetMfa'), done: t('admins.ops.resetMfaDone', { email }) },
  }[op];

  return (
    <ConfirmDialog
      title={copy.title}
      body={
        <>
          <p>{copy.body}</p>
          {isSelf && op === 'reset-mfa' ? <p className="alert alert--info">{t('admins.ops.resetMfaSelf')}</p> : null}
        </>
      }
      confirmLabel={copy.label}
      tone={op === 'enable' ? 'primary' : 'danger'}
      confirmPhrase={op === 'reset-mfa' ? email : undefined}
      onConfirm={async () => {
        await api.admins.op(admin.id, op);
        notify(copy.done);
        onDone();
      }}
      onClose={onClose}
    />
  );
}
