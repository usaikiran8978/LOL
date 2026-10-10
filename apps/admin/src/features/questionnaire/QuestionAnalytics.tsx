'use client';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import type { QuestionVersion, VersionAnalytics } from '@/lib/api/modules/questionnaire';
import { useAdminApi } from '@/lib/auth/session';
import { formatNumber, formatPercent } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { VersionStatusBadge } from './shared';

/** Per-version answer counts, completion rate and option distribution (current answers only). */
export function QuestionAnalyticsView({ questionId, versions }: { questionId: string; versions: QuestionVersion[] }) {
  const api = useAdminApi();
  const data = useResource(() => api.questionnaire.analytics(questionId), [api, questionId]);

  return (
    <section className="section" aria-labelledby="qd-analytics">
      <h2 id="qd-analytics">{t('questionnaire.analytics.title')}</h2>
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.versions.length === 0 ? <EmptyState message={t('questionnaire.analytics.empty')} /> : null}
      {data.status === 'success' && data.data.versions.length > 0 ? (
        <div className="stack">
          <div className="kpis">
            <div className="kpi">
              <p className="kpi__label">{t('questionnaire.analytics.eligibleUsers')}</p>
              <p className="kpi__value">{formatNumber(data.data.eligibleUsers)}</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('questionnaire.versions.version')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col" className="num">{t('questionnaire.analytics.answered')}</th>
                  <th scope="col" className="num">{t('questionnaire.analytics.skipped')}</th>
                  <th scope="col" className="num">{t('questionnaire.analytics.dealbreakers')}</th>
                  <th scope="col" className="num">{t('questionnaire.analytics.completionRate')}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.versions.map((v) => (
                  <tr key={v.versionId}>
                    <td>{t('questionnaire.versions.versionN', { version: v.version })}</td>
                    <td><VersionStatusBadge status={v.status} /></td>
                    <td className="num">{formatNumber(v.answered)}</td>
                    <td className="num">{formatNumber(v.skipped)}</td>
                    <td className="num">{formatNumber(v.dealbreakers)}</td>
                    <td className="num">{formatPercent(v.completionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.data.versions.filter((v) => v.distribution.length > 0).map((v) => (
            <Distribution key={v.versionId} stats={v} version={versions.find((x) => x.id === v.versionId)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Distribution({ stats, version }: { stats: VersionAnalytics; version: QuestionVersion | undefined }) {
  const label = (key: string) => {
    const o = version?.options.find((x) => x.key === key);
    return (o && version?.optionTranslations.find((tr) => tr.optionId === o.id && tr.locale === 'en')?.label) || key;
  };
  // Follow the version's option order; keys no longer present come last.
  const order = (key: string) => {
    const i = version?.options.findIndex((o) => o.key === key) ?? -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const rows = [...stats.distribution].sort((a, b) => order(a.optionKey) - order(b.optionKey));
  const caption = t('questionnaire.analytics.distribution', { version: stats.version });
  return (
    <div className="table-wrap">
      <table className="table table--compact">
        <caption className="table__caption">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t('questionnaire.analytics.option')}</th>
            <th scope="col" className="num">{t('questionnaire.analytics.count')}</th>
            <th scope="col" className="num">{t('questionnaire.analytics.share')}</th>
            <th scope="col"><span className="visually-hidden">{t('questionnaire.analytics.shareBar')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.optionKey}>
              <td dir="auto">{label(d.optionKey)} <code>{d.optionKey}</code></td>
              <td className="num">{formatNumber(d.count)}</td>
              <td className="num">{formatPercent(d.share)}</td>
              <td><meter min={0} max={1} value={Math.min(1, d.share)} aria-label={`${label(d.optionKey)}: ${formatPercent(d.share)}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
