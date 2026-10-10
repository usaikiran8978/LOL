import type { Permission } from '@amora/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n';
import { ALL_PERMISSIONS, apiError, field, renderSignedIn } from '@/test/utils';
import { UserDetailPage } from './UserDetailPage';
import { UsersSearchPage } from './UsersSearchPage';

vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }));
import { downloadText } from '@/lib/download';

const UID = '3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e';
const CASE = '9a8b7c6d-2222-4a8e-9d1c-1f2a3b4c5d6e';

const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, email: 'ada@example.com', phone_e164: '+15550001111', status: 'active', country_code: 'US', created_at: '2026-01-01T10:00:00.000Z',
  last_active_at: '2026-10-01T10:00:00.000Z', display_name: name, verification_level: 'selfie', is_discoverable: true, ...extra,
});

const detail = (extra: Record<string, unknown> = {}) => ({
  id: UID, email: 'ada@example.com', phone_e164: '+15550001111', status: 'active', status_reason: null, status_until: null, country_code: 'US', locale: 'en',
  created_at: '2026-01-01T10:00:00.000Z', last_login_at: null, last_active_at: null, email_verified_at: '2026-01-01T10:00:00.000Z', phone_verified_at: null,
  failed_login_count: 0, locked_until: null, date_of_birth: '1990-05-01',
  profile: {
    user_id: UID, display_name: 'Ada', bio: 'Hello', profession: null, employer: null, school: null, home_country_code: 'US', completeness_score: 80,
    incognito: false, is_discoverable: true, moderation_status: 'approved', verification_level: 'selfie', snoozed_until: null, created_at: '2026-01-01T10:00:00.000Z', updated_at: '2026-01-01T10:00:00.000Z',
  },
  sessions: [{ id: 's1', created_at: '2026-10-01T10:00:00.000Z', last_used_at: null, platform: 'ios', model: 'iPhone 15', app_version: '1.2.0' }],
  restrictions: [], verification: [], counts: { reportsAgainst: 3, reportsBy: 1, matches: 7 },
  safety: { cases: [{ id: CASE, category: 'scam', severity: 'high', status: 'open', opened_at: '2026-10-01T10:00:00.000Z' }], actions: [], riskScore: null },
  ...extra,
});

const billing = { subscriptions: [], payments: [], entitlements: [{ id: 'e1', entitlement_key: 'travel_mode', source_type: 'admin_grant', source_id: null, limit_value: null, limit_period: null, starts_at: '2026-10-01T10:00:00.000Z', ends_at: null, revoked_at: null }], balances: [], ledger: [] };

const without = (...p: Permission[]) => ALL_PERMISSIONS.filter((x) => !p.includes(x));

describe('UsersSearchPage', () => {
  it('lists users, paginates with the cursor and sends validated filters', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<UsersSearchPage />, {
      'GET /admin/users': (c) => (c.query.get('cursor') === 'c2' ? { items: [row('u2', 'Grace')], nextCursor: null } : { items: [row('u1', 'Ada')], nextCursor: 'c2' }),
    });
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('common.loadMore') }));
    expect(await screen.findByText('Grace')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `${t('users.open')} Ada` })).toHaveAttribute('href', '/users/u1');

    await user.type(field(t('users.country')), 'u');
    await user.click(screen.getByRole('button', { name: t('common.apply') }));
    expect(screen.getByText(t('validation.invalidFormat'))).toBeInTheDocument();
    await user.clear(field(t('users.country')));
    await user.type(field(t('users.country')), 'us');
    await user.selectOptions(field(t('users.status')), 'banned');
    await user.click(screen.getByLabelText(t('users.verifiedOnly')));
    await user.click(screen.getByRole('button', { name: t('common.apply') }));
    await waitFor(() => expect(Object.fromEntries(calls.filter((c) => c.path === '/admin/users').at(-1)!.query)).toEqual({ status: 'banned', country: 'US', verified: 'true', limit: '25' }));
  });

  it('hides contact details without users.view_pii and the export without users.export', async () => {
    await renderSignedIn(<UsersSearchPage />, { 'GET /admin/users': () => ({ items: [row('u1', 'Ada', { email: 'a•••@example.com' })], nextCursor: null }) }, without('users.view_pii', 'users.export'));
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.queryByText('a•••@example.com')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: t('users.email') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('users.exportCsv') })).not.toBeInTheDocument();
  });

  it('exports the current filters as CSV', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<UsersSearchPage />, {
      'GET /admin/users': () => ({ items: [], nextCursor: null }),
      'GET /admin/users/export/csv': () => new Response('id,status\n', { status: 200, headers: { 'Content-Type': 'text/csv' } }),
    });
    expect(await screen.findByText(t('users.empty'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('users.exportCsv') }));
    await waitFor(() => expect(downloadText).toHaveBeenCalledWith('id,status\n', expect.stringMatching(/^users-.*\.csv$/)));
    expect(calls.some((c) => c.path === '/admin/users/export/csv')).toBe(true);
    expect(await screen.findByText(t('users.exported'))).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    let fail = true;
    const user = userEvent.setup();
    await renderSignedIn(<UsersSearchPage />, { 'GET /admin/users': () => (fail ? apiError(500, 'INTERNAL') : { items: [], nextCursor: null }) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('users.empty'))).toBeInTheDocument();
  });
});

