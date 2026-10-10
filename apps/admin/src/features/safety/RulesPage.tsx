'use client';

import { useState } from 'react';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/fields';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { ModerationRule } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { enumOptions, label } from './labels';
import { ModerationTabs } from './ModerationTabs';
import { RuleDialog } from './RuleDialog';
import { EDITABLE_TYPES, EVALUATED_TYPES } from './ruleForms';

export function RulesPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="moderation.rules.manage" permissions={admin?.permissions ?? []}>
      <RulesList />
    </RequirePermission>
  );
}

function summary(r: ModerationRule): string {
  const c = r.config ?? {};
  if (r.rule_type === 'keyword' && Array.isArray(c.terms)) return t('safety.rules.termsCount', { count: c.terms.length });
  if (r.rule_type === 'regex' && typeof c.pattern === 'string') return c.pattern;
  return JSON.stringify(c);
}

function RulesList() {
  const { api } = useSession();
  const data = useResource(() => api.safety.rules(), [api]);
  const [type, setType] = useState('');
  const [editing, setEditing] = useState<ModerationRule | 'new' | null>(null);
  const rows = data.status === 'success' ? data.data.filter((r) => r.rule_type !== 'auto_action' && (!type || r.rule_type === type)) : [];

  return (
    <>
      <PageHeader title={t('safety.rules.title')} intro={t('safety.rules.intro')} actions={<Button onClick={() => setEditing('new')}>{t('safety.rules.new')}</Button>} />
      <ModerationTabs />
      <div className="filters">
        <SelectField label={t('safety.rules.type')} value={type} onChange={setType} placeholder={t('common.all')} options={enumOptions('ruleType', EDITABLE_TYPES)} className="field--inline" />
      </div>
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && rows.length === 0 ? <EmptyState message={t('safety.rules.empty')} /> : null}
      {data.status === 'success' && rows.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="table__caption">{t('safety.rules.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('safety.rules.key')}</th>
                <th scope="col">{t('safety.rules.type')}</th>
                <th scope="col">{t('safety.rules.scope')}</th>
                <th scope="col">{t('safety.rules.config')}</th>
                <th scope="col">{t('safety.rules.locale')}</th>
                <th scope="col">{t('safety.rules.active')}</th>
                <th scope="col" className="num">{t('safety.rules.version')}</th>
                <th scope="col">{t('safety.rules.updatedAt')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.key}</code></td>
                  <td>
                    {label('ruleType', r.rule_type)}
                    {!EVALUATED_TYPES.includes(r.rule_type) ? <div className="muted">{t('safety.rules.notEvaluatedShort')}</div> : null}
                  </td>
                  <td>{label('ruleScope', r.scope)}</td>
                  <td>
                    <code>{summary(r)}</code>
                    {r.rule_type === 'keyword' || r.rule_type === 'regex' ? (
                      <div className="muted">{label('ruleAction', String(r.config.action ?? ''))} · {label('signal', String(r.config.signal ?? ''))} · {formatNumber(Number(r.config.score), 2)}</div>
                    ) : null}
                  </td>
                  <td>{r.locale ?? t('safety.rules.allLocales')}</td>
                  <td><BoolBadge value={r.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                  <td className="num">{formatNumber(r.version)}</td>
                  <td><time dateTime={r.updated_at}>{formatDateTime(r.updated_at)}</time></td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`${t('common.edit')} ${r.key}`}>{t('common.edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <RuleDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={data.reload} /> : null}
    </>
  );
}
