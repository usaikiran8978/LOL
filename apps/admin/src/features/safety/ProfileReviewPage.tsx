'use client';

import { adminMediaReview } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { ReviewMedia } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { validate } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';
import { label } from './labels';
import { ModerationTabs } from './ModerationTabs';

/** Each list is capped by `limit` (max 100) oldest-first; the endpoint has no cursor. */
const LIMIT = 50;

type Target = { kind: 'media' | 'prompt' | 'profile'; id: string; name: string };
type Decision = 'approved' | 'rejected';

export function ProfileReviewPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="profiles.review" permissions={admin?.permissions ?? []}>
      <ReviewQueue />
    </RequirePermission>
  );
}

function MediaPreview({ m, n }: { m: ReviewMedia; n: number }) {
  const alt = t('safety.review.mediaAlt', { n, kind: label('mediaKind', m.kind) });
  if (m.kind === 'video') return <video src={m.url} controls preload="metadata" className="safety-thumb" aria-label={alt} />;
  if (m.kind === 'voice') return <audio src={m.url} controls preload="none" aria-label={alt} />;
  return <img src={m.url} alt={alt} className="safety-thumb" />;
}

function DecisionButtons({ target, onDecide }: { target: Target; onDecide: (t: Target, d: Decision) => void }) {
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => onDecide(target, 'approved')} aria-label={`${t('safety.review.approve')} ${target.name}`}>{t('safety.review.approve')}</Button>
      <Button variant="danger" size="sm" onClick={() => onDecide(target, 'rejected')} aria-label={`${t('safety.review.reject')} ${target.name}`}>{t('safety.review.reject')}</Button>
    </>
  );
}

function ReviewQueue() {
  const { api } = useSession();
  const data = useResource(() => api.safety.reviewQueue({ limit: LIMIT }), [api]);
  const [deciding, setDeciding] = useState<{ target: Target; decision: Decision } | null>(null);
  const decide = (target: Target, decision: Decision) => setDeciding({ target, decision });

  return (
    <>
      <PageHeader title={t('safety.review.title')} intro={t('safety.review.intro')} />
      <ModerationTabs />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' ? (
        <>
          <section className="section" aria-labelledby="review-media">
            <h2 id="review-media">{t('safety.review.media', { count: data.data.media.length })}</h2>
            {data.data.media.length === 0 ? <EmptyState message={t('safety.review.mediaEmpty')} /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('safety.review.preview')}</th>
                      <th scope="col">{t('safety.review.user')}</th>
                      <th scope="col">{t('safety.review.status')}</th>
                      <th scope="col">{t('safety.review.uploaded')}</th>
                      <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.media.map((m, i) => (
                      <tr key={m.id}>
                        <td><MediaPreview m={m} n={i + 1} /></td>
                        <td><code>{m.user_id}</code></td>
                        <td>{label('mediaKind', m.kind)} · {label('mediaStatus', m.moderation_status)}</td>
                        <td>{formatDateTime(m.created_at)}</td>
                        <td className="table__actions"><DecisionButtons target={{ kind: 'media', id: m.id, name: t('safety.review.mediaAlt', { n: i + 1, kind: label('mediaKind', m.kind) }) }} onDecide={decide} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section" aria-labelledby="review-prompts">
            <h2 id="review-prompts">{t('safety.review.prompts', { count: data.data.prompts.length })}</h2>
            {data.data.prompts.length === 0 ? <EmptyState message={t('safety.review.promptsEmpty')} /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('safety.review.answer')}</th>
                      <th scope="col">{t('safety.review.user')}</th>
                      <th scope="col">{t('safety.review.submitted')}</th>
                      <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.prompts.map((p, i) => (
                      <tr key={p.id}>
                        <td className="pre-wrap">{p.answer}</td>
                        <td><code>{p.user_id}</code></td>
                        <td>{formatDateTime(p.created_at)}</td>
                        <td className="table__actions"><DecisionButtons target={{ kind: 'prompt', id: p.id, name: t('safety.review.promptN', { n: i + 1 }) }} onDecide={decide} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section" aria-labelledby="review-profiles">
            <h2 id="review-profiles">{t('safety.review.profiles', { count: data.data.profiles.length })}</h2>
            <p className="muted">{t('safety.review.profilesIntro')}</p>
            {data.data.profiles.length === 0 ? <EmptyState message={t('safety.review.profilesEmpty')} /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('safety.review.displayName')}</th>
                      <th scope="col">{t('safety.review.bio')}</th>
                      <th scope="col">{t('safety.review.updated')}</th>
                      <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.profiles.map((p) => (
                      <tr key={p.user_id}>
                        <td>{p.display_name ?? '—'}<br /><code className="muted">{p.user_id}</code></td>
                        <td className="pre-wrap">{p.bio ?? '—'}</td>
                        <td>{formatDateTime(p.updated_at)}</td>
                        <td className="table__actions"><DecisionButtons target={{ kind: 'profile', id: p.user_id, name: p.display_name ?? p.user_id }} onDecide={decide} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
      {deciding ? <ReviewDialog target={deciding.target} decision={deciding.decision} onClose={() => setDeciding(null)} onDone={data.reload} /> : null}
    </>
  );
}

function ReviewDialog({ target, decision, onClose, onDone }: { target: Target; decision: Decision; onClose: () => void; onDone: () => void }) {
  const { api } = useSession();
  const notify = useNotify();
  const [reasonKey, setReasonKey] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();

  async function confirm(): Promise<boolean> {
    const v = validate(adminMediaReview, { decision, reasonKey: reasonKey.trim() || undefined });
    if (!v.ok) {
      setReasonError(v.errors.reasonKey);
      return false;
    }
    if (target.kind === 'media') await api.safety.reviewMedia(target.id, v.data);
    else if (target.kind === 'prompt') await api.safety.reviewPrompt(target.id, v.data);
    else await api.safety.reviewProfile(target.id, v.data);
    notify(decision === 'approved' ? t('safety.review.approvedDone') : t('safety.review.rejectedDone'));
    onDone();
    return true;
  }

  return (
    <ConfirmDialog
      title={t(decision === 'approved' ? 'safety.review.approveTitle' : 'safety.review.rejectTitle', { name: target.name })}
      body={t(decision === 'approved' ? 'safety.review.approveBody' : 'safety.review.rejectBody')}
      confirmLabel={decision === 'approved' ? t('safety.review.approve') : t('safety.review.reject')}
      tone={decision === 'rejected' ? 'danger' : 'primary'}
      onConfirm={confirm}
      onClose={onClose}
    >
      {target.kind === 'media' ? (
        <TextField label={t('safety.review.reasonKey')} hint={t('safety.review.reasonHint')} value={reasonKey} onChange={setReasonKey} error={reasonError} maxLength={60} spellCheck={false} />
      ) : null}
    </ConfirmDialog>
  );
}
