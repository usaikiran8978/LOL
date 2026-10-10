import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { FlagRuleEditor } from '@/components/editors/FlagRuleEditor';
import { t } from '@/i18n';
import type { FlagRow } from './api/admin-api';
import { flagToForm, formToPayload, newRule, validateFlagForm, type FlagForm, type RuleForm } from './flags';

const base: FlagForm = { key: 'travel_mode', description: '', enabled: true, defaultValue: false, rules: [] };

describe('flag rule validation', () => {
  it('requires the target that matches the rule type', () => {
    const r = validateFlagForm({ ...base, rules: [newRule('country'), { ...newRule('percentage') }, newRule('segment')] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors['rules.0.countryCodes']).toBe(t('validation.ruleTarget', { type: t('flags.types.country') }));
    expect(r.errors['rules.1.percentage']).toBeDefined();
    expect(r.errors['rules.2.segmentKey']).toBeDefined();
  });

  it('applies contract constraints (percentage range, UUIDs, ISO codes, version format)', () => {
    const r = validateFlagForm({
      ...base,
      rules: [
        { ...newRule('percentage'), percentage: 150 },
        { ...newRule('user'), userIds: 'not-a-uuid' },
        { ...newRule('country'), countryCodes: 'DEU' },
        { ...newRule('app_version'), minAppVersion: 'v2' },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors['rules.0.percentage']).toBe(t('validation.tooBig', { max: 100 }));
    expect(r.errors['rules.1.userIds']).toBe(t('validation.invalidUuid'));
    expect(r.errors['rules.2.countryCodes']).toBe(t('validation.invalidFormat'));
    expect(r.errors['rules.3.minAppVersion']).toBe(t('validation.invalidFormat'));
  });

  it('rejects invalid flag keys and accepts a complete flag; order is priority', () => {
    expect(validateFlagForm({ ...base, key: 'Bad Key' })).toMatchObject({ ok: false, errors: { key: t('validation.invalidFormat') } });
    const rules: RuleForm[] = [
      { ...newRule('platform'), platforms: ['ios'], value: false },
      { ...newRule('country'), countryCodes: 'de, fr' },
      { ...newRule('percentage'), percentage: 10 },
    ];
    const r = validateFlagForm({ ...base, rules });
    expect(r.ok).toBe(true);
    expect(formToPayload({ ...base, rules }).rules).toEqual([
      { ruleType: 'platform', platforms: ['ios'], value: false },
      { ruleType: 'country', countryCodes: ['DE', 'FR'], value: true },
      { ruleType: 'percentage', percentage: 10, value: true },
    ]);
  });

  it('loads server rows sorted by priority', () => {
    const row: FlagRow = {
      id: 'f', key: 'k1', description: null, enabled: true, default_value: false, updated_at: '',
      rules: [
        { id: 'b', priority: 1, rule_type: 'percentage', percentage: 5, country_codes: null, segment_key: null, user_ids: null, platforms: null, min_app_version: null, value: true },
        { id: 'a', priority: 0, rule_type: 'country', percentage: null, country_codes: ['DE'], segment_key: null, user_ids: null, platforms: null, min_app_version: null, value: false },
      ],
    };
    expect(flagToForm(row).rules.map((r) => r.ruleType)).toEqual(['country', 'percentage']);
  });
});

function Harness() {
  const [rules, setRules] = useState<RuleForm[]>([{ ...newRule('country'), countryCodes: 'DE' }, { ...newRule('percentage'), percentage: 20 }]);
  return (
    <>
      <FlagRuleEditor rules={rules} onChange={setRules} segmentKeys={['beta_testers']} errors={{}} />
      <output data-testid="order">{rules.map((r) => r.ruleType).join(',')}</output>
    </>
  );
}

describe('FlagRuleEditor', () => {
  it('reorders, adds and switches rule types with the matching target input', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: `${t('common.moveDown')} — ${t('flags.rule', { n: 1 })}` }));
    expect(screen.getByTestId('order')).toHaveTextContent('percentage,country');
    await user.click(screen.getByRole('button', { name: t('flags.addRule') }));
    const types = screen.getAllByLabelText(t('flags.ruleType'));
    await user.selectOptions(types[2]!, 'segment');
    expect(screen.getByRole('option', { name: 'beta_testers' })).toBeInTheDocument();
    expect(screen.getByTestId('order')).toHaveTextContent('percentage,country,segment');
  });
});
