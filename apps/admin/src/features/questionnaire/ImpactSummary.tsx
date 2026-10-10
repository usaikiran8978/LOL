'use client';

import { t } from '@/i18n';
import type { ImpactReport } from '@/lib/api/modules/questionnaire';
import { formatNumber } from '@/lib/format';
import { IssuesList } from './shared';

const signed = (n: number | undefined, digits = 3) => (n === undefined ? '—' : `${n > 0 ? '+' : ''}${formatNumber(n, digits)}`);

/** Impact analysis returned by GET versions/:id/impact (also embedded in publish history snapshots). */
export function ImpactSummary({ impact, showIssues = true }: { impact: Partial<ImpactReport>; showIssues?: boolean }) {
  const kpis: Array<{ label: string; value: string; warn?: boolean }> = [
    { label: t('questionnaire.impact.usersWithCurrentAnswer'), value: formatNumber(impact.usersWithCurrentAnswer) },
    { label: t('questionnaire.impact.answersCarriedOver'), value: formatNumber(impact.answersCarriedOver) },
    { label: t('questionnaire.impact.usersReasked'), value: formatNumber(impact.usersReasked), warn: (impact.usersReasked ?? 0) > 0 },
    { label: t('questionnaire.impact.newlyRequiredForUsers'), value: formatNumber(impact.newlyRequiredForUsers), warn: (impact.newlyRequiredForUsers ?? 0) > 0 },
    { label: t('questionnaire.impact.weightChange'), value: signed(impact.weightChange, 2) },
    { label: t('questionnaire.impact.rules'), value: t('questionnaire.impact.rulesValue', { before: formatNumber(impact.rulesBefore), after: formatNumber(impact.rulesAfter) }) },
    { label: t('questionnaire.impact.sampledPairs'), value: formatNumber(impact.sampledPairs) },
    { label: t('questionnaire.impact.avgScoreDelta'), value: signed(impact.avgScoreDelta) },
    { label: t('questionnaire.impact.avgAbsScoreDelta'), value: formatNumber(impact.avgAbsScoreDelta, 3) },
  ];
  return (
    <div className="stack">
      {impact.previousVersionId === null ? <p className="muted">{t('questionnaire.impact.firstPublish')}</p> : null}
      <div className="kpis">
        {kpis.map((k) => (
          <div key={k.label} className="kpi">
            <p className="kpi__label">{k.label}</p>
            <p className="kpi__value">{k.value}</p>
            {k.warn ? <p className="field__hint">{t('questionnaire.impact.attention')}</p> : null}
          </div>
        ))}
      </div>
      {showIssues && impact.issues ? <IssuesList issues={impact.issues} title={t('questionnaire.workflow.issuesTitle')} /> : null}
    </div>
  );
}
