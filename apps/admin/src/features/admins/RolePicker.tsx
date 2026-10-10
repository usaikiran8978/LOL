'use client';

import { CheckboxField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { AdminRoleRow } from '@/lib/api/modules/admins';
import { useSession } from '@/lib/auth/session';
import { missingPermissions, roleDescription, roleLabel } from './labels';

interface Props {
  roles: AdminRoleRow[];
  selected: string[];
  onChange: (keys: string[]) => void;
  countryScope: string;
  onCountryScopeChange: (value: string) => void;
  errors: { roleKeys?: string; countryScope?: string };
}

/**
 * Role checklist + country scope shared by the invite and edit-roles dialogs. Roles that would grant permissions
 * the signed-in admin lacks are disabled (the API rejects them as privilege escalation) unless already assigned.
 */
export function RolePicker({ roles, selected, onChange, countryScope, onCountryScopeChange, errors }: Props) {
  const held = useSession().admin?.permissions ?? [];
  const toggle = (key: string, on: boolean) => onChange(on ? [...selected, key] : selected.filter((k) => k !== key));
  return (
    <>
      <fieldset aria-describedby="admins-roles-hint">
        <legend>{t('admins.roles.label')}</legend>
        <p id="admins-roles-hint" className="field__hint">{t('admins.roles.hint')}</p>
        {roles.map((role) => {
          const missing = missingPermissions(role, held);
          const checked = selected.includes(role.key);
          const description = roleDescription(role);
          return (
            <CheckboxField
              key={role.key}
              label={roleLabel(role, role.key)}
              hint={missing.length ? `${description ?? ''} (${t('admins.roles.cannotGrant')})`.trim() : (description ?? undefined)}
              checked={checked}
              disabled={missing.length > 0 && !checked}
              onChange={(on) => toggle(role.key, on)}
            />
          );
        })}
        {errors.roleKeys ? <p className="field__error" role="alert">{errors.roleKeys}</p> : null}
      </fieldset>
      <TextField
        label={t('admins.roles.countryScope')}
        hint={t('admins.roles.countryScopeHint')}
        value={countryScope}
        onChange={onCountryScopeChange}
        error={errors.countryScope}
        autoComplete="off"
        spellCheck={false}
      />
    </>
  );
}
