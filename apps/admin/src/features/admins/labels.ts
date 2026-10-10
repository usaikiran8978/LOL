import { PERMISSIONS, type Permission } from '@amora/shared';
import type { BadgeTone } from '@/components/ui/Badge';
import { t, tDynamic } from '@/i18n';
import { ApiError } from '@/lib/api/client';
import type { AdminRoleRow } from '@/lib/api/modules/admins';
import type { FieldErrors } from '@/lib/forms/validate';

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isKnownPermission(p: string): p is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, p);
}

/** Localized permission label; falls back to the shared catalog's English description, then the raw key. */
export function permissionLabel(p: string): string {
  return tDynamic(`admins.permissions.${p.replace(/\./g, '_')}`, isKnownPermission(p) ? PERMISSIONS[p] : p);
}

export function permissionDomain(p: string): string {
  return p.split('.')[0] ?? p;
}

export function domainLabel(domain: string): string {
  return tDynamic(`admins.domains.${domain}`, domain);
}

/** The catalog grouped by domain, in catalog order. */
export function permissionGroups(): Array<{ domain: string; permissions: Permission[] }> {
  const groups = new Map<string, Permission[]>();
  for (const p of ALL_PERMISSIONS) {
    const d = permissionDomain(p);
    groups.set(d, [...(groups.get(d) ?? []), p]);
  }
  return [...groups].map(([domain, permissions]) => ({ domain, permissions }));
}

/** Role display name: translated for system roles, the stored name for custom ones. */
export function roleLabel(role: Pick<AdminRoleRow, 'key' | 'name' | 'is_system'> | undefined, key: string): string {
  if (!role) return key;
  return role.is_system ? tDynamic(`admins.roleNames.${role.key}`, role.name) : role.name;
}

export function roleDescription(role: Pick<AdminRoleRow, 'key' | 'description' | 'is_system'>): string | null {
  return role.is_system ? tDynamic(`admins.roleDescriptions.${role.key}`, role.description ?? '') || null : role.description;
}

/** Permissions of `role` the signed-in admin does not hold (the API rejects granting those). */
export function missingPermissions(role: Pick<AdminRoleRow, 'permissions'>, held: readonly string[]): string[] {
  return role.permissions.filter((p) => !held.includes(p));
}

export function statusTone(status: string): BadgeTone {
  if (status === 'active') return 'success';
  if (status === 'invited') return 'info';
  if (status === 'disabled') return 'danger';
  return 'neutral';
}

export function statusLabel(status: string): string {
  return tDynamic(`admins.status.${status}`, status);
}

/** "IN, us" → ['IN', 'US']; empty → null (all countries). */
export function parseCountryScope(text: string): string[] | null {
  const codes = text.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  return codes.length ? [...new Set(codes)] : null;
}

/** Collapses `countryScope.N` / `roleKeys.N` issue paths onto their field. */
export function collapseErrors(errors: FieldErrors): FieldErrors {
  const out: FieldErrors = {};
  for (const [k, v] of Object.entries(errors)) {
    const base = k.split('.')[0] ?? k;
    out[base] ??= v;
  }
  return out;
}

/** FORBIDDEN `{ missing: [...] }` from the anti-escalation check, as a readable message (or null). */
export function escalationMessage(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'FORBIDDEN') return null;
  const missing = (error.details as { missing?: unknown } | undefined)?.missing;
  if (!Array.isArray(missing) || missing.length === 0) return null;
  return t('admins.roles.escalation', { permissions: missing.map((p) => permissionLabel(String(p))).join(', ') });
}
