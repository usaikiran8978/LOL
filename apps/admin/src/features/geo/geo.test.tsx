import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { renderSignedIn } from '@/test/utils';
import { CitiesPage } from './CitiesPage';
import { CountriesPage } from './CountriesPage';
import { LanguagesPage } from './LanguagesPage';

const de = {
  code: 'DE', name: 'Germany', default_locale: 'de', default_currency: 'EUR', measurement: 'metric', is_active: true, min_age: 18, emergency_number: '112',
  crossed_paths_allowed: false, identity_verification_available: true, religion_field_enabled: true, data_region: 'eu', privacy_regime: 'GDPR', data_retention_days: 730,
};

describe('CountriesPage', () => {
  it('requires confirmation to deactivate a country and sends the full compliance config', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CountriesPage />, { 'GET /admin/geo/countries': () => [de], 'PUT /admin/geo/countries/DE': (c) => c.body });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} Germany` }));
    const form = screen.getByRole('dialog');
    await user.click(within(form).getByLabelText(t('common.active')));
    const minAge = within(form).getByLabelText(t('countries.minAge'), { exact: false });
    await user.clear(minAge);
    await user.type(minAge, '30');
    await user.click(within(form).getByRole('button', { name: t('common.save') }));
    expect(within(form).getByText(t('validation.tooBig', { max: 25 }))).toBeInTheDocument();
    await user.clear(minAge);
    await user.type(minAge, '21');
    await user.click(within(form).getByRole('button', { name: t('common.save') }));
    const confirm = screen.getByRole('dialog', { name: t('countries.deactivateTitle', { name: 'Germany' }) });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: t('countries.deactivateConfirm') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      code: 'DE', name: 'Germany', defaultLocale: 'de', defaultCurrency: 'EUR', measurement: 'metric', isActive: false,
      config: { minAge: 21, emergencyNumber: '112', crossedPathsAllowed: false, identityVerificationAvailable: true, religionFieldEnabled: true, dataRegion: 'eu', privacyRegime: 'GDPR', dataRetentionDays: 730 },
    });
  });

  it('shows the empty state', async () => {
    await renderSignedIn(<CountriesPage />, { 'GET /admin/geo/countries': () => [] });
    expect(await screen.findByText(t('countries.empty'))).toBeInTheDocument();
  });
});

describe('CitiesPage', () => {
  const city = (id: string, name: string) => ({ id, country_code: 'DE', name, admin_region: null, latitude: 52.52, longitude: 13.4, timezone: 'Europe/Berlin', population: 3600000, is_active: true });
  it('searches with query params and paginates', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CitiesPage />, {
      'GET /admin/geo/countries': () => [de],
      'GET /admin/geo/cities': (c) => (c.query.get('cursor') ? { items: [city('c2', 'Bonn')], nextCursor: null } : { items: [city('c1', 'Berlin')], nextCursor: 'next' }),
    });
    expect(await screen.findByText('Berlin')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(t('cities.country')), 'DE');
    await user.type(screen.getByLabelText(t('cities.search')), 'ber');
    await user.click(screen.getByRole('button', { name: t('common.apply') }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/admin/geo/cities').length).toBe(2));
    expect(Object.fromEntries(calls.filter((c) => c.path === '/admin/geo/cities')[1]!.query)).toEqual({ country: 'DE', q: 'ber', limit: '50' });
    await user.click(await screen.findByRole('button', { name: t('common.loadMore') }));
    expect(await screen.findByText('Bonn')).toBeInTheDocument();
    expect(screen.getByText('Berlin')).toBeInTheDocument();
  });

  it('creates a city', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CitiesPage />, {
      'GET /admin/geo/countries': () => [de],
      'GET /admin/geo/cities': () => ({ items: [], nextCursor: null }),
      'POST /admin/geo/cities': () => city('c3', 'Hamburg'),
    });
    expect(await screen.findByText(t('cities.empty'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('cities.newCity') }));
    const d = screen.getByRole('dialog');
    await user.selectOptions(within(d).getByLabelText(t('cities.country'), { exact: false }), 'DE');
    await user.type(within(d).getByLabelText(t('cities.name'), { exact: false }), 'Hamburg');
    await user.type(within(d).getByLabelText(t('cities.timezone'), { exact: false }), 'Europe/Berlin');
    await user.type(within(d).getByLabelText(t('cities.latitude'), { exact: false }), '53.55');
    await user.type(within(d).getByLabelText(t('cities.longitude'), { exact: false }), '9.99');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/admin/geo/cities')).toBe(true));
    expect(calls.find((c) => c.path === '/admin/geo/cities' && c.method === 'POST')!.body).toEqual({ countryCode: 'DE', name: 'Hamburg', latitude: 53.55, longitude: 9.99, timezone: 'Europe/Berlin', isActive: true });
  });
});

describe('LanguagesPage', () => {
  it('lists languages with RTL rendering and adds an RTL app locale', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<LanguagesPage />, {
      'GET /admin/geo/languages': () => [{ code: 'ar', name: 'Arabic', native_name: 'العربية', is_rtl: true, is_app_locale: true, is_active: true }],
      'PUT /admin/geo/languages/he': (c) => c.body,
    });
    expect(await screen.findByText('العربية')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getByRole('button', { name: t('languages.newLanguage') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('languages.code'), { exact: false }), 'he');
    await user.type(within(d).getByLabelText(t('languages.name'), { exact: false }), 'Hebrew');
    await user.type(within(d).getByLabelText(t('languages.nativeName'), { exact: false }), 'עברית');
    await user.click(within(d).getByLabelText(t('languages.rtl')));
    await user.click(within(d).getByLabelText(t('languages.appLocale')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ code: 'he', name: 'Hebrew', nativeName: 'עברית', isRtl: true, isAppLocale: true, isActive: true });
  });
});
