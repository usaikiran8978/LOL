import type { adminAcceptInvite, adminMfaConfirm, adminRoleUpsert, adminUserInvite, adminUserRolesUpdate, Permission } from '@amora/shared';
import type { z } from 'zod';
import type { ApiClient } from '../client';

/*
 * Response shapes mirror apps/api/src/modules/admin/auth/admins.controller.ts (admin_users / admin_roles rows
 * returned as-is with snake_case columns plus computed fields); `@amora/shared` defines only request contracts.
 */

type In<T extends z.ZodType> = z.input<T>;
const enc = encodeURIComponent;

/** `admin_users.status`: invited (password not set yet) → active ↔ disabled. */
export type AdminStatus = 'invited' | 'active' | 'disabled';

export interface AdminRoleGrant {
  key: string;
  /** ISO country codes the grant is limited to; null = all countries. */
  countryScope: string[] | null;
}

export interface AdminUserRow {
  id: string;
  email: string;
  display_name: string;
  status: AdminStatus | (string & {});
  mfa_enabled_at: string | null;
  mfaEnabled: boolean;
  last_login_at: string | null;
  created_at: string;
  roles: AdminRoleGrant[];
}

export interface AdminRoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  permissions: string[];
}

export interface InviteResult {
  id: string;
  inviteExpiresAt: string;
}

/** `POST admin/admins/:id/:op` — the only ops the API accepts. */
export type AdminOp = 'disable' | 'enable' | 'reset-mfa';

export interface MfaSetup {
  secret: string;
  otpauthUrl: string;
}

/** `GET admin/auth/me` (fuller than the session's AdminIdentity: includes MFA state). */
export interface AdminSelf {
  id: string;
  email: string;
  displayName: string | null;
  mfaEnabled: boolean;
  mfaSetupRequired: boolean;
  sessionExpiresAt: string;
  permissions: Permission[];
  countryScope: string[] | null;
}

/** Typed wrappers for admin accounts, roles and own-account MFA. */
export function adminsApi(c: ApiClient) {
  return {
    list: () => c.get<AdminUserRow[]>('/admin/admins'),
    invite: (body: In<typeof adminUserInvite>) => c.post<InviteResult>('/admin/admins', body),
    updateRoles: (id: string, body: In<typeof adminUserRolesUpdate>) => c.put<void>(`/admin/admins/${enc(id)}/roles`, body),
    op: (id: string, op: AdminOp) => c.post<void>(`/admin/admins/${enc(id)}/${op}`),
    roles: () => c.get<AdminRoleRow[]>('/admin/roles'),
    upsertRole: (key: string, body: In<typeof adminRoleUpsert>) => c.put<{ key: string; permissions: string[] }>(`/admin/roles/${enc(key)}`, body),
    deleteRole: (key: string) => c.del<void>(`/admin/roles/${enc(key)}`),
    // Own account.
    me: () => c.get<AdminSelf>('/admin/auth/me'),
    mfaSetup: () => c.post<MfaSetup>('/admin/auth/mfa/setup'),
    // A wrong code answers 400 OTP_INVALID; skipAuthRedirect keeps any 401 here from being treated as session expiry.
    mfaConfirm: (body: In<typeof adminMfaConfirm>) => c.request<void>('POST', '/admin/auth/mfa/confirm', { body, skipAuthRedirect: true }),
    mfaDisable: (body: In<typeof adminMfaConfirm>) => c.request<void>('POST', '/admin/auth/mfa/disable', { body, skipAuthRedirect: true }),
    // Public, pre-session: the one-time token is the credential (no CSRF token exists yet; 401 TOKEN_INVALID is not a session expiry).
    acceptInvite: (body: In<typeof adminAcceptInvite>) => c.request<void>('POST', '/admin/auth/accept-invite', { body, skipCsrf: true, skipAuthRedirect: true }),
  };
}
