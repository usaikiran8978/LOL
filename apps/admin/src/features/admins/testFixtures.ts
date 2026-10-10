import { PERMISSIONS, type Permission } from '@amora/shared';
import type { AdminRoleRow, AdminUserRow } from '@/lib/api/modules/admins';
import { apiError, type RecordedCall } from '@/test/utils';

/** Test fixtures (used only by *.test.tsx). */
export const roleRows: AdminRoleRow[] = [
  { id: 'r1', key: 'super_admin', name: 'Super Admin', description: 'All platform controls', is_system: true, created_at: '2026-01-01T00:00:00Z', permissions: (Object.keys(PERMISSIONS) as Permission[]).sort() },
  { id: 'r2', key: 'support', name: 'Support', description: 'User support', is_system: true, created_at: '2026-01-01T00:00:00Z', permissions: ['users.view', 'users.view_pii'] },
  { id: 'r3', key: 'people_ops', name: 'People ops', description: null, is_system: false, created_at: '2026-01-02T00:00:00Z', permissions: ['admins.manage', 'users.view'] },
  { id: 'r4', key: 'unused_role', name: 'Unused', description: 'Nobody has it', is_system: false, created_at: '2026-01-03T00:00:00Z', permissions: ['audit.view'] },
];

export const adminRows: AdminUserRow[] = [
  { id: 'a1', email: 'admin@example.com', display_name: 'Ada', status: 'active', mfa_enabled_at: '2026-01-01T00:00:00Z', mfaEnabled: true, last_login_at: '2026-02-01T10:00:00Z', created_at: '2026-01-01T00:00:00Z', roles: [{ key: 'super_admin', countryScope: null }] },
  { id: 'b1', email: 'bob@example.com', display_name: 'Bob', status: 'disabled', mfa_enabled_at: null, mfaEnabled: false, last_login_at: null, created_at: '2026-01-01T00:00:00Z', roles: [{ key: 'people_ops', countryScope: ['IN'] }] },
  { id: 'c1', email: 'carol@example.com', display_name: 'Carol', status: 'active', mfa_enabled_at: '2026-01-05T00:00:00Z', mfaEnabled: true, last_login_at: '2026-02-03T10:00:00Z', created_at: '2026-01-01T00:00:00Z', roles: [{ key: 'support', countryScope: ['IN', 'US'] }] },
];

/**
 * `GET /admin/auth/me` override: the first call (session bootstrap) answers 401 so the test helper signs in and
 * holds a CSRF token; later calls return the given identity.
 */
export function meAfterLogin(payload: Record<string, unknown>) {
  let n = 0;
  return () => (n++ === 0 ? apiError(401, 'UNAUTHENTICATED') : { id: 'a1', email: 'admin@example.com', permissions: Object.keys(PERMISSIONS), countryScope: null, ...payload });
}

/** Writes other than the test helper's own sign-in (`/admin/auth/login`). */
export const writesOf = (all: () => RecordedCall[]) => () => all().filter((c) => c.path !== '/admin/auth/login');
