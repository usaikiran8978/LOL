'use client';

import { useState } from 'react';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { AdminOp, AdminUserRow } from '@/lib/api/modules/admins';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { useResource } from '@/lib/hooks/useResource';
import { AdminOpDialog } from './AdminOpDialog';
import { AdminsTable } from './AdminsTable';
import { AdminsTabs } from './AdminsTabs';
import { EditRolesDialog } from './EditRolesDialog';
import { InviteDialog } from './InviteDialog';

type Open = { kind: 'invite' } | { kind: 'roles'; admin: AdminUserRow } | { kind: 'op'; admin: AdminUserRow; op: AdminOp } | null;

export function AdminsPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="admins.manage" permissions={admin?.permissions ?? []}>
      <AdminsPageContent />
    </RequirePermission>
  );
}

function AdminsPageContent() {
  const api = useAdminApi();
  const session = useSession();
  const canManage = session.can('admins.manage');
  const data = useResource(async () => {
    const [admins, roles] = await Promise.all([api.admins.list(), api.admins.roles()]);
    return { admins, roles };
  }, [api]);
  const [open, setOpen] = useState<Open>(null);
  const selfId = session.admin?.id;
  const close = () => setOpen(null);

  return (
    <>
      <PageHeader
        title={t('admins.title')}
        intro={t('admins.intro')}
        actions={canManage && data.status === 'success' ? <Button onClick={() => setOpen({ kind: 'invite' })}>{t('admins.invite.action')}</Button> : null}
      />
      <AdminsTabs />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.admins.length === 0 ? <EmptyState message={t('admins.list.empty')} /> : null}
      {data.status === 'success' && data.data.admins.length > 0 ? (
        <AdminsTable
          admins={data.data.admins}
          roles={data.data.roles}
          selfId={selfId}
          canManage={canManage}
          onEditRoles={(a) => setOpen({ kind: 'roles', admin: a })}
          onOp={(a, op) => setOpen({ kind: 'op', admin: a, op })}
        />
      ) : null}
      {data.status === 'success' && open?.kind === 'invite' ? <InviteDialog roles={data.data.roles} onClose={close} onInvited={data.reload} /> : null}
      {data.status === 'success' && open?.kind === 'roles' ? (
        <EditRolesDialog admin={open.admin} roles={data.data.roles} isSelf={open.admin.id === selfId} onClose={close} onSaved={data.reload} />
      ) : null}
      {open?.kind === 'op' ? <AdminOpDialog admin={open.admin} op={open.op} isSelf={open.admin.id === selfId} onClose={close} onDone={data.reload} /> : null}
    </>
  );
}
