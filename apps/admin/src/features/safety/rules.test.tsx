import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { navigationState } from '@/test/setup';
import { apiError, renderSignedIn } from '@/test/utils';
import { without, writes } from './fixtures';
import { RulesPage } from './RulesPage';
import { ThresholdsPage } from './ThresholdsPage';

const rule = (over: Record<string, unknown>) => ({
  id: String(over.key), key: 'k', rule_type: 'keyword', scope: 'message', config: {}, locale: null, is_active: true, version: 1, updated_by: null, updated_at: '2026-10-01T00:00:00Z', ...over,
});
const RULES = [
  rule({ key: 'scam_terms', config: { terms: ['western union', 'gift card'], action: 'hide', score: 0.6, signal: 'scam' } }),
  rule({ key: 'auto_restrict', rule_type: 'auto_action', scope: 'account', config: { riskAbove: 0.85, restrictionKinds: ['no_messaging'], durationHours: 48 } }),
];

beforeEach(() => {
  navigationState.pathname = '/moderation/rules';
});

describe('RulesPage', () => {
  it('lists text rules (auto-actions live on the thresholds page)', async () => {
    await renderSignedIn(<RulesPage />, { 'GET /admin/moderation/rules': () => RULES });
    expect(await screen.findByText('scam_terms')).toBeInTheDocument();
    expect(screen.getByText(t('safety.rules.termsCount', { count: 2 }))).toBeInTheDocument();
    expect(screen.queryByText('auto_restrict')).not.toBeInTheDocument();
  });

  it('creates a keyword rule after validation and confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<RulesPage />, { 'GET /admin/moderation/rules': () => [], 'PUT /admin/moderation/rules/payment_terms': (c) => c.body });
    expect(await screen.findByText(t('safety.rules.empty'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('safety.rules.new') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('safety.rules.key'), { exact: false }), 'Bad Key');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('safety.rules.keyInvalid'))).toBeInTheDocument();
    expect(within(d).getByLabelText(t('safety.rules.terms'), { exact: false })).toHaveAttribute('aria-invalid', 'true');
    await user.clear(within(d).getByLabelText(t('safety.rules.key'), { exact: false }));
    await user.type(within(d).getByLabelText(t('safety.rules.key'), { exact: false }), 'payment_terms');
    await user.type(within(d).getByLabelText(t('safety.rules.terms'), { exact: false }), 'paypal me{enter}cash app');
    await user.selectOptions(within(d).getByLabelText(t('safety.rules.signal'), { exact: false }), 'off_platform_payment');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    const confirm = screen.getByRole('dialog', { name: t('safety.rules.confirmTitle', { key: 'payment_terms' }) });
    expect(writes(calls)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: t('safety.rules.confirmAction') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({
      ruleType: 'keyword', scope: 'message', locale: null, isActive: true,
      config: { action: 'warn', score: 0.5, signal: 'off_platform_payment', terms: ['paypal me', 'cash app'] },
    });
  });

  it('rejects an invalid regular expression and warns about non-evaluated rule types', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<RulesPage />, { 'GET /admin/moderation/rules': () => RULES });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} scam_terms` }));
    const d = screen.getByRole('dialog');
    expect(within(d).getByLabelText(t('safety.rules.terms'), { exact: false })).toHaveValue('western union\ngift card');
    await user.selectOptions(within(d).getByLabelText(t('safety.rules.type'), { exact: false }), 'regex');
    fireEvent.change(within(d).getByLabelText(t('safety.rules.pattern'), { exact: false }), { target: { value: '(unclosed' } });
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('safety.rules.regexInvalid'))).toBeInTheDocument();
    await user.selectOptions(within(d).getByLabelText(t('safety.rules.type'), { exact: false }), 'velocity');
    expect(within(d).getByText(t('safety.rules.notEvaluated'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
  });

  it('shows the API error inside the confirmation and the page error state', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<RulesPage />, { 'GET /admin/moderation/rules': () => (fail ? apiError(500, 'INTERNAL') : RULES), 'PUT /admin/moderation/rules/scam_terms': () => apiError(400, 'VALIDATION_FAILED') });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} scam_terms` }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('common.save') }));
    await user.click(within(screen.getByRole('dialog', { name: t('safety.rules.confirmTitle', { key: 'scam_terms' }) })).getByRole('button', { name: t('safety.rules.confirmAction') }));
    expect(await screen.findByText(t('errors.VALIDATION_FAILED'))).toBeInTheDocument();
  });

  it('forbids the page without moderation.rules.manage', async () => {
    await renderSignedIn(<RulesPage />, {}, without('moderation.rules.manage'));
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
  });
});

