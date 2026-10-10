'use client';

import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { RULE_SCOPES, type ModerationRule } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { enumOptions } from './labels';
import { EDITABLE_TYPES, EMPTY_RULE, EVALUATED_TYPES, ruleToForm, TEXT_SCOPES, TEXT_SIGNALS, validateRuleForm, type RuleBody, type RuleForm } from './ruleForms';

export function RuleDialog({ rule, onClose, onSaved }: { rule: ModerationRule | null; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [form, setForm] = useState<RuleForm>(() => (rule ? ruleToForm(rule) : EMPTY_RULE));
  const [confirming, setConfirming] = useState<{ key: string; body: RuleBody } | null>(null);
  const set = <K extends keyof RuleForm>(k: K) => (v: RuleForm[K]) => setForm((s) => ({ ...s, [k]: v }));
  const isText = form.ruleType === 'keyword' || form.ruleType === 'regex';
  // Text rules only make sense for the scopes the scanner reads; an existing rule keeps its stored scope visible.
  const scopes = isText && (TEXT_SCOPES as readonly string[]).includes(form.scope) ? TEXT_SCOPES : RULE_SCOPES;

  function review() {
    const v = validateRuleForm(form, !rule);
    if (!v.ok) return setFieldErrors(v.errors);
    setFieldErrors({});
    // Rules apply to live content within seconds (the API invalidates its rule cache), so saves are confirmed.
    setConfirming(v.data);
  }

  async function apply(data: { key: string; body: RuleBody }) {
    const ok = await send(() => api.safety.upsertRule(data.key, data.body));
    if (ok) {
      notify(t('common.saved'));
      onSaved();
      onClose();
    }
  }

  return (
    <>
      <FormDialog title={rule ? t('safety.rules.edit', { key: rule.key }) : t('safety.rules.new')} onClose={onClose} onSubmit={review} busy={busy} error={error} fieldErrors={fieldErrors} size="lg">
        {rule ? (
          <ReadOnlyField label={t('safety.rules.key')} value={rule.key} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('safety.rules.key')} hint={t('safety.rules.keyHint')} value={form.key} onChange={set('key')} error={fieldErrors.key} required data-autofocus spellCheck={false} maxLength={64} />
        )}
        <div className="grid grid--2">
          <SelectField label={t('safety.rules.type')} value={form.ruleType} onChange={set('ruleType')} error={fieldErrors.ruleType} options={enumOptions('ruleType', EDITABLE_TYPES)} required />
          <SelectField label={t('safety.rules.scope')} value={form.scope} onChange={set('scope')} error={fieldErrors.scope} options={enumOptions('ruleScope', scopes)} required />
        </div>
        {!EVALUATED_TYPES.includes(form.ruleType as RuleBody['ruleType']) ? <p className="alert alert--info">{t('safety.rules.notEvaluated')}</p> : null}
        {isText ? (
          <>
            {form.ruleType === 'keyword' ? (
              <TextAreaField label={t('safety.rules.terms')} hint={t('safety.rules.termsHint')} value={form.terms} onChange={set('terms')} error={fieldErrors['config.terms']} rows={6} required spellCheck={false} />
            ) : (
              <div className="grid grid--2">
                <TextField label={t('safety.rules.pattern')} value={form.pattern} onChange={set('pattern')} error={fieldErrors['config.pattern']} required spellCheck={false} />
                <TextField label={t('safety.rules.flags')} hint={t('safety.rules.flagsHint')} value={form.flags} onChange={set('flags')} error={fieldErrors['config.flags']} spellCheck={false} maxLength={8} />
              </div>
            )}
            <div className="grid grid--3">
              <SelectField label={t('safety.rules.action')} hint={t('safety.rules.actionHint')} value={form.action} onChange={set('action')} error={fieldErrors['config.action']} options={enumOptions('ruleAction', ['warn', 'hide'])} required />
              <NumberField label={t('safety.rules.score')} hint={t('safety.rules.scoreHint')} value={form.score} onChange={set('score')} error={fieldErrors['config.score']} min={0} max={1} step="any" required />
              <SelectField label={t('safety.rules.signal')} value={form.signal} onChange={set('signal')} error={fieldErrors['config.signal']} options={enumOptions('signal', TEXT_SIGNALS)} required />
            </div>
          </>
        ) : (
          <TextAreaField label={t('safety.rules.configJson')} value={form.configJson} onChange={set('configJson')} error={fieldErrors.config} rows={8} spellCheck={false} className="code" required />
        )}
        <TextField label={t('safety.rules.locale')} hint={t('safety.rules.localeHint')} value={form.locale} onChange={set('locale')} error={fieldErrors.locale} maxLength={10} spellCheck={false} />
        <CheckboxField label={t('safety.rules.active')} checked={form.isActive} onChange={set('isActive')} />
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('safety.rules.confirmTitle', { key: confirming.key })}
          body={t('safety.rules.confirmBody')}
          confirmLabel={t('safety.rules.confirmAction')}
          onConfirm={() => apply(confirming)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
