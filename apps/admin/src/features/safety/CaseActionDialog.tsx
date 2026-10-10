'use client';

import { adminCaseAction, MODERATION_ACTIONS, RESTRICTION_KINDS } from '@amora/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { CaseDetail } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { validate } from '@/lib/forms/validate';
import { enumOptions, label } from './labels';

type ActionBody = z.output<typeof adminCaseAction>;
type Action = (typeof MODERATION_ACTIONS)[number];
const CONTENT_TYPES = ['media', 'message', 'prompt', 'bio', 'event'] as const;
const EVIDENCE_CONTENT: Record<string, (typeof CONTENT_TYPES)[number] | undefined> = { media: 'media', message: 'message', prompt: 'prompt', event: 'event' };

interface Form {
  action: string;
  reasonKey: string;
  note: string;
  durationHours: number | undefined;
  restrictionKinds: string[];
  contentType: string;
  contentId: string;
  restrictionId: string;
  notifyUser: boolean;
}

/** Actions this admin may take: all need moderation.action; ban/unban also moderation.ban; escalate moderation.escalate. */
export function allowedActions(can: (p: 'moderation.ban' | 'moderation.escalate') => boolean): Action[] {
  return MODERATION_ACTIONS.filter((a) => ((a !== 'ban' && a !== 'unban') || can('moderation.ban')) && (a !== 'escalate' || can('moderation.escalate')));
}

/** Builds the request body with only the fields that apply to the chosen action. */
function toBody(f: Form): Record<string, unknown> {
  const body: Record<string, unknown> = { action: f.action || undefined, reasonKey: f.reasonKey.trim(), notifyUser: f.notifyUser };
  if (f.note.trim()) body.note = f.note.trim();
  if ((f.action === 'suspend' || f.action === 'restrict') && f.durationHours !== undefined) body.durationHours = f.durationHours;
  if (f.action === 'restrict') body.restrictionKinds = f.restrictionKinds;
  if (f.action === 'remove_content' || f.action === 'restore_content') {
    body.contentType = f.contentType || undefined;
    if (f.contentType !== 'bio' && f.contentId.trim()) body.contentId = f.contentId.trim();
  }
  if (f.action === 'lift_restriction' && f.restrictionId.trim()) body.restrictionId = f.restrictionId.trim();
  return body;
}

export function CaseActionDialog({ c, onClose, onDone }: { c: CaseDetail; onClose: () => void; onDone: () => void }) {
  const { api, can } = useSession();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const actions = allowedActions(can);
  const [form, setForm] = useState<Form>({ action: '', reasonKey: '', note: '', durationHours: undefined, restrictionKinds: [], contentType: '', contentId: '', restrictionId: '', notifyUser: true });
  const [confirming, setConfirming] = useState<ActionBody | null>(null);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((s) => ({ ...s, [k]: v }));
  const evidenceContent = c.evidence.filter((e) => e.ref_id && EVIDENCE_CONTENT[e.kind]);
  const isContent = form.action === 'remove_content' || form.action === 'restore_content';

  function review() {
    const v = validate(adminCaseAction, toBody(form));
    if (!v.ok) return setFieldErrors(v.errors);
    setFieldErrors({});
    // Every enforcement action affects a live account, so it is confirmed (bans with a typed phrase).
    setConfirming(v.data);
  }

  async function apply(data: ActionBody) {
    const ok = await send(() => api.safety.act(c.id, data));
    if (ok) {
      notify(t('safety.action.done', { action: label('actionType', data.action) }));
      onDone();
      onClose();
    }
  }

  function pickEvidence(id: string) {
    const e = evidenceContent.find((x) => x.id === id);
    if (!e) return;
    setForm((s) => ({ ...s, contentType: EVIDENCE_CONTENT[e.kind] ?? '', contentId: e.ref_id ?? '' }));
  }

  return (
    <>
      <FormDialog title={t('safety.action.title')} onClose={onClose} onSubmit={review} busy={busy} error={error} fieldErrors={fieldErrors} submitLabel={t('safety.action.review')} size="lg">
        <SelectField label={t('safety.action.action')} value={form.action} onChange={set('action')} error={fieldErrors.action} placeholder={t('safety.create.choose')} options={enumOptions('actionType', actions)} required />
        {!can('moderation.ban') ? <p className="muted">{t('safety.action.banNeedsPermission')}</p> : null}
        <TextField label={t('safety.action.reasonKey')} hint={t('safety.action.reasonKeyHint')} value={form.reasonKey} onChange={set('reasonKey')} error={fieldErrors.reasonKey} required spellCheck={false} maxLength={60} />
        {form.action === 'suspend' || form.action === 'restrict' ? (
          <NumberField
            label={t('safety.action.durationHours')}
            hint={form.action === 'restrict' ? t('safety.action.durationOptional') : undefined}
            value={form.durationHours}
            onChange={set('durationHours')}
            error={fieldErrors.durationHours}
            min={1}
            max={24 * 365}
            step={1}
            required={form.action === 'suspend'}
          />
        ) : null}
        {form.action === 'restrict' ? (
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
        ) : null}
        {isContent ? (
          <>
            {evidenceContent.length > 0 ? (
              <SelectField
                label={t('safety.action.fromEvidence')}
                value=""
                onChange={pickEvidence}
                placeholder={t('safety.action.pickEvidence')}
                options={evidenceContent.map((e) => ({ value: e.id, label: `${label('evidenceKind', e.kind)} ${e.ref_id ?? ''}` }))}
              />
            ) : null}
            <SelectField label={t('safety.action.contentType')} value={form.contentType} onChange={set('contentType')} error={fieldErrors.contentType} placeholder={t('safety.create.choose')} options={enumOptions('contentType', CONTENT_TYPES)} required />
            {form.contentType !== 'bio' ? (
              <TextField label={t('safety.action.contentId')} value={form.contentId} onChange={set('contentId')} error={fieldErrors.contentId} required spellCheck={false} />
            ) : (
              <p className="muted">{t('safety.action.bioNote')}</p>
            )}
          </>
        ) : null}
        {form.action === 'lift_restriction' ? (
          <TextField label={t('safety.action.restrictionId')} hint={t('safety.action.restrictionIdHint')} value={form.restrictionId} onChange={set('restrictionId')} error={fieldErrors.restrictionId} spellCheck={false} />
        ) : null}
        <TextAreaField label={t('safety.action.note')} hint={t('safety.action.noteHint')} value={form.note} onChange={set('note')} error={fieldErrors.note} rows={3} maxLength={5000} />
        <CheckboxField label={t('safety.action.notifyUser')} hint={t('safety.action.notifyHint')} checked={form.notifyUser} onChange={set('notifyUser')} />
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('safety.action.confirmTitle', { action: label('actionType', confirming.action) })}
          body={confirming.action === 'ban' ? t('safety.action.confirmBan') : t('safety.action.confirmBody', { action: label('actionType', confirming.action) })}
          confirmLabel={label('actionType', confirming.action)}
          tone={['ban', 'suspend', 'restrict', 'remove_content'].includes(confirming.action) ? 'danger' : 'primary'}
          confirmPhrase={confirming.action === 'ban' ? t('safety.action.banPhrase') : undefined}
          onConfirm={() => apply(confirming)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
