'use client';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n';
import type { AdminOp, AdminRoleRow, AdminUserRow } from '@/lib/api/modules/admins';
import { formatDateTime } from '@/lib/format';
import { roleLabel, statusLabel, statusTone } from './labels';

interface Props {
  admins: AdminUserRow[];
  roles: AdminRoleRow[];
  selfId: string | undefined;
  canManage: boolean;
  onEditRoles: (admin: AdminUserRow) => void;
  onOp: (admin: AdminUserRow, op: AdminOp) => void;
}

export function AdminsTable({ admins, roles, selfId, canManage, onEditRoles, onOp }: Props) {
  const byKey = new Map(roles.map((r) => [r.key, r]));
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{t('admins.list.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('admins.list.email')}</th>
            <th scope="col">{t('admins.list.name')}</th>
            <th scope="col">{t('admins.list.roles')}</th>
            <th scope="col">{t('admins.list.mfa')}</th>
            <th scope="col">{t('admins.list.status')}</th>
            <th scope="col">{t('admins.list.lastLogin')}</th>
            {canManage ? <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {admins.map((a) => {
            const self = a.id === selfId;
            return (
              <tr key={a.id} className={a.status === 'disabled' ? 'is-danger' : undefined}>
                <td>
                  {a.email}
                  {self ? <> <Badge tone="info">{t('admins.list.you')}</Badge></> : null}
                </td>
                <td>{a.display_name}</td>
                <td>
                  {a.roles.length === 0 ? <span className="muted">{t('admins.list.noRoles')}</span> : (
                    <div className="checkbox-group">
                      {a.roles.map((r) => (
                        <span key={r.key}>
                          <Badge>{roleLabel(byKey.get(r.key), r.key)}</Badge>
                          {r.countryScope?.length ? <span className="muted"> {t('admins.list.scopedTo', { countries: r.countryScope.join(', ') })}</span> : null}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td>{a.mfaEnabled ? <Badge tone="success">{t('admins.list.mfaOn')}</Badge> : <Badge tone="warning">{t('admins.list.mfaOff')}</Badge>}</td>
                <td><Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge></td>
                <td>{a.last_login_at ? formatDateTime(a.last_login_at) : <span className="muted">{t('admins.list.never')}</span>}</td>
                {canManage ? (
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => onEditRoles(a)} aria-label={`${t('admins.editRoles.action')} ${a.email}`}>{t('admins.editRoles.action')}</Button>
                    {a.mfaEnabled ? (
                      <Button variant="ghost" size="sm" onClick={() => onOp(a, 'reset-mfa')} aria-label={`${t('admins.ops.resetMfa')} ${a.email}`}>{t('admins.ops.resetMfa')}</Button>
                    ) : null}
                    {a.status === 'disabled' ? (
                      <Button variant="ghost" size="sm" onClick={() => onOp(a, 'enable')} aria-label={`${t('admins.ops.enable')} ${a.email}`}>{t('admins.ops.enable')}</Button>
                    ) : self ? (
                      <Button variant="ghost" size="sm" disabled title={t('admins.ops.cannotDisableSelf')} aria-label={`${t('admins.ops.disable')} ${a.email}. ${t('admins.ops.cannotDisableSelf')}`}>{t('admins.ops.disable')}</Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => onOp(a, 'disable')} aria-label={`${t('admins.ops.disable')} ${a.email}`}>{t('admins.ops.disable')}</Button>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
