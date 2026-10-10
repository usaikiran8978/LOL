'use client';

import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { AdminRoleRow } from '@/lib/api/modules/admins';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { useResource } from '@/lib/hooks/useResource';
import { AdminsTabs } from './AdminsTabs';
import { RoleDialog, SystemRoleDialog } from './RoleDialog';
import { RolesTable } from './RolesTable';

type Open = { kind: 'new' } | { kind: 'open'; role: AdminRoleRow } | { kind: 'delete'; role: AdminRoleRow } | null;

export function RolesPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="admins.manage" permissions={admin?.permissions ?? []}>
      <RolesPageContent />
    </RequirePermission>
  );
}

function RolesPageContent() {
  const api = useAdminApi();
  const notify = useNotify();
  const canManage = useSession().can('admins.manage');
  const data = useResource(async () => {
    const [roles, admins] = await Promise.all([api.admins.roles(), api.admins.list()]);
    const assigned = new Map<string, number>();
    for (const a of admins) for (const r of a.roles) assigned.set(r.key, (assigned.get(r.key) ?? 0) + 1);
    return { roles, assigned };
  }, [api]);
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  return (
    <>
      <PageHeader
        title={t('admins.rolesPage.title')}
        intro={t('admins.rolesPage.intro')}
        actions={canManage && data.status === 'success' ? <Button onClick={() => setOpen({ kind: 'new' })}>{t('admins.rolesPage.newRole')}</Button> : null}
      />
      <AdminsTabs />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.roles.length === 0 ? <EmptyState message={t('admins.rolesPage.empty')} /> : null}
      {data.status === 'success' && data.data.roles.length > 0 ? (
        <RolesTable
          roles={data.data.roles}
          assigned={data.data.assigned}
          canManage={canManage}
          onOpen={(role) => setOpen({ kind: 'open', role })}
          onDelete={(role) => setOpen({ kind: 'delete', role })}
        />
      ) : null}
      {data.status === 'success' && open?.kind === 'new' ? (
        <RoleDialog role={null} existingKeys={data.data.roles.map((r) => r.key)} onClose={close} onSaved={data.reload} />
      ) : null}
      {data.status === 'success' && open?.kind === 'open' && open.role.is_system ? <SystemRoleDialog role={open.role} onClose={close} /> : null}
      {data.status === 'success' && open?.kind === 'open' && !open.role.is_system ? (
        <RoleDialog role={open.role} existingKeys={[]} onClose={close} onSaved={data.reload} />
      ) : null}
      {open?.kind === 'delete' ? (
        <ConfirmDialog
          title={t('admins.rolesPage.deleteTitle', { key: open.role.key })}
          body={t('admins.rolesPage.deleteBody')}
          confirmLabel={t('admins.rolesPage.delete')}
          tone="danger"
          confirmPhrase={open.role.key}
          onConfirm={async () => {
            await api.admins.deleteRole(open.role.key);
            notify(t('admins.rolesPage.deleted', { key: open.role.key }));
            data.reload();
          }}
          onClose={close}
        />
      ) : null}
    </>
  );
}
