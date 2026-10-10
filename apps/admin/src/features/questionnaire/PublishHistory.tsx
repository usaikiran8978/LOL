'use client';

import { Fragment, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/states';
import { t, tDynamic } from '@/i18n';
import type { ImpactReport, PublishEvent } from '@/lib/api/modules/questionnaire';
import { formatDateTime, formatNumber } from '@/lib/format';
import { ImpactSummary } from './ImpactSummary';

function parseImpact(raw: PublishEvent['impact_summary']): Partial<ImpactReport> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const v: unknown = JSON.parse(raw);
      return v && typeof v === 'object' ? (v as Partial<ImpactReport>) : null;
    } catch {
      return null;
    }
  }
  return raw;
}

/** Publish / schedule / rollback / activation events with the impact snapshot recorded at the time. */
export function PublishHistory({ history }: { history: PublishEvent[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="section" aria-labelledby="qd-history">
      <h2 id="qd-history">{t('questionnaire.history.title')}</h2>
      {history.length === 0 ? <EmptyState message={t('questionnaire.history.empty')} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('questionnaire.history.when')}</th>
                <th scope="col">{t('questionnaire.history.action')}</th>
                <th scope="col">{t('questionnaire.versions.version')}</th>
                <th scope="col">{t('questionnaire.history.by')}</th>
                <th scope="col" className="num">{t('questionnaire.impact.usersReasked')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {history.map((e) => {
                const impact = parseImpact(e.impact_summary);
                return (
                  <Fragment key={e.id}>
                    <tr>
                      <td>{formatDateTime(e.performed_at)}</td>
                      <td>{tDynamic(`questionnaire.history.actions.${e.action}`, e.action)}</td>
                      <td>{t('questionnaire.versions.versionN', { version: e.version })}</td>
                      <td>{e.performed_by ? <code>{e.performed_by}</code> : t('questionnaire.history.system')}</td>
                      <td className="num">{impact ? formatNumber(impact.usersReasked) : '—'}</td>
                      <td className="table__actions">
                        {impact ? (
                          <Button variant="ghost" size="sm" aria-expanded={open === e.id} aria-controls={`impact-${e.id}`} onClick={() => setOpen((x) => (x === e.id ? null : e.id))}>
                            {open === e.id ? t('questionnaire.history.hideImpact') : t('questionnaire.history.showImpact')}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                    {impact && open === e.id ? (
                      <tr id={`impact-${e.id}`}>
                        <td colSpan={6}><ImpactSummary impact={impact} /></td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