describe('UserDetailPage', () => {
  it('renders the profile, PII, safety history and entitlements for a fully privileged admin', async () => {
    await renderSignedIn(<UserDetailPage userId={UID} />, {
      'GET /admin/users/3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e': () => detail(),
      'GET /admin/billing/users/3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e': () => billing,
    });
    expect(await screen.findByRole('heading', { name: 'Ada', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText(CASE)).toBeInTheDocument();
    expect(await screen.findByText(t('users.grant.entitlements.travel_mode'))).toBeInTheDocument();
    expect(screen.getByText('iPhone 15')).toBeInTheDocument();
  });

  it('withholds PII, safety history, billing and location without the permissions', async () => {
    const { calls } = await renderSignedIn(
      <UserDetailPage userId={UID} />,
      // The API masks contact details without users.view_pii; the UI must not render even the masked value.
      { 'GET /admin/users/3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e': () => detail({ email: 'a•••@example.com', safety: null }) },
      ['users.view'],
    );
    expect(await screen.findByRole('heading', { name: 'Ada', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('a•••@example.com')).not.toBeInTheDocument();
    expect(screen.getAllByText(t('users.detail.piiHidden')).length).toBe(3);
    expect(screen.getByText(t('users.detail.safetyHidden'))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: t('users.billing.title') })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: t('users.location.title') })).not.toBeInTheDocument();
    expect(screen.getByText(t('users.actions.none'))).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/admin/billing'))).toBe(false);
  });

  it('shows only the actions the admin may take and requires a reason and duration to suspend', async () => {
    const user = userEvent.setup();
    const { mutations } = await renderSignedIn(
      <UserDetailPage userId={UID} />,
      {
        'GET /admin/users/3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e': () => detail(),
        'POST /admin/users/3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e/actions': () => ({ actionId: 'a1' }),
      },
      ['users.view', 'users.suspend', 'users.force_logout'],
    );
    expect(await screen.findByRole('heading', { name: 'Ada', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('users.actions.ban') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('users.actions.grant') })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('users.actions.suspend') }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: t('users.actions.suspend') }));
    expect(within(dialog).getAllByText(t('validation.required')).length).toBeGreaterThan(0);
    expect(mutations().filter((m) => !m.path.startsWith('/admin/auth'))).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(t('users.actions.reasonKey'), { exact: false }), 'scam');
    await user.type(within(dialog).getByLabelText(t('users.actions.durationHours'), { exact: false }), '48');
    await user.click(within(dialog).getByRole('button', { name: t('users.actions.suspend') }));
    await waitFor(() => expect(mutations().filter((m) => !m.path.startsWith('/admin/auth'))).toHaveLength(1));
    expect(mutations().filter((m) => !m.path.startsWith('/admin/auth'))[0]!.body).toEqual({ action: 'suspend', reasonKey: 'scam', durationHours: 48 });
    expect(await screen.findByText(t('users.actions.done.suspend'))).toBeInTheDocument();
  });

  it('reveals the location only on request, with the incident case id', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<UserDetailPage userId={UID} />, {
      'GET /admin/users/3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e': () => detail(),
      'GET /admin/billing/users/3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e': () => billing,
      'GET /admin/users/3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e/location': () => ({ user_id: UID, latitude: 52.52, longitude: 13.405, accuracy_m: 25, geohash7: 'u33dc0r', source: 'gps', captured_at: '2026-10-01T10:00:00.000Z' }),
    });
    expect(await screen.findByRole('heading', { name: t('users.location.title') })).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/location'))).toBe(false);
    await user.click(screen.getByRole('button', { name: t('users.location.reveal') }));
    expect(screen.getByText(t('validation.invalidUuid'))).toBeInTheDocument();
    await user.type(field(t('users.location.caseId')), CASE);
    await user.click(screen.getByRole('button', { name: t('users.location.reveal') }));
    expect(await screen.findByText('u33dc0r')).toBeInTheDocument();
    expect(calls.find((c) => c.path.endsWith('/location'))!.query.get('caseId')).toBe(CASE);
  });

  it('grants an entitlement and refreshes the billing card', async () => {
    const user = userEvent.setup();
    let billingLoads = 0;
    const { mutations } = await renderSignedIn(<UserDetailPage userId={UID} />, {
      'GET /admin/users/3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e': () => detail(),
      'GET /admin/billing/users/3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e': () => { billingLoads++; return billing; },
      'POST /admin/billing/grants': () => new Response(null, { status: 204 }),
    });
    await user.click(await screen.findByRole('button', { name: t('users.actions.grant') }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(t('users.grant.entitlementKey')), 'incognito');
    await user.type(within(dialog).getByLabelText(t('users.grant.reasonKey'), { exact: false }), 'goodwill');
    await user.click(within(dialog).getByRole('button', { name: t('users.grant.submit') }));
    await waitFor(() => expect(mutations().filter((m) => !m.path.startsWith('/admin/auth'))).toHaveLength(1));
    expect(mutations().filter((m) => !m.path.startsWith('/admin/auth'))[0]!.body).toEqual({ userId: UID, entitlementKey: 'incognito', days: 30, reasonKey: 'goodwill' });
    expect(await screen.findByText(t('users.grant.done'))).toBeInTheDocument();
    await waitFor(() => expect(billingLoads).toBe(2));
  });

  it('shows an error state with retry', async () => {
    let fail = true;
    const user = userEvent.setup();
    await renderSignedIn(<UserDetailPage userId={UID} />, { 'GET /admin/users/3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e': () => (fail ? apiError(404, 'NOT_FOUND') : detail()) }, ['users.view']);
    expect(await screen.findByText(t('errors.NOT_FOUND'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByRole('heading', { name: 'Ada', level: 1 })).toBeInTheDocument();
  });
});
