'use client';

import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { CheckboxField } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { WebhookEventRow } from '@/lib/api/modules/billing';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { BillingSection } from './BillingSection';
import { providerLabel } from './labels';

/** The endpoint returns the newest N events (no cursor), so the console asks for the maximum page size. */
const LIMIT = 100;

type WebhookState = 'processed' | 'failed' | 'pending';
const STATE_TONES: Record<WebhookState, BadgeTone> = { processed: 'success', failed: 'danger', pending: 'info' };

/** Mirrors the API's "failed" filter: not processed and at least one attempt made. */
export const webhookState = (w: WebhookEventRow): WebhookState => (w.processed_at ? 'processed' : w.attempts > 0 ? 'failed' : 'pending');

export function WebhooksPage() {
  return (
    <BillingSection permission="billing.view">
      <WebhooksView />
    </BillingSection>
  );
}

function WebhooksView() {
  const api = useAdminApi();
  const notify = useNotify();
  const canReplay = useSession().can('billing.plans.manage');
  const [failedOnly, setFailedOnly] = useState(false);
  const data = useResource(() => api.billing.webhooks({ limit: LIMIT, failed: failedOnly }), [api, failedOnly]);
  const [replaying, setReplaying] = useState<WebhookEventRow | null>(null);

  return (
    <>
      <PageHeader title={t('billing.webhooks.title')} intro={t('billing.webhooks.intro')} actions={<Button variant="secondary" onClick={data.reload}>{t('common.refresh')}</Button>} />
      <div className="filters">
        <CheckboxField label={t('billing.webhooks.failedOnly')} checked={failedOnly} onChange={setFailedOnly} />
      </div>
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.length === 0 ? <EmptyState message={failedOnly ? t('billing.webhooks.emptyFailed') : t('billing.webhooks.empty')} /> : null}
      {data.status === 'success' && data.data.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('billing.webhooks.received')}</th>
                  <th scope="col">{t('billing.webhooks.provider')}</th>
                  <th scope="col">{t('billing.webhooks.eventType')}</th>
                  <th scope="col">{t('billing.webhooks.eventId')}</th>
                  <th scope="col">{t('billing.webhooks.state')}</th>
                  <th scope="col" className="num">{t('billing.webhooks.attempts')}</th>
                  <th scope="col">{t('billing.webhooks.processed')}</th>
                  <th scope="col">{t('billing.webhooks.lastError')}</th>
                  <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((w) => {
                  const state = webhookState(w);
                  return (
                    <tr key={w.id} className={state === 'failed' ? 'is-danger' : undefined}>
                      <td>{formatDateTime(w.received_at)}</td>
                      <td>{providerLabel(w.provider)}</td>
                      <td><code>{w.event_type}</code></td>
                      <td><code>{w.provider_event_id}</code></td>
                      <td><Badge tone={STATE_TONES[state]}>{t(`billing.webhooks.states.${state}`)}</Badge></td>
                      <td className="num">{formatNumber(w.attempts, 0)}</td>
                      <td>{formatDateTime(w.processed_at)}</td>
                      <td className="pre-wrap">{w.last_error ?? '—'}</td>
                      <td className="table__actions">
                        {canReplay ? (
                          <Button variant="ghost" size="sm" onClick={() => setReplaying(w)} aria-label={t('billing.webhooks.replayEvent', { id: w.provider_event_id })}>{t('billing.webhooks.replay')}</Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted">{t('billing.webhooks.limitNote', { count: LIMIT })}</p>
        </>
      ) : null}
      {replaying ? (
        <ConfirmDialog
          title={t('billing.webhooks.replayTitle')}
          body={t('billing.webhooks.replayBody', { type: replaying.event_type, id: replaying.provider_event_id })}
          confirmLabel={t('billing.webhooks.replay')}
          onConfirm={async () => {
            await api.billing.replayWebhook(replaying.id);
            notify(t('billing.webhooks.replayed'));
            data.reload();
          }}
          onClose={() => setReplaying(null)}
        />
      ) : null}
    </>
  );
}
