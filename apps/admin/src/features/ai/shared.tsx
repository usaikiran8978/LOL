'use client';

import { SectionTabs } from '@/components/ui/SectionTabs';
import { locale, t, tDynamic } from '@/i18n';
import type { AiModel, AiProvider } from '@/lib/api/modules/ai';
import { formatNumber } from '@/lib/format';

/** Tabs between the AI console pages (all require ai.view, like the nav item). */
export function AiTabs() {
  return (
    <SectionTabs
      label={t('ai.tabs.label')}
      tabs={[
        { href: '/ai', label: t('ai.tabs.providers'), anyOf: ['ai.view'], exact: true },
        { href: '/ai/features', label: t('ai.tabs.features'), anyOf: ['ai.view'] },
        { href: '/ai/prompts', label: t('ai.tabs.prompts'), anyOf: ['ai.view'] },
        { href: '/ai/usage', label: t('ai.tabs.usage'), anyOf: ['ai.view'] },
      ]}
    />
  );
}

export const featureName = (key: string) => tDynamic(`ai.featureNames.${key}`, key);
export const kindLabel = (kind: string) => tDynamic(`ai.kinds.${kind}`, kind);
export const purposeLabel = (purpose: string) => tDynamic(`ai.purposes.${purpose}`, purpose);

/** Postgres numeric columns arrive as strings; null/blank stays null. */
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** USD amounts (decimal strings from the API), with sub-cent precision for per-token costs. */
export function formatUsd(value: string | number | null | undefined, maximumFractionDigits = 4): string {
  const n = toNumber(value);
  if (n === null) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits }).format(n);
}

export const formatInt = (n: number | null | undefined) => formatNumber(n, 0);

export interface ModelRef {
  model: AiModel;
  provider: AiProvider;
}

/** Flattens providers → models (the API has no separate model list endpoint; models ride on GET providers). */
export function allModels(providers: AiProvider[]): ModelRef[] {
  return providers.flatMap((provider) => provider.models.map((model) => ({ model, provider })));
}

export function modelLabel(ref: ModelRef): string {
  const name = `${ref.provider.key} / ${ref.model.model_name}`;
  return ref.model.is_enabled && ref.provider.is_enabled ? name : t('ai.features.disabledModel', { name });
}

/** Turns a blank optional text input into null (the contracts use nullable strings). */
export const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim());
