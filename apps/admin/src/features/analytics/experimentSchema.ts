import { z } from 'zod';
import { t } from '@/i18n';
import { EXPERIMENT_SURFACES, type ExperimentRow, type ExperimentStatus, type ExperimentTransition, type ExperimentUpsertBody } from '@/lib/api/modules/analytics';
import { parseJsonText, type FieldErrors } from '@/lib/forms/validate';

/*
 * Mirrors `experimentInput` and the key check in apps/api/src/modules/analytics/analytics.controller.ts plus the
 * business rules in experiments.service.ts `upsert()` — none of it is exported from @amora/shared (contract gap).
 */
export const experimentKeySchema = z.string().regex(/^[a-z0-9_.]{2,64}$/);

export const experimentInputSchema = z.object({
  surface: z.enum(EXPERIMENT_SURFACES),
  hypothesis: z.string().max(2000).optional(),
  segmentKey: z.string().max(64).nullable().default(null),
  trafficPct: z.number().int().min(1).max(100),
  primaryMetric: z.string().regex(/^[a-z_]{2,64}$/),
  variants: z.array(z.object({
    key: z.string().regex(/^[a-z0-9_]{1,40}$/),
    allocation: z.number().int().min(1).max(100),
    isControl: z.boolean().default(false),
    config: z.record(z.string(), z.unknown()).default({}),
  })).min(2).max(6),
});

/** Allowed status transitions (experiments.service.ts `transition()`). */
export const TRANSITIONS: Record<ExperimentStatus, ExperimentTransition[]> = {
  draft: ['running', 'archived'],
  running: ['paused', 'completed'],
  paused: ['running', 'completed'],
  completed: ['archived'],
  archived: [],
};

export interface VariantForm {
  /** Stable React key for the row (not sent). */
  uid: string;
  key: string;
  allocation: number | undefined;
  isControl: boolean;
  configText: string;
}

export interface ExperimentForm {
  key: string;
  surface: ExperimentRow['surface'];
  hypothesis: string;
  segmentKey: string;
  trafficPct: number | undefined;
  primaryMetric: string;
  variants: VariantForm[];
}

let uidSeq = 0;
export const newUid = () => `v${++uidSeq}`;

export function blankVariant(isControl = false, key = '', allocation?: number): VariantForm {
  return { uid: newUid(), key, allocation, isControl, configText: '{}' };
}

export function emptyExperimentForm(): ExperimentForm {
  return {
    key: '', surface: 'other', hypothesis: '', segmentKey: '', trafficPct: 100, primaryMetric: '',
    variants: [blankVariant(true, 'control', 50), blankVariant(false, 'treatment', 50)],
  };
}

export function experimentToForm(e: ExperimentRow, segmentKey: string): ExperimentForm {
  const variants = [...e.variants].sort((a, b) => Number(b.is_control) - Number(a.is_control) || a.key.localeCompare(b.key));
  return {
    key: e.key, surface: e.surface, hypothesis: e.hypothesis ?? '', segmentKey, trafficPct: e.traffic_pct, primaryMetric: e.primary_metric,
    variants: variants.map((v) => ({ uid: newUid(), key: v.key, allocation: v.allocation, isControl: v.is_control, configText: JSON.stringify(v.config ?? {}, null, 2) })),
  };
}

export const allocationTotal = (f: ExperimentForm) => f.variants.reduce((s, v) => s + (v.allocation ?? 0), 0);

/**
 * Builds the request body and the errors the zod schema cannot express (JSON parsing, allocation sum, one control,
 * unique keys, matching config reference). Error keys use the API's dotted paths (e.g. `variants.1.config`).
 */
export function formToBody(f: ExperimentForm): { body: ExperimentUpsertBody; extraErrors: FieldErrors } {
  const extraErrors: FieldErrors = {};
  const variants = f.variants.map((v, i) => {
    let config: Record<string, unknown> = {};
    const parsed = parseJsonText(v.configText.trim() || '{}');
    if (!parsed.ok) extraErrors[`variants.${i}.config`] = t('validation.invalidJson');
    else if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) extraErrors[`variants.${i}.config`] = t('validation.jsonObject');
    else config = parsed.value as Record<string, unknown>;
    if (f.surface === 'matching' && !extraErrors[`variants.${i}.config`] && typeof config.matching_config_version_id !== 'string') {
      extraErrors[`variants.${i}.config`] = t('analytics.experiments.matchingConfigRequired');
    }
    return { key: v.key.trim(), allocation: v.allocation as number, isControl: v.isControl, config };
  });

  const total = allocationTotal(f);
  if (total !== 100) extraErrors.variants = t('analytics.experiments.allocationSum', { total });
  else if (variants.filter((v) => v.isControl).length !== 1) extraErrors.variants = t('analytics.experiments.oneControl');
  const seen = new Set<string>();
  variants.forEach((v, i) => {
    if (v.key && seen.has(v.key)) extraErrors[`variants.${i}.key`] = t('analytics.experiments.duplicateVariant');
    seen.add(v.key);
  });

  const body: ExperimentUpsertBody = {
    surface: f.surface,
    hypothesis: f.hypothesis.trim() || undefined,
    segmentKey: f.segmentKey.trim() || null,
    trafficPct: f.trafficPct as number,
    primaryMetric: f.primaryMetric,
    variants,
  };
  return { body, extraErrors };
}
