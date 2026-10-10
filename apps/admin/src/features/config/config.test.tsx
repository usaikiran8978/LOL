import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { renderSignedIn } from '@/test/utils';
import { FlagsPage } from './FlagsPage';
import { OnboardingFlowsPage } from './OnboardingFlowsPage';
import { SegmentsPage } from './SegmentsPage';
import { SettingsPage } from './SettingsPage';

describe('FlagsPage', () => {
  it('validates rules, then applies the flag only after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<FlagsPage />, {
      'GET /admin/config/flags': () => [],
      'GET /admin/config/segments': () => [{ id: 's', key: 'beta', description: null, definition: { field: 'a', op: 'exists' }, updated_at: '2026-01-01T00:00:00Z' }],
      'PUT /admin/config/flags/travel_mode': (c) => c.body,
    });
    expect(await screen.findByText(t('flags.empty'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('flags.newFlag') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('flags.key'), { exact: false }), 'travel_mode');
    await user.click(within(d).getByLabelText(t('flags.enabled')));
    await user.click(within(d).getByRole('button', { name: t('flags.addRule') }));
    await user.selectOptions(within(d).getByLabelText(t('flags.ruleType')), 'segment');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.ruleTarget', { type: t('flags.types.segment') }))).toBeInTheDocument();
    await user.selectOptions(within(d).getByLabelText(t('flags.segmentKey'), { exact: false }), 'beta');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    const confirm = screen.getByRole('dialog', { name: t('flags.confirmTitle') });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: t('flags.confirmAction') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ key: 'travel_mode', enabled: true, defaultValue: false, rules: [{ ruleType: 'segment', segmentKey: 'beta', value: true }] });
  });
});

describe('SegmentsPage', () => {
  it('creates a segment from the visual builder', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<SegmentsPage />, { 'GET /admin/config/segments': () => [], 'PUT /admin/config/segments/young_de': (c) => c.body });
    expect(await screen.findByText(t('segments.empty'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('segments.newSegment') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('common.key'), { exact: false }), 'young_de');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getAllByText(t('predicate.errors.missing_field')).length).toBeGreaterThan(0);
    await user.type(within(d).getByLabelText(t('predicate.field')), 'age');
    await user.selectOptions(within(d).getByLabelText(t('predicate.operator')), 'lt');
    await user.selectOptions(within(d).getByLabelText(t('predicate.valueType')), 'number');
    await user.type(within(d).getByLabelText(t('predicate.value')), '30');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ key: 'young_de', definition: { all: [{ field: 'age', op: 'lt', value: 30 }] } });
  });
});

describe('SettingsPage', () => {
  const rows = [
    { key: 'onboarding.min_photos', value_type: 'number', description: 'Photos required', is_secret: false, updated_at: '2026-01-01T00:00:00Z', updated_by: null, value: 2 },
    { key: 'ai.provider_key', value_type: 'string', description: null, is_secret: true, updated_at: '2026-01-01T00:00:00Z', updated_by: null, value: null },
  ];
  it('never shows secret values and edits typed values', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<SettingsPage />, { 'GET /admin/config/settings': () => rows, 'PUT /admin/config/settings/onboarding.min_photos': (c) => c.body, 'PUT /admin/config/settings/ai.provider_key': () => ({}) });
    expect(await screen.findByText(t('settings.secretHidden'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `${t('common.edit')} onboarding.min_photos` }));
    const d = screen.getByRole('dialog');
    const value = within(d).getByLabelText(t('settings.value'), { exact: false });
    expect(value).toHaveValue(2);
    await user.clear(value);
    await user.type(value, '3');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ value: 3, valueType: 'number', description: 'Photos required' });

    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} ai.provider_key` }));
    const secret = within(screen.getByRole('dialog')).getByLabelText(t('settings.secretInput'), { exact: false });
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toHaveValue('');
  });

  it('rejects invalid JSON for json settings', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<SettingsPage />, { 'GET /admin/config/settings': () => [] });
    expect(await screen.findByText(t('settings.empty'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('settings.newSetting') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('settings.key'), { exact: false }), 'feature.limits');
    await user.selectOptions(within(d).getByLabelText(t('settings.valueType')), 'json');
    fireEvent.change(within(d).getByLabelText(t('settings.value'), { exact: false }), { target: { value: '{bad' } });
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.invalidJson'))).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('OnboardingFlowsPage', () => {
  const flows = [
    { version: 2, status: 'draft', steps: [{ key: 'profile_basics', required: true }], created_at: '2026-02-01T00:00:00Z', published_at: null, published_by: null },
    { version: 1, status: 'published', steps: [{ key: 'profile_basics', required: true }, { key: 'photos', required: true, condition: { field: 'country', op: 'eq', value: 'DE' } }], created_at: '2026-01-01T00:00:00Z', published_at: '2026-01-02T00:00:00Z', published_by: null },
  ];

  it('publishes a draft after confirmation and shows history', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<OnboardingFlowsPage />, { 'GET /admin/config/onboarding-flows': () => flows, 'POST /admin/config/onboarding-flows/2/publish': () => ({ ...flows[0], status: 'published' }) });
    expect(await screen.findByText(t('onboarding.version', { version: 1 }))).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: t('onboarding.publish') })).toHaveLength(1);
    await user.click(screen.getAllByRole('button', { name: t('onboarding.showSteps') })[1]!);
    expect(screen.getByText('photos')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('onboarding.publish') }));
    const confirm = screen.getByRole('dialog', { name: t('onboarding.publishTitle', { version: 2 }) });
    await user.click(within(confirm).getByRole('button', { name: t('onboarding.publish') }));
    await waitFor(() => expect(calls.some((c) => c.path === '/admin/config/onboarding-flows/2/publish')).toBe(true));
  });

  it('creates a new draft pre-filled from the published version, keeping conditions', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<OnboardingFlowsPage />, { 'GET /admin/config/onboarding-flows': () => flows, 'POST /admin/config/onboarding-flows': () => ({ ...flows[0], version: 3 }) });
    await user.click(await screen.findByRole('button', { name: t('onboarding.newDraft') }));
    const d = screen.getByRole('dialog');
    expect(within(d).getByText(t('onboarding.prefillNote', { version: 1 }))).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: `${t('common.moveUp')} — ${t('onboarding.stepN', { n: 2 })}` }));
    await user.click(within(d).getByRole('button', { name: t('onboarding.addStep') }));
    const keys = within(d).getAllByLabelText(t('onboarding.stepKey'), { exact: false });
    await user.type(keys[2]!, 'photos');
    await user.click(within(d).getByRole('button', { name: t('common.create') }));
    expect(within(d).getByText(t('validation.duplicate', { value: 'photos' }))).toBeInTheDocument();
    await user.clear(keys[2]!);
    await user.type(keys[2]!, 'interests');
    await user.click(within(d).getByRole('button', { name: t('common.create') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/admin/config/onboarding-flows')).toBe(true));
    expect(calls.find((c) => c.path === '/admin/config/onboarding-flows' && c.method === 'POST')!.body).toEqual({
      steps: [
        { key: 'photos', required: true, condition: { field: 'country', op: 'eq', value: 'DE' } },
        { key: 'profile_basics', required: true },
        { key: 'interests', required: true },
      ],
    });
  });
});
