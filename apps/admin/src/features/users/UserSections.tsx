'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { BoolBadge, EmptyState } from '@/components/ui/states';
import { t, tDynamic } from '@/i18n';
import type { UserDetail } from '@/lib/api/modules/users';
import { useSession } from '@/lib/auth/session';
import { formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { statusLabel, verificationLabel } from './labels';

type Props = { user: UserDetail };

export function Card({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="card" aria-labelledby={id}>
      <h2 className="card__title" id={id}>{title}</h2>
      {children}
    </section>
  );
}

/** Contact details and date of birth are rendered only with `users.view_pii`, whatever the API returned. */
export function AccountCard({ user }: Props) {
  const { can } = useSession();
  const pii = can('users.view_pii');
  const hidden = <span className="muted">{t('users.detail.piiHidden')}</span>;
  const locked = user.locked_until && new Date(user.locked_until).getTime() > Date.now();
  return (
    <Card title={t('users.detail.account')} id="user-account">
      <DefinitionList
        items={[
          { label: t('users.detail.userId'), value: <code>{user.id}</code> },
          { label: t('users.status'), value: statusLabel(user.status) },
          user.status_reason ? { label: t('users.detail.statusReason'), value: <code>{user.status_reason}</code> } : null,
          user.status_until ? { label: t('users.detail.statusUntil'), value: formatDateTime(user.status_until) } : null,
          { label: t('users.email'), value: pii ? (user.email ?? '—') : hidden },
          { label: t('users.phone'), value: pii ? (user.phone_e164 ?? '—') : hidden },
          { label: t('users.detail.dateOfBirth'), value: pii ? formatDate(user.date_of_birth) : hidden },
          { label: t('users.detail.emailVerified'), value: user.email_verified_at ? formatDateTime(user.email_verified_at) : t('users.detail.notVerified') },
          { label: t('users.detail.phoneVerified'), value: user.phone_verified_at ? formatDateTime(user.phone_verified_at) : t('users.detail.notVerified') },
          { label: t('users.country'), value: user.country_code ?? '—' },
          { label: t('users.detail.locale'), value: user.locale },
          { label: t('users.createdAt'), value: formatDateTime(user.created_at) },
          { label: t('users.detail.lastLogin'), value: formatDateTime(user.last_login_at) },
          { label: t('users.lastActive'), value: formatDateTime(user.last_active_at) },
          { label: t('users.detail.failedLogins'), value: formatNumber(user.failed_login_count) },
          { label: t('users.detail.lockedUntil'), value: locked ? formatDateTime(user.locked_until) : t('users.detail.notLocked') },
        ]}
      />
    </Card>
  );
}

export function ProfileCard({ user }: Props) {
  const p = user.profile;
  return (
    <Card title={t('users.detail.profile')} id="user-profile">
      {!p ? (
        <EmptyState message={t('users.detail.noProfile')} />
      ) : (
        <DefinitionList
          items={[
            { label: t('users.displayName'), value: p.display_name },
            { label: t('users.verification'), value: verificationLabel(p.verification_level) },
            { label: t('users.detail.moderationStatus'), value: <code>{p.moderation_status}</code> },
            { label: t('users.detail.discoverable'), value: <BoolBadge value={p.is_discoverable} /> },
            { label: t('users.detail.incognito'), value: <BoolBadge value={p.incognito} /> },
            { label: t('users.detail.completeness'), value: formatPercent(p.completeness_score / 100, 0) },
            p.snoozed_until ? { label: t('users.detail.snoozedUntil'), value: formatDateTime(p.snoozed_until) } : null,
            { label: t('users.detail.homeCountry'), value: p.home_country_code ?? '—' },
            { label: t('users.detail.profession'), value: p.profession ?? '—' },
            { label: t('users.detail.employer'), value: p.employer ?? '—' },
            { label: t('users.detail.school'), value: p.school ?? '—' },
            { label: t('users.detail.bio'), value: p.bio ? <span className="pre-wrap">{p.bio}</span> : '—' },
          ]}
        />
      )}
    </Card>
  );
}

export function ActivityCard({ user }: Props) {
  return (
    <Card title={t('users.detail.activity')} id="user-activity">
      <div className="kpis">
        <div className="kpi">
          <span className="kpi__label">{t('users.detail.reportsAgainst')}</span>
          <span className="kpi__value num">{formatNumber(user.counts.reportsAgainst)}</span>
        </div>
        <div className="kpi">
          <span className="kpi__label">{t('users.detail.reportsBy')}</span>
          <span className="kpi__value num">{formatNumber(user.counts.reportsBy)}</span>
        </div>
        <div className="kpi">
          <span className="kpi__label">{t('users.detail.matches')}</span>
          <span className="kpi__value num">{formatNumber(user.counts.matches)}</span>
        </div>
      </div>
    </Card>
  );
}

export function SessionsCard({ user }: Props) {
  return (
    <Card title={t('users.detail.sessions')} id="user-sessions">
      {user.sessions.length === 0 ? <EmptyState message={t('users.detail.noSessions')} /> : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('users.detail.platform')}</th>
                <th scope="col">{t('users.detail.device')}</th>
                <th scope="col">{t('users.detail.appVersion')}</th>
                <th scope="col">{t('users.detail.sessionStarted')}</th>
                <th scope="col">{t('users.detail.sessionLastUsed')}</th>
              </tr>
            </thead>
            <tbody>
              {user.sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.platform ?? '—'}</td>
                  <td>{s.model ?? '—'}</td>
                  <td>{s.app_version ?? '—'}</td>
                  <td>{formatDateTime(s.created_at)}</td>
                  <td>{formatDateTime(s.last_used_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function RestrictionsCard({ user }: Props) {
  return (
    <Card title={t('users.detail.restrictions')} id="user-restrictions">
      {user.restrictions.length === 0 ? <EmptyState message={t('users.detail.noRestrictions')} /> : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('users.detail.restrictionKind')}</th>
                <th scope="col">{t('users.detail.startsAt')}</th>
                <th scope="col">{t('users.detail.endsAt')}</th>
              </tr>
            </thead>
            <tbody>
              {user.restrictions.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.kind}</code></td>
                  <td>{formatDateTime(r.starts_at)}</td>
                  <td>{r.ends_at ? formatDateTime(r.ends_at) : t('users.detail.noEnd')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function VerificationCard({ user }: Props) {
  return (
    <Card title={t('users.detail.verificationRequests')} id="user-verification">
      {user.verification.length === 0 ? <EmptyState message={t('users.detail.noVerification')} /> : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('users.detail.kind')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('users.detail.submittedAt')}</th>
                <th scope="col">{t('users.detail.decidedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {user.verification.map((v) => (
                <tr key={v.id}>
                  <td>{tDynamic(`users.verificationLevels.${v.kind}`, v.kind)}</td>
                  <td><code>{v.status}</code></td>
                  <td>{formatDateTime(v.submitted_at)}</td>
                  <td>{formatDateTime(v.decided_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The API returns `safety: null` without `users.view_safety_history`; the UI checks the permission too. */
export function SafetyCard({ user }: Props) {
  const { can } = useSession();
  const safety = can('users.view_safety_history') ? user.safety : null;
  return (
    <Card title={t('users.detail.safety')} id="user-safety">
      {!safety ? <p className="muted">{t('users.detail.safetyHidden')}</p> : (
        <div className="stack">
          <p>
            <strong>{t('users.detail.riskScore')}: </strong>
            {safety.riskScore ? (
              <>
                <span className="num">{formatNumber(safety.riskScore.score)}</span>{' '}
                <span className="muted">({t('users.detail.riskComputed', { date: formatDateTime(safety.riskScore.computed_at) })})</span>
              </>
            ) : <span className="muted">{t('users.detail.noRiskScore')}</span>}
          </p>
          <h3>{t('users.detail.cases')}</h3>
          {safety.cases.length === 0 ? <EmptyState message={t('users.detail.noCases')} /> : (
            <div className="table-wrap">
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th scope="col">{t('users.detail.caseId')}</th>
                    <th scope="col">{t('users.detail.category')}</th>
                    <th scope="col">{t('users.detail.severity')}</th>
                    <th scope="col">{t('common.status')}</th>
                    <th scope="col">{t('users.detail.openedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {safety.cases.map((c) => (
                    <tr key={c.id}>
                      <td><code>{c.id}</code></td>
                      <td>{c.category}</td>
                      <td>{c.severity}</td>
                      <td>{c.status}</td>
                      <td>{formatDateTime(c.opened_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>{t('users.detail.actions')}</h3>
          {safety.actions.length === 0 ? <EmptyState message={t('users.detail.noActions')} /> : (
            <div className="table-wrap">
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th scope="col">{t('users.detail.action')}</th>
                    <th scope="col">{t('users.detail.reason')}</th>
                    <th scope="col">{t('users.detail.at')}</th>
                    <th scope="col">{t('users.detail.reversed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {safety.actions.map((a) => (
                    <tr key={a.id}>
                      <td>{tDynamic(`users.actions.${a.action}`, a.action)}</td>
                      <td><code>{a.reason_key}</code></td>
                      <td>{formatDateTime(a.created_at)}</td>
                      <td>
                        {a.reversed_at
                          ? <Badge tone="info">{t('users.detail.reversedAt', { date: formatDateTime(a.reversed_at) })}</Badge>
                          : <Badge>{t('users.detail.notReversed')}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
