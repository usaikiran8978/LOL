import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { navigationState, routerMock } from '@/test/setup';
import { apiError, field, renderSignedIn, type RecordedCall } from '@/test/utils';
import { DateIdeasPage } from './DateIdeasPage';
import { DateSafetySettingsPage } from './DateSafetySettingsPage';
import { DatesIndex } from './DatesTabs';

const writes = (calls: RecordedCall[]) => calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/admin/auth'));
const ESCALATE = 'date_safety.escalate_after_overdue_min';
const settings = [
  { key: ESCALATE, value: 15, min: 5, max: 120, description: 'Minutes after a missed check-in before the trusted contact and Trust & Safety are alerted' },
  { key: 'date_safety.max_trusted_contacts', value: 5, min: 1, max: 10, description: 'Trusted contacts a member can add' },
];
const INTEREST = '66666666-6666-4666-8666-666666666666';
const coffee = {
  id: 'i1', key: 'coffee_walk', activityType: 'coffee', budgetKey: 'low', dateStageKeys: ['first_date'], interestIds: [], indoor: false, timeOfDay: ['morning', 'afternoon'],
  typicalDurationMin: 60, safetyTipsKey: null, isActive: true, translations: { en: { title: 'Coffee and a walk', description: 'Grab a coffee and stroll.' } },
};
const term = (kind: string, key: string, label: string, isActive = true) => ({ id: `${kind}-${key}`, kind, key, parent_id: null, position: 0, is_sensitive: false, is_active: isActive, metadata: {}, translations: { en: { label } } });

describe('Dates index', () => {
  it('forwards to the safety settings and is forbidden without date_safety.manage', async () => {
    navigationState.pathname = '/dates';
    const first = await renderSignedIn(<DatesIndex />, {}, ['date_safety.manage']);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/dates/safety'));
    first.unmount();
    await renderSignedIn(<DatesIndex />, {}, ['events.view']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
  });
});

describe('Date safety settings', () => {
  beforeEach(() => {
    navigationState.pathname = '/dates/safety';
  });

  it('lists bounded settings and saves a value within range', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<DateSafetySettingsPage />, {
      'GET /admin/dates/safety/settings': () => settings,
      [`PUT /admin/dates/safety/settings/${ESCALATE}`]: (c) => ({ key: ESCALATE, value: (c.body as { value: number }).value }),
    }, ['date_safety.manage']);
    const row = (await screen.findByText(ESCALATE)).closest('tr')!;
    expect(within(row).getByText('15')).toBeInTheDocument();
    expect(within(row).getByText(t('dates.safety.rangeValue', { min: '5', max: '120' }))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('dates.tabs.ideas') })).toHaveAttribute('href', '/dates/ideas');

    await user.click(within(row).getByRole('button', { name: `${t('dates.safety.edit')} ${ESCALATE}` }));
    const d = screen.getByRole('dialog', { name: t('dates.safety.editTitle', { key: ESCALATE }) });
    const input = within(d).getByLabelText(t('dates.safety.value'), { exact: false });
    await user.clear(input);
    await user.type(input, '500');
    await user.click(within(d).getByRole('button', { name: t('dates.safety.confirmAction') }));
    expect(within(d).getByText(t('validation.tooBig', { max: 120 }))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
    await user.clear(input);
    await user.type(input, '30');
    await user.click(within(d).getByRole('button', { name: t('dates.safety.confirmAction') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ value: 30 });
    expect(await screen.findByText(t('dates.safety.saved', { key: ESCALATE }))).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.path === '/admin/dates/safety/settings')).toHaveLength(2));
  });

  it('shows the API error inside the dialog, error/retry and empty states, and gating', async () => {
    const user = userEvent.setup();
    let fail = true;
    const first = await renderSignedIn(<DateSafetySettingsPage />, {
      'GET /admin/dates/safety/settings': () => (fail ? apiError(500, 'INTERNAL') : settings),
      [`PUT /admin/dates/safety/settings/${ESCALATE}`]: () => apiError(400, 'VALIDATION_FAILED', { min: 5, max: 120 }),
    }, ['date_safety.manage']);
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    await user.click(await screen.findByRole('button', { name: `${t('dates.safety.edit')} ${ESCALATE}` }));
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByRole('button', { name: t('dates.safety.confirmAction') }));
    expect(await within(d).findByText(t('errors.VALIDATION_FAILED'))).toBeInTheDocument();
    first.unmount();
    const second = await renderSignedIn(<DateSafetySettingsPage />, { 'GET /admin/dates/safety/settings': () => [] }, ['date_safety.manage']);
    expect(await screen.findByText(t('dates.safety.empty'))).toBeInTheDocument();
    second.unmount();
    const { calls } = await renderSignedIn(<DateSafetySettingsPage />, {}, ['events.view', 'settings.manage']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/admin/dates'))).toBe(false);
  });
});

