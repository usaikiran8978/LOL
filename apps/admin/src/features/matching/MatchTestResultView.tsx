'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { BoolBadge } from '@/components/ui/states';
import { t, tDynamic } from '@/i18n';
import type { CompatibilityCategoryRow, MatchExclusion, MatchFactor, MatchRuleTrace, MatchTestResult } from '@/lib/api/modules/matching';
import { formatNumber, formatPercent } from '@/lib/format';
import { categoryLabel, versionLabel } from './shared';

const dash = '—';
const n = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? dash : formatNumber(v, digits));

/** Renders the POST /admin/matching/test response exactly as returned (no client-side re-scoring). */
export function MatchTestResultView({ result, categories }: { result: MatchTestResult; categories: CompatibilityCategoryRow[] | null }) {
  const byKey = new Map((categories ?? []).map((c) => [c.key, c]));
  const byId = new Map((categories ?? []).map((c) => [c.id, c]));
  const catName = (key: string) => categoryLabel(byKey.get(key), key);
  const compat = result.result.excluded ? null : result.result;
  const exclusion = result.exclusion ?? (result.result.excluded ? result.result : null);

  return (
    <section className="section stack" aria-labelledby="match-test-result">
      <h2 id="match-test-result">{t('matching.test.resultTitle')}</h2>
      <div className="kpis">
        <Kpi label={t('matching.test.configUsed')} value={versionLabel(result.configVersion)} />
        <Kpi label={t('matching.test.eligible')} value={<BoolBadge value={result.eligible} />} />
        <Kpi label={t('matching.test.compatibility')} value={compat ? n(compat.compatibility) : t('matching.test.excluded')} />
        <Kpi label={t('matching.test.confidence')} value={compat ? formatPercent(compat.confidence) : dash} />
        <Kpi label={t('matching.test.finalScore')} value={n(result.ranking?.finalScore, 4)} />
        <Kpi label={t('matching.test.distance')} value={compat?.distanceKm != null ? t('matching.test.km', { km: formatNumber(compat.distanceKm, 1) }) : dash} />
      </div>

      {exclusion ? <ExclusionBox exclusion={exclusion} eligibility={!!result.exclusion} /> : null}

      {compat ? (
        <div className="card">
          <h3 className="card__title">{t('matching.test.categoryScores')}</h3>
          {Object.keys(compat.categoryScores).length === 0 ? (
            <p className="muted">{t('matching.test.noCategoryScores')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th scope="col">{t('matching.categories.category')}</th>
                    <th scope="col">{t('matching.test.score')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(compat.categoryScores).sort(([, a], [, b]) => b - a).map(([key, score]) => (
                    <tr key={key}>
                      <th scope="row">{catName(key)} <code>{key}</code></th>
                      <td className="num">{n(score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid grid--2 section">
            <Factors title={t('matching.test.topFactors')} factors={compat.topFactors} catName={catName} />
            <Factors title={t('matching.test.differences')} factors={compat.differences} catName={catName} />
          </div>
          <p className="muted">{t('matching.test.sharedInterests', { count: compat.sharedInterestIds.length })}</p>
        </div>
      ) : null}

      <div className="card">
        <h3 className="card__title">{t('matching.test.questions')}</h3>
        {result.questions.length === 0 ? (
          <p className="muted">{t('matching.test.noQuestions')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th scope="col">{t('matching.test.question')}</th>
                  <th scope="col">{t('matching.categories.category')}</th>
                  <th scope="col">{t('matching.test.weight')}</th>
                  <th scope="col">{t('matching.test.answerA')}</th>
                  <th scope="col">{t('matching.test.answerB')}</th>
                  <th scope="col">{t('matching.test.importanceA')}</th>
                  <th scope="col">{t('matching.test.importanceB')}</th>
                  <th scope="col">{t('matching.test.similarity')}</th>
                  <th scope="col">{t('matching.test.score')}</th>
                </tr>
              </thead>
              <tbody>
                {result.questions.map((q) => {
                  const cat = q.categoryId ? byId.get(q.categoryId) : undefined;
                  return (
                    <tr key={q.questionKey} className={q.dealbreakerA || q.dealbreakerB ? 'is-warning' : undefined}>
                      <th scope="row"><code>{q.questionKey}</code></th>
                      <td>{cat ? categoryLabel(cat, cat.key) : q.categoryId ? <code>{q.categoryId}</code> : dash}</td>
                      <td className="num">{n(q.weight)}</td>
                      <td><AnswerState answered={q.answeredA} stale={q.staleA} dealbreaker={q.dealbreakerA} /></td>
                      <td><AnswerState answered={q.answeredB} stale={q.staleB} dealbreaker={q.dealbreakerB} /></td>
                      <td>{q.importanceA === null ? dash : tDynamic(`matching.importance.l${q.importanceA}`, String(q.importanceA))}</td>
                      <td>{q.importanceB === null ? dash : tDynamic(`matching.importance.l${q.importanceB}`, String(q.importanceB))}</td>
                      <td className="num">{n(q.similarity, 3)}</td>
                      <td className="num">{n(q.score, 3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Rules title={t('matching.test.positiveRules')} rules={result.positiveRules} />
      <Rules title={t('matching.test.negativeRules')} rules={result.negativeRules} />
      <Rules title={t('matching.test.dealBreakers')} rules={result.dealBreakers} />

      <div className="card">
        <h3 className="card__title">{t('matching.test.ranking')}</h3>
        {result.ranking ? (
          <dl className="dl">
            <div className="dl__row"><dt>{t('matching.test.finalScore')}</dt><dd>{n(result.ranking.finalScore, 4)}</dd></div>
            <div className="dl__row"><dt>{t('matching.test.behaviorScore')}</dt><dd>{n(result.ranking.behaviorScore, 3)}</dd></div>
            <div className="dl__row"><dt>{t('matching.test.riskScore')}</dt><dd>{n(result.ranking.riskScore, 3)}</dd></div>
            <div className="dl__row">
              <dt>{t('matching.test.appliedRules')}</dt>
              <dd>{result.ranking.appliedRules.length ? result.ranking.appliedRules.map((r) => <code key={r}>{r} </code>) : t('common.none')}</dd>
            </div>
            <div className="dl__row">
              <dt>{t('matching.test.dropped')}</dt>
              <dd>
                {result.ranking.dropped.length
                  ? result.ranking.dropped.map((d) => <Badge key={`${d.candidateId}:${d.reason}`} tone="danger">{tDynamic(`matching.dropReason.${d.reason}`, d.reason)}</Badge>)
                  : t('common.none')}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="muted">{t('matching.test.noRanking')}</p>
        )}
      </div>
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="kpi">
      <p className="kpi__label">{label}</p>
      <p className="kpi__value">{value}</p>
    </div>
  );
}

function ExclusionBox({ exclusion, eligibility }: { exclusion: MatchExclusion; eligibility: boolean }) {
  return (
    <div className="alert alert--error" role="status">
      <p>
        <strong>{eligibility ? t('matching.test.ineligible') : t('matching.test.excludedByScoring')}</strong>{' '}
        {tDynamic(`matching.exclusion.${exclusion.reason}`, exclusion.reason)} (<code>{exclusion.reason}</code>)
      </p>
      {exclusion.detail && Object.keys(exclusion.detail).length ? <pre className="code">{JSON.stringify(exclusion.detail, null, 2)}</pre> : null}
    </div>
  );
}

function Factors({ title, factors, catName }: { title: string; factors: MatchFactor[]; catName: (k: string) => string }) {
  return (
    <div>
      <h4>{title}</h4>
      {factors.length === 0 ? (
        <p className="muted">{t('common.none')}</p>
      ) : (
        <ul>
          {factors.map((f) => (
            <li key={f.categoryKey}>
              {catName(f.categoryKey)} — {n(f.score)} <code>{f.reasonKey}</code>
              {Object.keys(f.params).length ? <> <code>{JSON.stringify(f.params)}</code></> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnswerState({ answered, stale, dealbreaker }: { answered: boolean; stale: boolean; dealbreaker: boolean }) {
  return (
    <span className="row">
      {answered ? <Badge tone={stale ? 'warning' : 'success'}>{stale ? t('matching.test.stale') : t('matching.test.answered')}</Badge> : <Badge>{t('matching.test.unanswered')}</Badge>}
      {dealbreaker ? <Badge tone="danger">{t('matching.test.dealbreaker')}</Badge> : null}
    </span>
  );
}

function Rules({ title, rules }: { title: string; rules: MatchRuleTrace[] }) {
  return (
    <div className="card">
      <h3 className="card__title">{title}</h3>
      {rules.length === 0 ? (
        <p className="muted">{t('matching.test.noRules')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('matching.test.ruleType')}</th>
                <th scope="col">{t('matching.test.source')}</th>
                <th scope="col">{t('matching.test.target')}</th>
                <th scope="col">{t('matching.test.scoreDelta')}</th>
                <th scope="col">{t('matching.test.exclusionRule')}</th>
                <th scope="col">{t('matching.test.bidirectional')}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={`${r.sourceQuestionId}:${r.targetQuestionId}:${i}`}>
                  <td>{tDynamic(`matching.questionRuleType.${r.ruleType}`, r.ruleType)}</td>
                  <td><code>{r.sourceQuestionId}</code> {r.sourceOptionKey ? <code>= {r.sourceOptionKey}</code> : <span className="muted">{t('matching.test.anyAnswer')}</span>}</td>
                  <td><code>{r.targetQuestionId}</code> {r.targetOptionKey ? <code>= {r.targetOptionKey}</code> : <span className="muted">{t('matching.test.anyAnswer')}</span>}</td>
                  <td className="num">{n(r.scoreDelta, 3)}</td>
                  <td><BoolBadge value={r.isExclusion} /></td>
                  <td><BoolBadge value={r.isBidirectional} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