describe('ThresholdsPage', () => {
  const settings = [{ key: 'moderation.sla_hours', value_type: 'json', description: 'SLA', is_secret: false, updated_at: '2026-10-01T00:00:00Z', updated_by: null, value: { critical: 2, high: 4, medium: 24, low: 72 } }];

  it('lists auto-action thresholds and creates one', async () => {
    const user = userEvent.setup();
    navigationState.pathname = '/moderation/thresholds';
    const { calls } = await renderSignedIn(<ThresholdsPage />, {
      'GET /admin/moderation/rules': () => RULES,
      'GET /admin/config/settings': () => settings,
      'PUT /admin/moderation/rules/high_risk': (c) => c.body,
    });
    expect(await screen.findByText('auto_restrict')).toBeInTheDocument();
    expect(screen.queryByText('scam_terms')).not.toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('safety.thresholds.newAuto') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('safety.rules.key'), { exact: false }), 'high_risk');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('safety.action.restrictionKindsRequired'))).toBeInTheDocument();
    await user.click(within(d).getByLabelText(t('safety.restrictionKind.no_discovery')));
    await user.click(within(d).getByLabelText(t('safety.restrictionKind.review_required')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await user.click(within(screen.getByRole('dialog', { name: t('safety.rules.confirmTitle', { key: 'high_risk' }) })).getByRole('button', { name: t('safety.rules.confirmAction') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ ruleType: 'auto_action', scope: 'account', locale: null, isActive: true, config: { riskAbove: 0.8, restrictionKinds: ['no_discovery', 'review_required'] } });
  });

  it('edits SLA hours through system settings when the admin has settings.manage', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ThresholdsPage />, {
      'GET /admin/moderation/rules': () => [],
      'GET /admin/config/settings': () => settings,
      'PUT /admin/config/settings/moderation.sla_hours': (c) => c.body,
    });
    expect(await screen.findByText(t('safety.settings.names.slaHours'))).toBeInTheDocument();
    // Unset settings show the service default.
    expect(screen.getAllByText(t('safety.settings.default')).length).toBe(4);
    await user.click(screen.getByRole('button', { name: `${t('common.edit')} moderation.sla_hours` }));
    const d = screen.getByRole('dialog');
    const critical = within(d).getByLabelText(t('safety.settings.slaFor', { severity: t('safety.severity.critical') }), { exact: false });
    expect(critical).toHaveValue(2);
    await user.clear(critical);
    await user.type(critical, '1');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await user.click(within(screen.getByRole('dialog', { name: t('safety.settings.confirmTitle', { name: t('safety.settings.names.slaHours') }) })).getByRole('button', { name: t('safety.rules.confirmAction') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ value: { critical: 1, high: 4, medium: 24, low: 72 }, valueType: 'json', description: 'SLA' });
  });

  it('validates the image policy thresholds', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ThresholdsPage />, { 'GET /admin/moderation/rules': () => [], 'GET /admin/config/settings': () => [] });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} moderation.image_policy` }));
    const d = screen.getByRole('dialog');
    const review = within(d).getByLabelText(t('safety.settings.reviewConfidence'), { exact: false });
    await user.clear(review);
    await user.type(review, '0.95');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('safety.settings.reviewAboveReject'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
  });

  it('does not read system settings without settings.manage', async () => {
    const { calls } = await renderSignedIn(<ThresholdsPage />, { 'GET /admin/moderation/rules': () => [] }, without('settings.manage'));
    expect(await screen.findByText(t('safety.thresholds.autoEmpty'))).toBeInTheDocument();
    expect(screen.getByText(t('safety.settings.noPermission'))).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/admin/config/settings')).toBe(false);
  });
});
