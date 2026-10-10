'use client';

import type { AdminMatchingConfigInput } from '@amora/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { MatchingConfigSummary } from '@/lib/api/modules/matching';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { detailToInput } from './configForm';
import { versionLabel } from './shared';

/**
 * Column defaults of matching_config_versions (apps/api/migrations/0007_matching.sql + 0013) with no weights, rules
 * or intent pairs: the starting point when no version exists yet to copy from.
 */
export const SCHEMA_DEFAULTS: AdminMatchingConfigInput = {
  minCompatibility: 0, candidatePoolLimit: 2000, recommendationBatchSize: 50, dailyCuratedCount: 10, behavioralWeight: 0, diversityMaxShare: 1,
  diversityDimensions: [], repeatSuppressionDays: 30, safetyExcludeThreshold: 1, safetyDownrankThreshold: 1, safetyDownrankFactor: 1,
  missingAnswerPolicy: 'neutral', importanceMultipliers: [0, 1, 2, 4], defaultImportance: 1, intentDefaultScore: 0.5, minConfidence: 0,
  topFactorCount: 3, differenceThreshold: 0.5, recommendationTtlHours: 24, weights: {}, rankingRules: [], intentMatrix: [],
};

type Source = 'published' | 'defaults' | `version:${string}`;

/** New draft: a server-side copy of the published version, a copy of any other version, or the schema defaults. */
export function CreateDraftDialog({ versions, onClose }: { versions: MatchingConfigSummary[]; onClose: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const router = useRouter();
  const { busy, error, fieldErrors, send } = useFormSubmit();
  const published = versions.find((v) => v.status === 'published');
  const [source, setSource] = useState<Source>(published ? 'published' : versions[0] ? `version:${versions[0].id}` : 'defaults');

  const options = [
    ...(published ? [{ value: 'published', label: t('matching.create.fromPublished', { version: published.version }) }] : []),
    ...versions.filter((v) => v.status !== 'published').map((v) => ({ value: `version:${v.id}`, label: t('matching.create.fromVersion', { version: v.version }) })),
    { value: 'defaults', label: t('matching.create.fromDefaults') },
  ];

  async function create() {
    let created: { id: string; version: number } | undefined;
    const ok = await send(async () => {
      if (source === 'published') created = await api.matching.createDraft();
      else if (source === 'defaults') created = await api.matching.createDraft(SCHEMA_DEFAULTS);
      else created = await api.matching.createDraft(detailToInput(await api.matching.config(source.slice('version:'.length))));
    });
    if (ok && created) {
      notify(t('matching.create.created', { version: created.version }));
      onClose();
      router.push(`/matching/configs/${created.id}`);
    }
  }

  return (
    <FormDialog title={t('matching.create.title')} onClose={onClose} onSubmit={() => void create()} busy={busy} error={error} fieldErrors={fieldErrors} submitLabel={t('common.create')}>
      <SelectField label={t('matching.create.source')} hint={t('matching.create.sourceHint')} value={source} onChange={(v) => setSource(v as Source)} options={options} />
      {source === 'published' && published ? <p className="muted">{t('matching.create.publishedNote', { version: versionLabel(published.version) })}</p> : null}
    </FormDialog>
  );
}
