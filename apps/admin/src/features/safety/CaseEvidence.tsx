'use client';

import { EmptyState } from '@/components/ui/states';
import { t } from '@/i18n';
import type { CaseEvidence, CaseReport } from '@/lib/api/modules/safety';
import { formatDateTime } from '@/lib/format';
import { label } from './labels';

/** Reports attached to the case (there is no separate reports listing endpoint; reports live on their case). */
export function CaseReportsSection({ reports }: { reports: CaseReport[] }) {
  return (
    <section className="section" aria-labelledby="case-reports">
      <h2 id="case-reports">{t('safety.detail.reports', { count: reports.length })}</h2>
      {reports.length === 0 ? (
        <EmptyState message={t('safety.detail.noReports')} />
      ) : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('safety.detail.reportedAt')}</th>
                <th scope="col">{t('safety.detail.reason')}</th>
                <th scope="col">{t('safety.detail.target')}</th>
                <th scope="col">{t('safety.detail.reporter')}</th>
                <th scope="col">{t('safety.detail.details')}</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td><time dateTime={r.created_at}>{formatDateTime(r.created_at)}</time></td>
                  <td>{label('category', r.reason)}</td>
                  <td>{label('targetType', r.target_type)}<br /><code className="muted">{r.target_id ?? '—'}</code></td>
                  <td><code>{r.reporter_id ?? t('safety.detail.deletedUser')}</code></td>
                  <td className="pre-wrap">{r.details ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const isRedacted = (s: unknown) => !!s && typeof s === 'object' && (s as { redacted?: unknown }).redacted === true;

function MessageSnapshot({ snapshot }: { snapshot: Record<string, unknown> }) {
  const body = typeof snapshot.body === 'string' ? snapshot.body : null;
  return (
    <>
      <blockquote className="pre-wrap">{body ?? t('safety.evidence.noText')}</blockquote>
      <p className="muted">
        {typeof snapshot.sentAt === 'string' ? t('safety.evidence.sentAt', { at: formatDateTime(snapshot.sentAt) }) : null}
        {typeof snapshot.senderId === 'string' ? <> · {t('safety.evidence.sender')} <code>{snapshot.senderId}</code></> : null}
      </p>
    </>
  );
}

function EvidenceBody({ e }: { e: CaseEvidence }) {
  if (isRedacted(e.snapshot)) return <p className="alert alert--info">{t('safety.evidence.redacted')}</p>;
  if (e.kind === 'message' && e.snapshot && typeof e.snapshot === 'object') return <MessageSnapshot snapshot={e.snapshot as Record<string, unknown>} />;
  return <pre className="code pre-wrap">{JSON.stringify(e.snapshot, null, 2)}</pre>;
}

/** Immutable evidence snapshots. Message text is redacted by the API without `moderation.view_messages`. */
export function CaseEvidenceSection({ evidence }: { evidence: CaseEvidence[] }) {
  return (
    <section className="section" aria-labelledby="case-evidence">
      <h2 id="case-evidence">{t('safety.evidence.title', { count: evidence.length })}</h2>
      {evidence.length === 0 ? (
        <EmptyState message={t('safety.evidence.empty')} />
      ) : (
        <ul className="stack safety-evidence">
          {evidence.map((e, i) => (
            <li key={e.id} className="card">
              <h3 className="card__title">{t('safety.evidence.item', { n: i + 1, kind: label('evidenceKind', e.kind) })}</h3>
              <p className="muted">
                {t('safety.evidence.capturedAt', { at: formatDateTime(e.captured_at) })}
                {e.ref_id ? <> · <code>{e.ref_id}</code></> : null}
              </p>
              <EvidenceBody e={e} />
              {e.url ? (
                <p>
                  <a href={e.url} target="_blank" rel="noopener noreferrer">
                    {e.kind === 'media' ? <img src={e.url} alt={t('safety.evidence.mediaAlt', { n: i + 1 })} className="safety-thumb" /> : null}
                    <span className={e.kind === 'media' ? 'visually-hidden' : undefined}>{t('safety.evidence.openFile')}</span>
                  </a>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
