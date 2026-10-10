'use client';

import Link from 'next/link';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import type { CaseDetail } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { CaseStatusBadge, label, SeverityBadge } from './labels';

/** Subject context: profile, risk score, automated signals, prior cases and appeals. */
export function CaseContext({ c }: { c: CaseDetail }) {
  return (
    <>
      {c.profile ? (
        <section className="section card" aria-labelledby="case-profile">
          <h2 id="case-profile" className="card__title">{t('safety.context.profile')}</h2>
          <DefinitionList
            items={[
              { label: t('safety.context.displayName'), value: c.profile.display_name ?? '—' },
              { label: t('safety.context.accountStatus'), value: label('userStatus', c.profile.status) },
              { label: t('safety.context.verification'), value: label('verificationLevel', c.profile.verification_level) },
              { label: t('safety.context.country'), value: c.profile.country_code ?? '—' },
              { label: t('safety.context.memberSince'), value: formatDateTime(c.profile.created_at) },
              { label: t('safety.context.bio'), value: c.profile.bio ? <span className="pre-wrap">{c.profile.bio}</span> : '—' },
            ]}
          />
        </section>
      ) : null}
      {c.subject_user_id ? <RiskScorePanel userId={c.subject_user_id} /> : null}

      <section className="section" aria-labelledby="case-signals">
        <h2 id="case-signals">{t('safety.context.signals')}</h2>
        {c.safetyEvents.length === 0 ? (
          <EmptyState message={t('safety.context.noSignals')} />
        ) : (
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th scope="col">{t('safety.context.when')}</th>
                  <th scope="col">{t('safety.context.signal')}</th>
                  <th scope="col">{t('safety.context.signalSource')}</th>
                  <th scope="col" className="num">{t('safety.context.score')}</th>
                  <th scope="col">{t('safety.context.ref')}</th>
                </tr>
              </thead>
              <tbody>
                {c.safetyEvents.map((e) => (
                  <tr key={e.id}>
                    <td><time dateTime={e.created_at}>{formatDateTime(e.created_at)}</time></td>
                    <td>{label('signal', e.signal)}</td>
                    <td><code>{e.source}</code></td>
                    <td className="num">{formatNumber(e.score, 3)}</td>
                    <td>{e.ref_type ?? '—'}{e.ref_id ? <><br /><code className="muted">{e.ref_id}</code></> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="case-prior">
        <h2 id="case-prior">{t('safety.context.priorCases')}</h2>
        {c.priorCases.length === 0 ? (
          <EmptyState message={t('safety.context.noPriorCases')} />
        ) : (
          <ul>
            {c.priorCases.map((p) => (
              <li key={p.id}>
                <Link href={`/moderation/cases/${p.id}`}>{label('category', p.category)}</Link>{' '}
                <SeverityBadge severity={p.severity} /> <CaseStatusBadge status={p.status} />{' '}
                <span className="muted">{formatDateTime(p.opened_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="case-appeals">
        <h2 id="case-appeals">{t('safety.context.appeals')}</h2>
        {c.appeals.length === 0 ? (
          <EmptyState message={t('safety.context.noAppeals')} />
        ) : (
          <ul className="stack safety-evidence">
            {c.appeals.map((a) => (
              <li key={a.id} className="card">
                <p>
                  <strong>{label('actionType', a.action)}</strong> · {label('appealStatus', a.status)} · <span className="muted">{formatDateTime(a.created_at)}</span>
                </p>
                <p className="pre-wrap">{a.statement}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * The rolling risk score is only exposed through the user detail endpoint (users.view + users.view_safety_history);
 * the case payload does not include it.
 */
function RiskScorePanel({ userId }: { userId: string }) {
  const { can } = useSession();
  const allowed = can('users.view') && can('users.view_safety_history');
  return (
    <section className="section card" aria-labelledby="case-risk">
      <h2 id="case-risk" className="card__title">{t('safety.risk.title')}</h2>
      {allowed ? <RiskScoreBody userId={userId} /> : <p className="muted">{t('safety.risk.noPermission')}</p>}
    </section>
  );
}

function RiskScoreBody({ userId }: { userId: string }) {
  const { api } = useSession();
  const data = useResource(() => api.safety.userSafety(userId), [api, userId]);
  if (data.status === 'loading') return <LoadingState />;
  if (data.status === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;
  const risk = data.data.safety?.riskScore ?? null;
  if (!risk) return <p className="muted">{t('safety.risk.none')}</p>;
  const signals = Object.entries(risk.components?.signals ?? {});
  return (
    <>
      <DefinitionList
        items={[
          { label: t('safety.risk.score'), value: <strong>{formatPercent(risk.score)}</strong> },
          { label: t('safety.risk.reporters'), value: formatNumber(risk.components?.reporters ?? 0) },
          { label: t('safety.risk.signals'), value: signals.length ? signals.map(([k, n]) => `${label('signal', k)} × ${formatNumber(n)}`).join(', ') : '—' },
          { label: t('safety.risk.computedAt'), value: formatDateTime(risk.computed_at) },
        ]}
      />
      <p className="muted">{t('safety.risk.explain')}</p>
    </>
  );
}
