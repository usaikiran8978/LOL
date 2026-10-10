'use client';

import { adminVerificationDecision } from '@amora/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { SelectField } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { VerificationDetail } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { formatDateTime, formatPercent } from '@/lib/format';
import { validate } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';
import { label } from './labels';

/** Suggested rejection reasons (the API stores any key up to 60 chars and defaults to `not_matching`). */
export const REJECTION_REASONS = ['not_matching', 'pose_not_followed', 'face_not_visible', 'poor_quality', 'document_invalid', 'suspected_fraud'] as const;
const DECIDABLE = ['processing', 'needs_review'];

export function VerificationDetailPage({ requestId }: { requestId: string }) {
  const { admin } = useSession();
  return (
    <RequirePermission permission="verification.view" permissions={admin?.permissions ?? []}>
      <Detail requestId={requestId} />
    </RequirePermission>
  );
}

function Detail({ requestId }: { requestId: string }) {
  const { api } = useSession();
  const data = useResource(() => api.safety.verification(requestId), [api, requestId]);
  return (
    <>
      <p><Link href="/verification">{t('safety.verification.back')}</Link></p>
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' ? <RequestView r={data.data} reload={data.reload} /> : null}
    </>
  );
}

function RequestView({ r, reload }: { r: VerificationDetail; reload: () => void }) {
  const { can } = useSession();
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null);
  const open = DECIDABLE.includes(r.status);
  const canDecide = can('verification.decide');

  return (
    <>
      <PageHeader
        title={t('safety.verification.detailTitle', { kind: label('verificationKind', r.kind) })}
        intro={r.user_id}
        actions={
          open && canDecide ? (
            <>
              <Button onClick={() => setDeciding('approved')}>{t('safety.verification.approve')}</Button>
              <Button variant="danger" onClick={() => setDeciding('rejected')}>{t('safety.verification.reject')}</Button>
            </>
          ) : null
        }
      />
      {!open ? <p className="alert alert--info">{t('safety.verification.alreadyDecided', { status: label('verificationStatus', r.status) })}</p> : null}
      {open && !canDecide ? <p className="muted">{t('safety.verification.noDecide')}</p> : null}
      <section className="card" aria-labelledby="ver-summary">
        <h2 id="ver-summary" className="card__title">{t('safety.verification.summary')}</h2>
        <DefinitionList
          items={[
            { label: t('safety.verification.status'), value: label('verificationStatus', r.status) },
            { label: t('safety.verification.user'), value: <code>{r.user_id}</code> },
            { label: t('safety.verification.provider'), value: <code>{r.provider}</code> },
            { label: t('safety.verification.pose'), value: label('pose', r.pose_challenge) },
            { label: t('safety.verification.liveness'), value: r.liveness_score === null ? '—' : formatPercent(r.liveness_score) },
            { label: t('safety.verification.faceMatch'), value: r.face_match_score === null ? '—' : formatPercent(r.face_match_score) },
            { label: t('safety.verification.documentCountry'), value: r.document_country ?? '—' },
            { label: t('safety.verification.submitted'), value: formatDateTime(r.submitted_at) },
            { label: t('safety.verification.decided'), value: formatDateTime(r.decided_at) },
            { label: t('safety.verification.rejectionReason'), value: r.rejection_reason_key ? label('rejectionReason', r.rejection_reason_key) : '—' },
            { label: t('safety.verification.expires'), value: formatDateTime(r.expires_at) },
          ]}
        />
      </section>

      <div className="grid grid--2 section">
        <section aria-labelledby="ver-evidence">
          <h2 id="ver-evidence">{t('safety.verification.evidence')}</h2>
          {r.evidence === null ? (
            <p className="alert alert--info">{t('safety.verification.evidenceHidden')}</p>
          ) : r.evidence.length === 0 ? (
            <EmptyState message={r.evidence_purged_at ? t('safety.verification.evidencePurged', { at: formatDateTime(r.evidence_purged_at) }) : t('safety.verification.noEvidence')} />
          ) : (
            <>
              <p className="muted">{t('safety.verification.evidenceExpiry')}</p>
              <ul className="safety-gallery">
                {r.evidence.map((url, i) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <img src={url} alt={t('safety.verification.evidenceAlt', { n: i + 1 })} className="safety-thumb" />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section aria-labelledby="ver-photos">
          <h2 id="ver-photos">{t('safety.verification.profilePhotos')}</h2>
          {r.profilePhotos.length === 0 ? (
            <EmptyState message={t('safety.verification.noPhotos')} />
          ) : (
            <ul className="safety-gallery">
              {r.profilePhotos.map((p, i) => (
                <li key={p.id}><img src={p.url} alt={t('safety.verification.photoAlt', { n: i + 1 })} className="safety-thumb" /></li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {deciding ? <DecisionDialog r={r} decision={deciding} onClose={() => setDeciding(null)} onDone={reload} /> : null}
    </>
  );
}

function DecisionDialog({ r, decision, onClose, onDone }: { r: VerificationDetail; decision: 'approved' | 'rejected'; onClose: () => void; onDone: () => void }) {
  const { api } = useSession();
  const notify = useNotify();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();

  async function confirm(): Promise<boolean> {
    // A rejection always carries an explicit reason (shown to the user); the API would otherwise default it.
    if (decision === 'rejected' && !reason) {
      setReasonError(t('validation.required'));
      return false;
    }
    const v = validate(adminVerificationDecision, { decision, rejectionReasonKey: decision === 'rejected' ? reason : undefined });
    if (!v.ok) {
      setReasonError(v.errors.rejectionReasonKey ?? t('validation.invalid'));
      return false;
    }
    setReasonError(undefined);
    await api.safety.decideVerification(r.id, v.data);
    notify(decision === 'approved' ? t('safety.verification.approvedDone') : t('safety.verification.rejectedDone'));
    onDone();
    return true;
  }

  return (
    <ConfirmDialog
      title={decision === 'approved' ? t('safety.verification.approveTitle') : t('safety.verification.rejectTitle')}
      body={decision === 'approved' ? t('safety.verification.approveBody', { kind: label('verificationKind', r.kind) }) : t('safety.verification.rejectBody')}
      confirmLabel={decision === 'approved' ? t('safety.verification.approve') : t('safety.verification.reject')}
      tone={decision === 'rejected' ? 'danger' : 'primary'}
      onConfirm={confirm}
      onClose={onClose}
    >
      {decision === 'rejected' ? (
        <SelectField
          label={t('safety.verification.rejectionReason')}
          value={reason}
          onChange={setReason}
          error={reasonError}
          placeholder={t('safety.create.choose')}
          options={REJECTION_REASONS.map((k) => ({ value: k, label: label('rejectionReason', k) }))}
          required
        />
      ) : null}
    </ConfirmDialog>
  );
}
