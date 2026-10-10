import { PERMISSIONS, SYSTEM_ROLES } from './permissions';

describe('admin RBAC catalog', () => {
  it('defines all seven roles from TECH appendix', () => {
    expect(Object.keys(SYSTEM_ROLES).sort()).toEqual(
      ['analyst', 'content_admin', 'finance_admin', 'product_admin', 'super_admin', 'support', 'trust_safety'].sort(),
    );
  });

  it('only references permissions that exist', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      for (const p of role.permissions) expect(Object.keys(PERMISSIONS)).toContain(p);
    }
  });

  it('keeps the analyst role read-only', () => {
    const writes = SYSTEM_ROLES.analyst!.permissions.filter((p) => !/\.(view|export)$/.test(p));
    expect(writes).toEqual([]);
  });

  it('restricts verification evidence to trust & safety and super admin', () => {
    const holders = Object.entries(SYSTEM_ROLES)
      .filter(([, r]) => r.permissions.includes('verification.view_evidence'))
      .map(([k]) => k)
      .sort();
    expect(holders).toEqual(['super_admin', 'trust_safety']);
  });
});
