'use client';

import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { t } from '@/i18n';
import type { ExperimentStatus, ExperimentTransition } from '@/lib/api/modules/analytics';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { TRANSITIONS } from './experimentSchema';

const TONES: Record<ExperimentStatus, BadgeTone> = { draft: 'neutral', running: 'success', paused: 'warning', completed: 'info', archived: 'neutral' };

export function ExperimentStatusBadge({ status }: { status: ExperimentStatus }) {
  return <Badge tone={TONES[status]}>{t(`analytics.experiments.statuses.${status}`)}</Badge>;
}

type Action = 'start' | 'resume' | 'pause' | 'complete' | 'archive';

function actionFor(from: ExperimentStatus, to: ExperimentTransition): Action {
  if (to === 'running') return from === 'draft' ? 'start' : 'resume';
  if (to === 'paused') return 'pause';
  return to === 'completed' ? 'complete' : 'archive';
}

/** Lifecycle buttons for the transitions the API allows from the current status; every one is confirmed. */
export function ExperimentTransitions({ experimentKey, status, onDone }: { experimentKey: string; status: ExperimentStatus; onDone: () => void }) {
  const api = useAdminApi();
  const { can } = useSession();
  const notify = useNotify();
  const [pending, setPending] = useState<ExperimentTransition | null>(null);
  if (!can('experiments.manage')) return null;
  const options = TRANSITIONS[status];
  if (options.length === 0) return null;
  const pendingAction = pending ? actionFor(status, pending) : null;
  // Completing and archiving are final (no transition back), so the admin types the key.
  const irreversible = pending === 'completed' || pending === 'archived';

  return (
    <>
      {options.map((to) => {
        const action = actionFor(status, to);
        const label = t(`analytics.experiments.actions.${action}`);
        return (
          <Button
            key={to}
            variant={to === 'completed' || to === 'archived' ? 'danger' : 'secondary'}
            size="sm"
            onClick={() => setPending(to)}
            aria-label={t('analytics.experiments.actionFor', { action: label, key: experimentKey })}
          >
            {label}
          </Button>
        );
      })}
      {pending && pendingAction ? (
        <ConfirmDialog
          title={t(`analytics.experiments.confirm.${pendingAction}Title`, { key: experimentKey })}
          body={t(`analytics.experiments.confirm.${pendingAction}Body`)}
          confirmLabel={t(`analytics.experiments.actions.${pendingAction}`)}
          tone={irreversible ? 'danger' : 'primary'}
          confirmPhrase={irreversible ? experimentKey : undefined}
          onConfirm={async () => {
            await api.analytics.transitionExperiment(experimentKey, pending);
            notify(t('analytics.experiments.transitioned', { key: experimentKey, status: t(`analytics.experiments.statuses.${pending}`) }));
            onDone();
          }}
          onClose={() => setPending(null)}
        />
      ) : null}
    </>
  );
}