describe('Date ideas', () => {
  beforeEach(() => {
    navigationState.pathname = '/dates/ideas';
  });

  it('lists ideas and edits one with the key locked, keeping stored values', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<DateIdeasPage />, {
      'GET /admin/dates/ideas': () => [coffee],
      'PUT /admin/dates/ideas/coffee_walk': () => ({ id: 'i1', key: 'coffee_walk' }),
    }, ['date_safety.manage']);
    const row = (await screen.findByText('Coffee and a walk')).closest('tr')!;
    expect(within(row).getByText(`${t('dates.ideas.times.morning')}, ${t('dates.ideas.times.afternoon')}`)).toBeInTheDocument();
    expect(within(row).getByText(t('dates.ideas.indoorNo'))).toBeInTheDocument();
    expect(within(row).getByText(t('dates.ideas.durationValue', { minutes: 60 }))).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: `${t('common.edit')} coffee_walk` }));
    const d = screen.getByRole('dialog', { name: t('dates.ideas.editIdea', { key: 'coffee_walk' }) });
    expect(within(d).getByLabelText(t('common.key'))).toHaveAttribute('readonly');
    // Without taxonomy.manage the term keys are typed.
    expect(within(d).getByLabelText(t('dates.ideas.stages'))).toHaveValue('first_date');
    await user.click(within(d).getByLabelText(t('dates.ideas.times.evening')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({
      activityType: 'coffee', budgetKey: 'low', dateStageKeys: ['first_date'], interestIds: [], indoor: false, timeOfDay: ['morning', 'afternoon', 'evening'],
      typicalDurationMin: 60, safetyTipsKey: null, isActive: true, translations: { en: { title: 'Coffee and a walk', description: 'Grab a coffee and stroll.' } },
    });
    expect(await screen.findByText(t('dates.ideas.saved', { key: 'coffee_walk' }))).toBeInTheDocument();
  }, 15_000);

  it('creates an idea with taxonomy pickers after validating key and translations', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<DateIdeasPage />, {
      'GET /admin/dates/ideas': () => [],
      'GET /admin/taxonomy/terms': (c) => (c.query.get('kind') === 'budget_tier' ? [term('budget_tier', 'low', 'Low budget'), term('budget_tier', 'old', 'Old', false)] : [term('date_stage', 'first_date', 'First date')]),
      'GET /admin/taxonomy/interests': () => [{ id: INTEREST, key: 'art', category_id: 'x', icon: null, position: 0, is_active: true, translations: { en: { label: 'Art' } } }],
      'PUT /admin/dates/ideas/museum_visit': () => ({ id: 'i2', key: 'museum_visit' }),
    }, ['date_safety.manage', 'taxonomy.manage']);
    expect(await screen.findByText(t('dates.ideas.empty'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('dates.ideas.newIdea') }));
    const d = screen.getByRole('dialog');
    await user.type(field(t('common.key')), 'Bad Key');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('dates.ideas.keyHint'), { selector: '.field__error' })).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);

    await user.clear(field(t('common.key')));
    await user.type(field(t('common.key')), 'museum_visit');
    await user.type(field(t('dates.ideas.activityType')), 'museum');
    const budget = await within(d).findByLabelText(t('dates.ideas.budget'));
    expect(within(budget).queryByRole('option', { name: 'Old' })).toBeNull();
    await user.selectOptions(budget, 'low');
    await user.selectOptions(within(d).getByLabelText(t('dates.ideas.indoor')), 'yes');
    await user.click(await within(d).findByLabelText('First date'));
    await user.click(await within(d).findByLabelText('Art'));
    await user.click(within(d).getByLabelText(t('dates.ideas.times.afternoon')));
    await user.type(within(d).getByLabelText(t('dates.ideas.duration')), '90');
    await user.type(within(d).getByLabelText(t('dates.ideas.fieldTitle'), { exact: false }), 'Museum visit');
    await user.type(within(d).getByLabelText(t('dates.ideas.fieldDescription'), { exact: false }), 'Explore an exhibition together.');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.path).toBe('/admin/dates/ideas/museum_visit');
    expect(writes(calls)[0]!.body).toEqual({
      activityType: 'museum', budgetKey: 'low', dateStageKeys: ['first_date'], interestIds: [INTEREST], indoor: true, timeOfDay: ['afternoon'], typicalDurationMin: 90,
      safetyTipsKey: null, isActive: true, translations: { en: { title: 'Museum visit', description: 'Explore an exhibition together.' } },
    });
  }, 20_000);

  it('shows error/retry and is gated by date_safety.manage', async () => {
    const user = userEvent.setup();
    let fail = true;
    const first = await renderSignedIn(<DateIdeasPage />, { 'GET /admin/dates/ideas': () => (fail ? apiError(500, 'INTERNAL') : [coffee]) }, ['date_safety.manage']);
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText('Coffee and a walk')).toBeInTheDocument();
    first.unmount();
    await renderSignedIn(<DateIdeasPage />, {}, ['events.view']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
  });
});
