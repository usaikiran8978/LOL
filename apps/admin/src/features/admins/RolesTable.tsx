'use client';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n';
import type { AdminRoleRow } from '@/lib/api/modules/admins';
import { roleDescription, roleLabel } from './labels';

interface Props {
  roles: AdminRoleRow[];
  assigned: Map<string, number>;
  canManage: boolean;
  onOpen: (role: AdminRoleRow) => void;
  onDelete: (role: AdminRoleRow) => void;
}

export function RolesTable({ roles, assigned, canManage, onOpen, onDelete }: Props) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{t('admins.rolesPage.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('admins.rolesPage.key')}</th>
            <th scope="col">{t('admins.rolesPage.name')}</th>
            <th scope="col">{t('admins.rolesPage.description')}</th>
            <th scope="col">{t('admins.rolesPage.type')}</th>
            <th scope="col">{t('admins.rolesPage.permissions')}</th>
            <th scope="col">{t('admins.rolesPage.assigned')}</th>
            <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => {
            const count = assigned.get(r.key) ?? 0;
            const editable = canManage && !r.is_system;
            return (
              <tr key={r.key}>
                <td><code>{r.key}</code></td>
                <td>{roleLabel(r, r.key)}</td>
                <td>{roleDescription(r) ?? '—'}</td>
                <td>{r.is_system ? <Badge tone="info">{t('admins.rolesPage.system')}</Badge> : <Badge>{t('admins.rolesPage.custom')}</Badge>}</td>
                <td>{t('admins.rolesPage.permissionsCount', { count: r.permissions.length })}</td>
                <td>{t('admins.rolesPage.assignedCount', { count })}</td>
                <td className="table__actions">
                  {editable ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => onOpen(r)} aria-label={`${t('common.edit')} ${r.key}`}>{t('common.edit')}</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(r)}
                        disabled={count > 0}
                        title={count > 0 ? t('admins.rolesPage.deleteAssigned', { count }) : undefined}
                        aria-label={`${t('admins.rolesPage.delete')} ${r.key}`}
                      >
                        {t('admins.rolesPage.delete')}
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => onOpen(r)} aria-label={`${t('common.view')} ${r.key}`}>{t('common.view')}</Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
