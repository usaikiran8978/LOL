import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { renderSignedIn } from '@/test/utils';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('links only to available modules the admin can access', async () => {
    await renderSignedIn(<HomePage />, {}, ['legal.manage', 'dashboard.view']);
    expect(screen.getByRole('link', { name: t('nav.items.legal') })).toHaveAttribute('href', '/content/legal');
    // Dashboard appears twice: as a quick action in the welcome banner and as a module card.
    const dashboard = screen.getAllByRole('link', { name: t('nav.items.dashboard') });
    expect(dashboard).toHaveLength(2);
    for (const link of dashboard) expect(link).toHaveAttribute('href', '/dashboard');
    expect(screen.queryByRole('link', { name: t('nav.items.audit') })).toBeNull();
    expect(screen.getByRole('link', { name: t('nav.items.legal') })).toHaveAccessibleDescription(t('home.modules.legal'));
    expect(screen.getByText(t('home.moduleCount', { count: 2 }))).toBeInTheDocument();
  });

  it('explains when nothing is available', async () => {
    await renderSignedIn(<HomePage />, {}, []);
    expect(screen.getByText(t('home.noneAvailable'))).toBeInTheDocument();
  });
});
