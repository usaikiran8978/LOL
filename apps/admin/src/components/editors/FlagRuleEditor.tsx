'use client';

import { t } from '@/i18n';
import type { FlagRuleType } from '@/lib/api/admin-api';
import { PLATFORMS, RULE_TYPES, newRule, type FlagPlatform, type RuleForm } from '@/lib/flags';
import type { FieldErrors } from '@/lib/forms/validate';
import { Button } from '../ui/Button';
import { CheckboxField, NumberField, SelectField, TextAreaField, TextField } from '../ui/fields';

interface Props {
  rules: RuleForm[];
  onChange: (rules: RuleForm[]) => void;
  segmentKeys: string[];
  /** Errors keyed `rules.<index>.<field>` (as produced by validateFlagForm). */
  errors: FieldErrors;
}

/** Ordered rule list; position is priority (first match wins), so reordering is explicit. */
export function FlagRuleEditor({ rules, onChange, segmentKeys, errors }: Props) {
  const set = (i: number, patch: Partial<RuleForm>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, delta: number) => {
    const next = [...rules];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item!);
    onChange(next);
  };
  const err = (i: number, field: string) => errors[`rules.${i}.${field}`];

  return (
    <fieldset className="rules">
      <legend>{t('flags.rules')}</legend>
      {errors.rules ? <p className="field__error" role="alert">{errors.rules}</p> : null}
      {rules.length === 0 ? <p className="muted">{t('flags.noRules')}</p> : null}
      <ol className="rules__list">
        {rules.map((r, i) => (
          <li key={r.id} className="rule" aria-label={t('flags.rule', { n: i + 1 })}>
            <div className="row row--between">
              <strong>{t('flags.rule', { n: i + 1 })}</strong>
              <div className="row">
                <Button variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${t('common.moveUp')} — ${t('flags.rule', { n: i + 1 })}`}>↑</Button>
                <Button variant="ghost" size="sm" onClick={() => move(i, 1)} disabled={i === rules.length - 1} aria-label={`${t('common.moveDown')} — ${t('flags.rule', { n: i + 1 })}`}>↓</Button>
                <Button variant="ghost" size="sm" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label={`${t('common.remove')} — ${t('flags.rule', { n: i + 1 })}`}>{t('common.remove')}</Button>
              </div>
            </div>
            <div className="grid grid--2">
              <SelectField
                label={t('flags.ruleType')}
                value={r.ruleType}
                onChange={(v) => set(i, { ruleType: v as FlagRuleType })}
                options={RULE_TYPES.map((rt) => ({ value: rt, label: t(`flags.types.${rt}`) }))}
              />
              <SelectField
                label={t('flags.ruleValue')}
                value={r.value ? 'on' : 'off'}
                onChange={(v) => set(i, { value: v === 'on' })}
                options={[{ value: 'on', label: t('flags.on') }, { value: 'off', label: t('flags.off') }]}
              />
            </div>
            {r.ruleType === 'country' ? (
              <TextField label={t('flags.countryCodes')} hint={t('flags.countryCodesHint')} value={r.countryCodes} onChange={(v) => set(i, { countryCodes: v })} error={err(i, 'countryCodes')} required />
            ) : null}
            {r.ruleType === 'percentage' ? (
              <NumberField label={t('flags.percentage')} min={0} max={100} step={1} value={r.percentage} onChange={(v) => set(i, { percentage: v })} error={err(i, 'percentage')} required />
            ) : null}
            {r.ruleType === 'segment' ? (
              <SelectField
                label={t('flags.segmentKey')}
                value={r.segmentKey}
                onChange={(v) => set(i, { segmentKey: v })}
                placeholder={t('flags.chooseSegment')}
                options={segmentKeys.map((k) => ({ value: k, label: k }))}
                error={err(i, 'segmentKey')}
                required
              />
            ) : null}
            {r.ruleType === 'user' ? (
              <TextAreaField label={t('flags.userIds')} hint={t('flags.userIdsHint')} value={r.userIds} onChange={(v) => set(i, { userIds: v })} rows={4} error={err(i, 'userIds')} required spellCheck={false} />
            ) : null}
            {r.ruleType === 'platform' ? (
              <fieldset className="checkbox-group">
                <legend>{t('flags.platforms')}</legend>
                {PLATFORMS.map((p) => (
                  <CheckboxField
                    key={p}
                    label={t(`flags.platformNames.${p}`)}
                    checked={r.platforms.includes(p)}
                    onChange={(checked) => set(i, { platforms: checked ? [...r.platforms, p] : r.platforms.filter((x): x is FlagPlatform => x !== p) })}
                  />
                ))}
                {err(i, 'platforms') ? <p className="field__error" role="alert">{err(i, 'platforms')}</p> : null}
              </fieldset>
            ) : null}
            {r.ruleType === 'app_version' ? (
              <TextField label={t('flags.minAppVersion')} hint={t('flags.minAppVersionHint')} value={r.minAppVersion} onChange={(v) => set(i, { minAppVersion: v })} error={err(i, 'minAppVersion')} required />
            ) : null}
          </li>
        ))}
      </ol>
      <Button variant="secondary" size="sm" onClick={() => onChange([...rules, newRule()])} disabled={rules.length >= 50}>{t('flags.addRule')}</Button>
    </fieldset>
  );
}
