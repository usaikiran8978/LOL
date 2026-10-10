'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { JsonDiff } from '@/components/editors/JsonDiff';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/fields';
import { EmptyState, ErrorState, FormError, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { AuditLogEntry, AuditQuery } from '@/lib/api/admin-api';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import { useAdminApi } from '@/lib/auth/session';
import { validate, type FieldErrors } from '@/lib/forms/validate';

// Mirrors the API's query schema (apps/api audit-logs.controller) — it is not exported from @amora/shared.
const filterSchema = z.object({
  actorType: z.enum(['user', 'admin', 'system']).optional(),
  actorId: z.uuid().optional(),
  action: z.string().max(100).optional(),
  targetType: z.string().max(50).optional(),
  targetId: z.string().max(100).optional(),
});

type Filters = { actorType: string; actorId: string; action: string; targetType: string; targetId: string };
const EMPTY: Filters = { actorType: '', actorId: '', action: '', targetType: '', targetId: '' };
const PAGE_SIZE = 50;

const clean = (f: Filters) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || undefined]));

export function AuditLogsPage() {
  const api = useAdminApi();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<AuditQuery>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let current = true;
    setStatus('loading');
    setMoreError(null);
    api.audit.list({ ...applied, limit: PAGE_SIZE }).then(
      (page) => {
        if (!current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setStatus('ready');
      },
      (e: unknown) => {
        if (!current) return;
        setError(e);
        setStatus('error');
      },
    );
    return () => { current = false; };
  }, [api, applied, nonce]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const page = await api.audit.list({ ...applied, cursor, limit: PAGE_SIZE });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setMoreError(e);
    } finally {
      setMoreBusy(false);
    }
  }, [api, applied, cursor]);

  function apply() {
    const v = validate(filterSchema, clean(draft));
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setExpanded(null);
    setApplied(v.data);
  }

  function reset() {
    setDraft(EMPTY);
    setErrors({});
    setApplied({});
  }

  const set = (k: keyof Filters) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <>
      <PageHeader title={t('audit.title')} intro={t('audit.intro')} />
      <form
        className="filters"
        aria-label={t('audit.filters')}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <SelectField
          label={t('audit.actorType')}
          value={draft.actorType}
          onChange={set('actorType')}
          placeholder={t('common.all')}
          options={(['user', 'admin', 'system'] as const).map((a) => ({ value: a, label: t(`audit.actorTypes.${a}`) }))}
          className="field--inline"
        />
        <TextField label={t('audit.actorId')} value={draft.actorId} onChange={set('actorId')} error={errors.actorId} className="field--inline" spellCheck={false} />
        <TextField label={t('audit.action')} hint={t('audit.actionHint')} value={draft.action} onChange={set('action')} error={errors.action} className="field--inline" />
        <TextField label={t('audit.targetType')} value={draft.targetType} onChange={set('targetType')} error={errors.targetType} className="field--inline" />
        <TextField label={t('audit.targetId')} value={draft.targetId} onChange={set('targetId')} error={errors.targetId} className="field--inline" />
        <div className="row">
          <button type="submit" className="btn btn--primary btn--md">{t('common.apply')}</button>
          <Button variant="secondary" onClick={reset}>{t('common.reset')}</Button>
        </div>
      </form>

      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState error={error} onRetry={() => setNonce((n) => n + 1)} /> : null}
      {status === 'ready' && items.length === 0 ? <EmptyState message={t('audit.empty')} /> : null}
      {status === 'ready' && items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="table__caption">{t('audit.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('audit.time')}</th>
                <th scope="col">{t('audit.actor')}</th>
                <th scope="col">{t('audit.action')}</th>
                <th scope="col">{t('audit.target')}</th>
                <th scope="col">{t('audit.ip')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <Fragment key={e.id}>
                  <tr>
                    <td><time dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleString()}</time></td>
                    <td>{t(`audit.actorTypes.${e.actorType}`)}<br /><code className="muted">{e.actorId ?? '—'}</code></td>
                    <td><code>{e.action}</code>{e.reason ? <div className="muted">{t('audit.reason')}: {e.reason}</div> : null}</td>
                    <td>{e.targetType ?? '—'}<br /><code className="muted">{e.targetId ?? ''}</code></td>
                    <td>{e.ip ?? '—'}</td>
                    <td className="table__actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={expanded === e.id}
                        aria-controls={`diff-${e.id}`}
                        onClick={() => setExpanded((x) => (x === e.id ? null : e.id))}
                      >
                        {expanded === e.id ? t('audit.hideChanges') : t('audit.viewChanges')}
                      </Button>
                    </td>
                  </tr>
                  {expanded === e.id ? (
                    <tr id={`diff-${e.id}`}>
                      <td colSpan={6}>
                        <h3>{t('audit.diffTitle', { action: e.action })}</h3>
                        {e.requestId ? <p className="muted">{t('common.requestId', { id: e.requestId })}</p> : null}
                        <JsonDiff before={e.before} after={e.after} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
          {moreError ? <FormError message={errorMessage(moreError)} requestId={requestIdOf(moreError)} /> : null}
          <div className="row pager">
            {cursor ? (
              <Button variant="secondary" onClick={() => void loadMore()} disabled={moreBusy}>{moreBusy ? t('common.loadingMore') : t('common.loadMore')}</Button>
            ) : (
              <span className="muted">{t('common.endOfList')}</span>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
