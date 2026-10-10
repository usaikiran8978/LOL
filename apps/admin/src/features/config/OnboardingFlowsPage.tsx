'use client';

import { adminOnboardingFlowCreate, type Predicate } from '@amora/shared';
import { Fragment, useState } from 'react';
import { PredicateBuilder, conversionMessage } from '@/components/editors/PredicateBuilder';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, TextField } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui/states';
import { t } from '@/i18n';
import type { OnboardingFlowRow } from '@/lib/api/admin-api';
import { useAdminApi } from '@/lib/auth/session';
import type { FieldErrors } from '@/lib/forms/validate';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';
import type { Conversion } from '@/lib/predicate';

/*
 * Step keys the API has data-backed completion checks for (apps/api onboarding.service registerCheck).
 * Offered as suggestions only: the API exposes no catalog endpoint, and other keys remain valid.
 */
const KNOWN_STEPS = [
  'profile_basics', 'location', 'gender', 'orientation', 'dating_intent', 'relationship_goal', 'lifestyle', 'family', 'values',
  'communication_style', 'preferences', 'interests', 'photos', 'prompts', 'languages',
];

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export function OnboardingFlowsPage() {
  const api = useAdminApi();
  const flows = useResource(() => api.config.flows(), [api]);
  const notify = useNotify();
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState<OnboardingFlowRow | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const list = flows.data ?? [];
  const template = list.find((f) => f.status === 'published') ?? list[0] ?? null;

  return (
    <>
      <PageHeader title={t('onboarding.title')} intro={t('onboarding.intro')} actions={<Button onClick={() => setCreating(true)} disabled={flows.status !== 'success'}>{t('onboarding.newDraft')}</Button>} />
      {flows.status === 'loading' ? <LoadingState /> : null}
      {flows.status === 'error' ? <ErrorState error={flows.error} onRetry={flows.reload} /> : null}
      {flows.status === 'success' && list.length === 0 ? <EmptyState message={t('onboarding.empty')} /> : null}
      {flows.status === 'success' && list.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('onboarding.versionCol')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('onboarding.steps')}</th>
                <th scope="col">{t('onboarding.createdAt')}</th>
                <th scope="col">{t('onboarding.publishedAt')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <Fragment key={f.version}>
                  <tr>
                    <td>{t('onboarding.version', { version: f.version })}</td>
                    <td><StatusBadge status={f.status} /></td>
                    <td>{t('onboarding.stepsCount', { count: f.steps.length })}</td>
                    <td>{fmt(f.created_at)}</td>
                    <td>{fmt(f.published_at)}</td>
                    <td className="table__actions">
                      <Button variant="ghost" size="sm" aria-expanded={expanded === f.version} aria-controls={`steps-${f.version}`} onClick={() => setExpanded((x) => (x === f.version ? null : f.version))}>
                        {expanded === f.version ? t('onboarding.hideSteps') : t('onboarding.showSteps')}
                      </Button>
                      {f.status === 'draft' ? <Button size="sm" onClick={() => setPublishing(f)}>{t('onboarding.publish')}</Button> : null}
                    </td>
                  </tr>
                  {expanded === f.version ? (
                    <tr id={`steps-${f.version}`}>
                      <td colSpan={6}>
                        <ol className="steps">
                          {f.steps.map((s) => (
                            <li key={s.key}>
                              <code>{s.key}</code> — {s.required ? t('common.required') : t('common.optional')} — {s.condition ? <>{t('onboarding.conditional')}: <code>{JSON.stringify(s.condition)}</code></> : t('onboarding.always')}
                            </li>
                          ))}
                        </ol>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {creating ? (
        <DraftDialog
          template={template}
          onClose={() => setCreating(false)}
          onCreated={(version) => {
            notify(t('onboarding.draftCreated', { version }));
            flows.reload();
          }}
        />
      ) : null}
      {publishing ? (
        <ConfirmDialog
          title={t('onboarding.publishTitle', { version: publishing.version })}
          body={t('onboarding.publishBody')}
          confirmLabel={t('onboarding.publish')}
          onConfirm={async () => {
            await api.config.publishFlow(publishing.version);
            notify(t('onboarding.published', { version: publishing.version }));
            flows.reload();
          }}
          onClose={() => setPublishing(null)}
        />
      ) : null}
    </>
  );
}

interface StepForm {
  id: string;
  key: string;
  required: boolean;
  hasCondition: boolean;
  initialCondition: Predicate | null;
  condition: Conversion | null;
}

let stepSeq = 0;
const newStep = (key = '', required = true, condition: Predicate | null = null): StepForm => ({
  id: `s${++stepSeq}`, key, required, hasCondition: !!condition, initialCondition: condition, condition: null,
});

function DraftDialog({ template, onClose, onCreated }: { template: OnboardingFlowRow | null; onClose: () => void; onCreated: (version: number) => void }) {
  const api = useAdminApi();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [steps, setSteps] = useState<StepForm[]>(() => (template ? template.steps.map((s) => newStep(s.key, s.required, s.condition ?? null)) : [newStep()]));

  const update = (i: number, patch: Partial<StepForm>) => setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, delta: number) =>
    setSteps((all) => {
      const next = [...all];
      const [item] = next.splice(i, 1);
      next.splice(i + delta, 0, item!);
      return next;
    });

  async function save() {
    const extra: FieldErrors = {};
    const seen = new Set<string>();
    steps.forEach((s, i) => {
      if (s.hasCondition && s.condition && !s.condition.ok) extra[`steps.${i}.condition`] = conversionMessage(s.condition);
      // The API rejects duplicate keys (flowSteps refinement); flag the exact row instead.
      if (s.key && seen.has(s.key)) extra[`steps.${i}.key`] = t('validation.duplicate', { value: s.key });
      seen.add(s.key);
    });
    const payload = {
      steps: steps.map((s) => ({ key: s.key.trim(), required: s.required, condition: s.hasCondition && s.condition?.ok ? s.condition.value : undefined })),
    };
    const ok = await submit(adminOnboardingFlowCreate, payload, async (d) => {
      const created = await api.config.createFlow(d);
      onCreated(created.version);
    }, extra);
    if (ok) onClose();
  }

  return (
    <FormDialog title={t('onboarding.newDraftTitle')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} size="lg" submitLabel={t('common.create')}>
      {template ? <p className="alert alert--info">{t('onboarding.prefillNote', { version: template.version })}</p> : null}
      {fieldErrors.steps ? <p className="field__error" role="alert">{fieldErrors.steps}</p> : null}
      <ol className="rules__list">
        {steps.map((s, i) => (
          <li key={s.id} className="rule" aria-label={t('onboarding.stepN', { n: i + 1 })}>
            <div className="row row--between">
              <strong>{t('onboarding.stepN', { n: i + 1 })}</strong>
              <div className="row">
                <Button variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${t('common.moveUp')} — ${t('onboarding.stepN', { n: i + 1 })}`}>↑</Button>
                <Button variant="ghost" size="sm" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label={`${t('common.moveDown')} — ${t('onboarding.stepN', { n: i + 1 })}`}>↓</Button>
                <Button variant="ghost" size="sm" onClick={() => setSteps((all) => all.filter((_, j) => j !== i))} aria-label={`${t('common.remove')} — ${t('onboarding.stepN', { n: i + 1 })}`}>{t('common.remove')}</Button>
              </div>
            </div>
            <TextField label={t('onboarding.stepKey')} hint={t('onboarding.stepKeyHint')} value={s.key} onChange={(key) => update(i, { key })} error={fieldErrors[`steps.${i}.key`]} required list="onboarding-step-keys" spellCheck={false} />
            <CheckboxField label={t('onboarding.stepRequired')} checked={s.required} onChange={(required) => update(i, { required })} />
            {s.hasCondition ? (
              <>
                <PredicateBuilder label={t('onboarding.stepCondition')} initial={s.initialCondition} onChange={(condition) => update(i, { condition })} />
                {fieldErrors[`steps.${i}.condition`] ? <p className="field__error" role="alert">{fieldErrors[`steps.${i}.condition`]}</p> : null}
                <Button variant="ghost" size="sm" onClick={() => update(i, { hasCondition: false, condition: null, initialCondition: null })}>{t('onboarding.removeCondition')}</Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => update(i, { hasCondition: true })}>{t('onboarding.addCondition')}</Button>
            )}
          </li>
        ))}
      </ol>
      <datalist id="onboarding-step-keys">
        {KNOWN_STEPS.map((k) => <option key={k} value={k} />)}
      </datalist>
      <Button variant="secondary" onClick={() => setSteps((all) => [...all, newStep()])} disabled={steps.length >= 40}>{t('onboarding.addStep')}</Button>
    </FormDialog>
  );
}
