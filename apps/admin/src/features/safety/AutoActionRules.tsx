'use client';

import { RESTRICTION_KINDS } from '@amora/shared';
import { useState } from 'react';
import { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, TextField } from '@/components/ui/fields';
import { BoolBadge, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import { RULE_KEY_RE, ruleUpsertSchema, type ModerationRule } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { formatNumber, formatPercent } from '@/lib/format';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { validate, type FieldErrors } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';
import { label } from './labels';

/** Config read by SafetyAutomationService.recomputeRiskScores() for `auto_action` rules (not exported from @amora/shared). */
export const autoActionConfig = z.object({
  riskAbove: z.number().min(0).max(1),
  restrictionKinds: z.array(z.enum(RESTRICTION_KINDS)).min(1).max(RESTRICTION_KINDS.length),
  durationHours: z.number().int().min(1).max(24 * 365).optional(),
});
type AutoConfig = z.output<typeof autoActionConfig>;

interface Form { key: string; riskAbove: number | undefined; restrictionKinds: string[]; durationHours: number | undefined; isActive: boolean }

function toForm(r: ModerationRule | null): Form {
  if (!r) return { key: '', riskAbove: 0.8, restrictionKinds: [], durationHours: undefined, isActive: true };
  const c = r.config as Partial<AutoConfig>;
  return { key: r.key, riskAbove: c.riskAbove, restrictionKinds: Array.isArray(c.restrictionKinds) ? c.restrictionKinds : [], durationHours: c.durationHours, isActive: r.is_active };
}

/** Risk-score thresholds that automatically restrict accounts (rule_type `auto_action`, moderation.rules.manage). */
export function AutoActionRules() {
  const { api } = useSession();
  const data = useResource(() => api.safety.rules(), [api]);
  const [editing, setEditing] = useState<ModerationRule | 'new' | null>(null);
  const rows = data.status === 'success' ? data.data.filter((r) => r.rule_type === 'auto_action') : [];

  return (
    <section className="section" aria-labelledby="auto-actions">
      <div className="row row--between">
        <h2 id="auto-actions">{t('safety.thresholds.autoTitle')}</h2>
        <Button onClick={() => setEditing('new')}>{t('safety.thresholds.newAuto')}</Button>
      </div>
      <p className="muted">{t('safety.thresholds.autoIntro')}</p>
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && rows.length === 0 ? <EmptyState message={t('safety.thresholds.autoEmpty')} /> : null}
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('safety.rules.key')}</th>
                <th scope="col" className="num">{t('safety.thresholds.riskAbove')}</th>
                <th scope="col">{t('safety.thresholds.restrictions')}</th>
                <th scope="col" className="num">{t('safety.thresholds.duration')}</th>
                <th scope="col">{t('safety.rules.active')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = toForm(r);
                return (
                  <tr key={r.id}>
                    <td><code>{r.key}</code></td>
                    <td className="num">{c.riskAbove === undefined ? '—' : formatPercent(c.riskAbove)}</td>
                    <td>{c.restrictionKinds.length ? c.restrictionKinds.map((k) => label('restrictionKind', k)).join(', ') : '—'}</td>
                    <td className="num">{c.durationHours ? t('safety.thresholds.hours', { hours: formatNumber(c.durationHours) }) : t('safety.thresholds.untilLifted')}</td>
                    <td><BoolBadge value={r.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                    <td className="table__actions">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`${t('common.edit')} ${r.key}`}>{t('common.edit')}</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <AutoActionDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={data.reload} /> : null}
    </section>
  );
}

function AutoActionDialog({ rule, onClose, onSaved }: { rule: ModerationRule | null; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [form, setForm] = useState<Form>(() => toForm(rule));
  const [confirming, setConfirming] = useState<{ key: string; body: z.output<typeof ruleUpsertSchema> } | null>(null);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((s) => ({ ...s, [k]: v }));

  function review() {
    const errors: FieldErrors = {};
    if (!rule && !RULE_KEY_RE.test(form.key)) errors.key = t('safety.rules.keyInvalid');
    const c = validate(autoActionConfig, { riskAbove: form.riskAbove, restrictionKinds: form.restrictionKinds, durationHours: form.durationHours });
    if (!c.ok) Object.assign(errors, c.errors);
    if (!c.ok || Object.keys(errors).length) return setFieldErrors(errors);
    const body = validate(ruleUpsertSchema, { ruleType: 'auto_action', scope: 'account', config: c.data, locale: null, isActive: form.isActive });
    if (!body.ok) return setFieldErrors(body.errors);
    setFieldErrors({});
    setConfirming({ key: form.key, body: body.data });
  }

  async function apply(d: { key: string; body: z.output<typeof ruleUpsertSchema> }) {
    const ok = await send(() => api.safety.upsertRule(d.key, d.body));
    if (ok) {
      notify(t('common.saved'));
      onSaved();
      onClose();
    }
  }

  return (
    <>
      <FormDialog title={rule ? t('safety.rules.edit', { key: rule.key }) : t('safety.thresholds.newAuto')} onClose={onClose} onSubmit={review} busy={busy} error={error} fieldErrors={fieldErrors}>
        {rule ? (
          <ReadOnlyField label={t('safety.rules.key')} value={rule.key} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('safety.rules.key')} hint={t('safety.rules.keyHint')} value={form.key} onChange={set('key')} error={fieldErrors.key} required data-autofocus spellCheck={false} maxLength={64} />
        )}
        <NumberField label={t('safety.thresholds.riskAbove')} hint={t('safety.thresholds.riskAboveHint')} value={form.riskAbove} onChange={set('riskAbove')} error={fieldErrors.riskAbove} min={0} max={1} step="any" required />
        <fieldset className="field">
          <legend className="field__label">{t('safety.action.restrictionKinds')}</legend>
          <div className="checkbox-group">
            {RESTRICTION_KINDS.map((k) => (
              <CheckboxField
                key={k}
                label={label('restrictionKind', k)}
                checked={form.restrictionKinds.includes(k)}
                onChange={(on) => set('restrictionKinds')(on ? [...form.restrictionKinds, k] : form.restrictionKinds.filter((x) => x !== k))}
              />
            ))}
          </div>
          {fieldErrors.restrictionKinds ? <p className="field__error" role="alert">{t('safety.action.restrictionKindsRequired')}</p> : null}
        </fieldset>
        <NumberField label={t('safety.thresholds.durationHours')} hint={t('safety.thresholds.durationHint')} value={form.durationHours} onChange={set('durationHours')} error={fieldErrors.durationHours} min={1} max={24 * 365} step={1} />
        <CheckboxField label={t('safety.rules.active')} checked={form.isActive} onChange={set('isActive')} />
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('safety.rules.confirmTitle', { key: confirming.key })}
          body={t('safety.thresholds.confirmBody')}
          confirmLabel={t('safety.rules.confirmAction')}
          onConfirm={() => apply(confirming)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
