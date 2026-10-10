'use client';

import { SectionTabs } from '@/components/ui/SectionTabs';
import { t, tDynamic } from '@/i18n';
import type { CompatibilityCategoryRow, MatchingValidationIssue } from '@/lib/api/modules/matching';

/** Tabs between the matching pages; each tab is shown per the permission its API routes require. */
export function MatchingTabs() {
  return (
    <SectionTabs
      label={t('matching.tabs.label')}
      tabs={[
        { href: '/matching', label: t('matching.tabs.versions'), anyOf: ['matching.view'], exact: true },
        { href: '/matching/categories', label: t('matching.tabs.categories'), anyOf: ['matching.view'] },
        { href: '/matching/deal-breakers', label: t('matching.tabs.dealBreakers'), anyOf: ['matching.view'] },
        { href: '/matching/test', label: t('matching.tabs.test'), anyOf: ['matching.test'] },
      ]}
    />
  );
}

export const versionLabel = (version: number) => t('matching.versions.versionLabel', { version });

/** Localized label of a compatibility category (en translation), falling back to its key. */
export function categoryLabel(row: Pick<CompatibilityCategoryRow, 'key' | 'translations'> | undefined, key: string): string {
  return row?.translations.en?.label || key;
}

/** Validation issues from GET configs/:id/validate or a PUBLISH_VALIDATION_FAILED error (codes are localized). */
export function ValidationIssues({ issues }: { issues: MatchingValidationIssue[] }) {
  if (issues.length === 0) return <p className="alert alert--success">{t('matching.validate.noIssues')}</p>;
  return (
    <div className="alert alert--error" role="alert">
      <p>{t('matching.validate.issuesTitle', { count: issues.length })}</p>
      <ul className="issues">
        {issues.map((i) => (
          <li key={`${i.path}:${i.code}`}>
            <code>{i.path}</code> — {tDynamic(`matching.issues.${i.code}`, i.message)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Issues carried by a PUBLISH_VALIDATION_FAILED error (`details.issues`), or null for any other error. */
export function issuesFromError(error: unknown): MatchingValidationIssue[] | null {
  const details = (error as { code?: string; details?: { issues?: unknown } } | null)?.details;
  if ((error as { code?: string } | null)?.code !== 'PUBLISH_VALIDATION_FAILED' || !Array.isArray(details?.issues)) return null;
  return details.issues as MatchingValidationIssue[];
}
