'use client';

import { Button } from '@/components/ui/Button';
import { CheckboxField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { domainLabel, permissionGroups, permissionLabel } from './labels';

interface Props {
  selected: string[];
  onChange: (permissions: string[]) => void;
  /** Permissions the signed-in admin holds; others cannot be added (the API rejects escalation). */
  held: readonly string[];
  readOnly?: boolean;
  error?: string;
}

/** The shared permission catalog as a checklist grouped by domain, with per-group select all / clear. */
export function PermissionChecklist({ selected, onChange, held, readOnly, error }: Props) {
  const groups = permissionGroups();
  const set = new Set(selected);
  const total = groups.reduce((n, g) => n + g.permissions.length, 0);
  const known = groups.flatMap((g) => g.permissions).filter((p) => set.has(p)).length;

  function update(perms: string[], on: boolean) {
    const next = new Set(set);
    for (const p of perms) {
      if (on) next.add(p);
      else next.delete(p);
    }
    onChange([...next]);
  }

  return (
    <div className="stack">
      <p className="muted" aria-live="polite">{t('admins.rolesPage.selectedCount', { selected: known, total })}</p>
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {groups.map(({ domain, permissions }) => {
        const grantable = permissions.filter((p) => held.includes(p));
        const label = domainLabel(domain);
        return (
          <fieldset key={domain}>
            <legend>{label}</legend>
            {!readOnly && grantable.length > 0 ? (
              <div className="row">
                <Button variant="ghost" size="sm" onClick={() => update(grantable, true)} aria-label={`${t('admins.rolesPage.selectAll')}: ${label}`}>{t('admins.rolesPage.selectAll')}</Button>
                <Button variant="ghost" size="sm" onClick={() => update(permissions, false)} aria-label={`${t('admins.rolesPage.clearAll')}: ${label}`}>{t('admins.rolesPage.clearAll')}</Button>
              </div>
            ) : null}
            {permissions.map((p) => {
              const notHeld = !held.includes(p);
              return (
                <CheckboxField
                  key={p}
                  label={permissionLabel(p)}
                  hint={notHeld && !readOnly ? `${p} — ${t('admins.rolesPage.notHeld')}` : p}
                  checked={set.has(p)}
                  disabled={readOnly || (notHeld && !set.has(p))}
                  onChange={(on) => update([p], on)}
                />
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}
