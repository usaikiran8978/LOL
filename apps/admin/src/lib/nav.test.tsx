import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteGuard } from '@/components/shell/RouteGuard';
import { Sidebar } from '@/components/shell/Sidebar';
import { t } from '@/i18n';
import { NAV, canSee, navFor, routeItem } from './nav';

describe('permission-filtered navigation', () => {
  it('drops items and empty groups the admin cannot access', () => {
    const groups = navFor(['audit.view', 'cms.manage']);
    expect(groups.map((g) => g.id)).toEqual(['content', 'security']);
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(['cms', 'audit']);
  });

  it('renders accessible links for every module the admin can access', () => {
    render(<Sidebar permissions={['taxonomy.manage', 'dashboard.view', 'users.view']} pathname="/users/u1" />);
    const nav = screen.getByRole('navigation', { name: t('nav.label') });
    expect(within(nav).getByRole('link', { name: t('nav.items.users') })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: t('nav.items.dashboard') })).toHaveAttribute('href', '/dashboard');
    expect(within(nav).getByRole('link', { name: t('nav.items.taxonomy') })).not.toHaveAttribute('aria-current');
    expect(within(nav).queryByRole('link', { name: t('nav.items.audit') })).toBeNull();
    expect(within(nav).queryByText(t('nav.items.flags'))).toBeNull();
    expect(within(nav).queryByText(t('nav.items.billing'))).toBeNull();
  });

  it('renders planned modules as disabled, labelled entries (not links)', () => {
    const nav = [{ id: 'g', labelKey: 'nav.groups.overview' as const, items: [{ id: 'x', labelKey: 'nav.items.dashboard' as const, anyOf: ['dashboard.view' as const], planned: true }] }];
    render(<Sidebar permissions={['dashboard.view']} pathname="/" nav={nav} />);
    const entry = screen.getByText(t('nav.items.dashboard')).closest('[aria-disabled]');
    expect(entry).toHaveAttribute('aria-disabled', 'true');
    expect(within(entry as HTMLElement).getByText(t('nav.planned'))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: new RegExp(t('nav.items.dashboard')) })).toBeNull();
  });

  it('module routes are guarded by any of their permissions', () => {
    expect(routeItem('/moderation/cases/c1')?.id).toBe('moderation');
    expect(canSee(routeItem('/moderation/appeals')!, ['moderation.appeals'])).toBe(true);
    expect(canSee(routeItem('/privacy')!, ['users.view'])).toBe(false);
    expect(routeItem('/moderation/reports')?.id).toBe('moderation');
    expect(routeItem('/dates/ideas')?.id).toBe('dates');
    expect(canSee(routeItem('/dates/safety')!, ['date_safety.manage'])).toBe(true);
    expect(canSee(routeItem('/events')!, ['date_safety.manage'])).toBe(false);
  });

  it('every planned item has no href and every live item has one', () => {
    for (const item of NAV.flatMap((g) => g.items)) expect(!!item.planned).toBe(!item.href);
  });

  it('route guard blocks pages without the permission (longest prefix wins)', () => {
    expect(routeItem('/geo/cities')?.id).toBe('cities');
    expect(routeItem('/config/flags/x')?.id).toBe('flags');
    render(<RouteGuard pathname="/config/settings" permissions={['flags.manage']}><p>secret page</p></RouteGuard>);
    expect(screen.queryByText('secret page')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(t('states.forbiddenTitle'));
  });

  it('route guard renders allowed pages', () => {
    render(<RouteGuard pathname="/config/settings" permissions={['settings.manage']}><p>settings page</p></RouteGuard>);
    expect(screen.getByText('settings page')).toBeInTheDocument();
  });
});
