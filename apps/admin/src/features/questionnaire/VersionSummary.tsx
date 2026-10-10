'use client';

import { BoolBadge } from '@/components/ui/states';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { t, tDynamic } from '@/i18n';
import type { QuestionVersion } from '@/lib/api/modules/questionnaire';
import { formatDateTime, formatNumber } from '@/lib/format';
import { answerTypeLabel, compatName, questionName, type QuestionnaireRefs } from './shared';

/** Read-only view of a version (published, superseded, scheduled, or a draft the admin cannot edit). */
export function VersionSummary({ version: v, refs }: { version: QuestionVersion; refs: QuestionnaireRefs }) {
  const yesNo = (b: boolean) => <BoolBadge value={b} />;
  const range = (a: number | null, b: number | null) => (a === null && b === null ? null : `${formatNumber(a)} – ${formatNumber(b)}`);
  return (
    <div className="stack">
      <section className="card" aria-labelledby="vs-props">
        <h2 id="vs-props" className="card__title">{t('questionnaire.editor.basics')}</h2>
        <DefinitionList
          items={[
            { label: t('questionnaire.editor.answerType'), value: answerTypeLabel(v.answerType) },
            { label: t('questionnaire.editor.weight'), value: formatNumber(v.weight) },
            { label: t('questionnaire.editor.compatCategory'), value: compatName(refs.compatCategories, v.compatibilityCategoryId) },
            { label: t('questionnaire.editor.isScored'), value: yesNo(v.isScored) },
            { label: t('questionnaire.editor.isRequired'), value: yesNo(v.isRequired) },
            { label: t('questionnaire.editor.allowSkip'), value: yesNo(v.allowSkip) },
            { label: t('questionnaire.editor.allowImportance'), value: yesNo(v.allowImportance) },
            { label: t('questionnaire.editor.allowDealbreaker'), value: yesNo(v.allowDealbreaker) },
            { label: t('questionnaire.editor.visibility'), value: tDynamic(`questionnaire.visibility.${v.visibility}`, v.visibility) },
            range(v.minSelections, v.maxSelections) ? { label: t('questionnaire.preview.selections'), value: range(v.minSelections, v.maxSelections) } : null,
            range(v.scaleMin, v.scaleMax) ? { label: t('questionnaire.preview.scale'), value: `${range(v.scaleMin, v.scaleMax)}${v.scaleStep ? ` (${t('questionnaire.editor.scaleStep')} ${formatNumber(v.scaleStep)})` : ''}` } : null,
            range(v.numericMin, v.numericMax) ? { label: t('questionnaire.preview.numeric'), value: range(v.numericMin, v.numericMax) } : null,
            v.textMaxLength !== null ? { label: t('questionnaire.editor.textMaxLength'), value: formatNumber(v.textMaxLength) } : null,
            { label: t('questionnaire.carryOver.mode'), value: tDynamic(`questionnaire.carryOver.modes.${v.answerCarryOver}`, v.answerCarryOver) },
            { label: t('questionnaire.editor.changeNote'), value: v.changeNote ?? '—' },
            { label: t('questionnaire.versions.createdAt'), value: formatDateTime(v.createdAt) },
            { label: t('questionnaire.versions.publishedAt'), value: formatDateTime(v.publishedAt) },
            v.effectiveAt ? { label: t('questionnaire.versions.effectiveAt'), value: formatDateTime(v.effectiveAt) } : null,
          ]}
        />
      </section>

      <section className="card" aria-labelledby="vs-text">
        <h2 id="vs-text" className="card__title">{t('translations.legend')}</h2>
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('translations.locale')}</th>
                <th scope="col">{t('questionnaire.editor.text')}</th>
                <th scope="col">{t('questionnaire.editor.helpText')}</th>
                {v.answerType === 'scale' ? <th scope="col">{t('questionnaire.editor.scaleLabels')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {v.translations.map((tr) => (
                <tr key={tr.locale}>
                  <td><code>{tr.locale}</code></td>
                  <td dir="auto">{tr.text}</td>
                  <td dir="auto">{tr.helpText ?? '—'}</td>
                  {v.answerType === 'scale' ? <td dir="auto">{tr.scaleMinLabel ?? '—'} / {tr.scaleMaxLabel ?? '—'}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {v.options.length ? (
        <section className="card" aria-labelledby="vs-options">
          <h2 id="vs-options" className="card__title">{t('questionnaire.options.title')}</h2>
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th scope="col">{t('questionnaire.options.key')}</th>
                  <th scope="col">{t('questionnaire.options.labels')}</th>
                  <th scope="col" className="num">{t('questionnaire.options.numericValue')}</th>
                  <th scope="col">{t('questionnaire.options.exclusive')}</th>
                </tr>
              </thead>
              <tbody>
                {v.options.map((o) => (
                  <tr key={o.id}>
                    <td><code>{o.key}</code></td>
                    <td dir="auto">{v.optionTranslations.filter((tr) => tr.optionId === o.id).map((tr) => `${tr.locale}: ${tr.label}`).join(' · ')}</td>
                    <td className="num">{formatNumber(o.numericValue)}</td>
                    <td>{yesNo(o.isExclusive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="vs-logic">
        <h2 id="vs-logic" className="card__title">{t('questionnaire.versions.logic')}</h2>
        <h3>{t('questionnaire.editor.targeting')}</h3>
        {v.targeting ? <pre className="code pre-wrap">{JSON.stringify(v.targeting, null, 2)}</pre> : <p className="muted">{t('questionnaire.editor.noTargeting')}</p>}
        <h3>{t('questionnaire.conditions.title')}</h3>
        {v.conditions.length ? (
          <ul className="steps">
            {v.conditions.map((c) => (
              <li key={c.id}>
                {t('questionnaire.conditions.groupN', { n: c.groupNo })}: {questionName(refs.questions, c.dependsOnQuestionId)} — {tDynamic(`questionnaire.conditions.ops.${c.operator}`, c.operator)}
                {c.optionKeys?.length ? <> <code>{c.optionKeys.join(', ')}</code></> : null}
                {c.numberA !== null ? <> {formatNumber(c.numberA)}</> : null}
                {c.numberB !== null ? <> – {formatNumber(c.numberB)}</> : null}
              </li>
            ))}
          </ul>
        ) : <p className="muted">{t('questionnaire.conditions.empty')}</p>}
        <h3>{t('questionnaire.rules.title')}</h3>
        {v.rules.length ? (
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th scope="col">{t('questionnaire.rules.sourceOption')}</th>
                  <th scope="col">{t('questionnaire.rules.targetQuestion')}</th>
                  <th scope="col">{t('questionnaire.rules.targetOption')}</th>
                  <th scope="col">{t('questionnaire.rules.ruleType')}</th>
                  <th scope="col" className="num">{t('questionnaire.rules.scoreDelta')}</th>
                  <th scope="col">{t('questionnaire.rules.isExclusion')}</th>
                  <th scope="col">{t('questionnaire.rules.isBidirectional')}</th>
                </tr>
              </thead>
              <tbody>
                {v.rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.sourceOptionKey ? <code>{r.sourceOptionKey}</code> : t('questionnaire.rules.anyAnswer')}</td>
                    <td>{r.targetQuestionId === v.questionId ? t('questionnaire.rules.thisQuestion') : questionName(refs.questions, r.targetQuestionId)}</td>
                    <td>{r.targetOptionKey ? <code>{r.targetOptionKey}</code> : t('questionnaire.rules.anyOption')}</td>
                    <td>{tDynamic(`questionnaire.rules.types.${r.ruleType}`, r.ruleType)}</td>
                    <td className="num">{formatNumber(r.scoreDelta, 3)}</td>
                    <td>{yesNo(r.isExclusion)}</td>
                    <td>{yesNo(r.isBidirectional)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t('questionnaire.rules.empty')}</p>}
        {v.optionMappings.length ? (
          <>
            <h3>{t('questionnaire.carryOver.title')}</h3>
            <ul className="steps">
              {v.optionMappings.map((m) => <li key={`${m.fromOptionKey}-${m.toOptionKey}`}><code>{m.fromOptionKey}</code> → <code>{m.toOptionKey}</code></li>)}
            </ul>
          </>
        ) : null}
      </section>
    </div>
  );
}
