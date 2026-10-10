'use client';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { t, tDynamic } from '@/i18n';
import type { AdminApi } from '@/lib/api/admin-api';
import type {
  CompatibilityCategory, QuestionCategory, QuestionDetail, QuestionListRow, ValidationIssue, VersionStatus,
} from '@/lib/api/modules/questionnaire';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { useResource, type Resource } from '@/lib/hooks/useResource';

/** Tabs between the module's list pages. */
export function QuestionnaireTabs() {
  return (
    <SectionTabs
      label={t('questionnaire.tabs.label')}
      tabs={[
        { href: '/questionnaire', label: t('questionnaire.tabs.questions'), exact: true },
        { href: '/questionnaire/categories', label: t('questionnaire.tabs.categories') },
      ]}
    />
  );
}

export interface QuestionnaireRefs {
  categories: QuestionCategory[];
  /** Null when the admin lacks matching.view (the endpoint is owned by the Matching module). */
  compatCategories: CompatibilityCategory[] | null;
  /** Non-archived questions, for condition / rule targets. */
  questions: QuestionListRow[];
}

/** Lookups shared by the list, detail and editor screens. */
export function useQuestionnaireRefs(): Resource<QuestionnaireRefs> {
  const api = useAdminApi();
  const { can } = useSession();
  const canCompat = can('matching.view');
  return useResource(async () => {
    const [categories, compatCategories, questions] = await Promise.all([
      api.questionnaire.categories(),
      canCompat ? api.questionnaire.compatibilityCategories() : Promise.resolve(null),
      api.questionnaire.list(),
    ]);
    return { categories, compatCategories, questions };
  }, [api, canCompat]);
}

type Labelled = { key: string; translations: Record<string, { label: string } | undefined> };

/** English label (the console's content language) with the key as fallback. */
export function labelOf(row: Labelled | undefined | null, fallback = '—'): string {
  if (!row) return fallback;
  return row.translations.en?.label || row.key;
}

export function categoryName(categories: QuestionCategory[], id: string | null | undefined): string {
  if (!id) return '—';
  const c = categories.find((x) => x.id === id);
  return c ? labelOf(c) : id;
}

export function compatName(compat: CompatibilityCategory[] | null, id: string | null | undefined): string {
  if (!id) return t('questionnaire.editor.noCompatCategory');
  const c = compat?.find((x) => x.id === id);
  return c ? labelOf(c) : id;
}

export function questionName(questions: Array<Pick<QuestionListRow, 'id' | 'key' | 'text'>>, id: string): string {
  const q = questions.find((x) => x.id === id);
  if (!q) return id;
  return q.text ? `${q.key} — ${q.text}` : q.key;
}

const VERSION_TONES: Record<VersionStatus, BadgeTone> = { draft: 'info', scheduled: 'warning', published: 'success', superseded: 'neutral', archived: 'neutral' };

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  return <Badge tone={VERSION_TONES[status] ?? 'neutral'}>{tDynamic(`questionnaire.versionStatus.${status}`, status)}</Badge>;
}

export function QuestionStateBadge({ row }: { row: Pick<QuestionListRow, 'archived_at' | 'is_active' | 'published_version_id'> }) {
  if (row.archived_at) return <Badge tone="neutral">{t('questionnaire.state.archived')}</Badge>;
  if (!row.published_version_id) return <Badge tone="info">{t('questionnaire.state.unpublished')}</Badge>;
  return row.is_active ? <Badge tone="success">{t('questionnaire.state.active')}</Badge> : <Badge tone="warning">{t('questionnaire.state.inactive')}</Badge>;
}

export const answerTypeLabel = (type: string | null | undefined) => (type ? tDynamic(`questionnaire.answerTypes.${type}`, type) : '—');

/** Localized issue text: known codes are translated, unknown ones fall back to the server's message. */
export function issueText(issue: ValidationIssue): string {
  return tDynamic(`questionnaire.issues.${issue.code}`, issue.message);
}

/** Validation issues from validate/impact/preview/publish. `unmapped_options` is advisory (does not block publishing). */
export function IssuesList({ issues, title }: { issues: ValidationIssue[]; title?: string }) {
  if (issues.length === 0) return <p className="muted">{t('questionnaire.workflow.noIssues')}</p>;
  return (
    <div role="alert">
      {title ? <p><strong>{title}</strong></p> : null}
      <ul className="issues issues--error">
        {issues.map((i, n) => (
          <li key={`${i.path}-${i.code}-${n}`}>
            <code>{i.path}</code>: {issueText(i)}
            {i.code === 'unmapped_options' ? <> <Badge tone="warning">{t('questionnaire.workflow.advisory')}</Badge></> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Extracts `details.issues` from PUBLISH_VALIDATION_FAILED errors. */
export function issuesFromDetails(details: unknown): ValidationIssue[] | null {
  const issues = (details as { issues?: unknown } | null | undefined)?.issues;
  if (!Array.isArray(issues)) return null;
  return issues.filter((i): i is ValidationIssue => !!i && typeof (i as ValidationIssue).code === 'string' && typeof (i as ValidationIssue).path === 'string');
}

/*
 * Option keys of another question (for condition / rule targets): its published version, else the newest one.
 * Cached per API client so a row re-render or several rows on the same question do not refetch.
 */
const optionCache = new WeakMap<AdminApi, Map<string, Promise<OptionChoices>>>();

export interface OptionChoices {
  keys: Array<{ key: string; label: string }>;
  published: boolean;
}

export function loadOptionChoices(api: AdminApi, questionId: string): Promise<OptionChoices> {
  let byId = optionCache.get(api);
  if (!byId) optionCache.set(api, (byId = new Map()));
  let p = byId.get(questionId);
  if (!p) {
    p = api.questionnaire.get(questionId).then((q: QuestionDetail) => {
      const v = q.versions.find((x) => x.id === q.published_version_id) ?? q.versions[0];
      const keys = (v?.options ?? []).map((o) => ({ key: o.key, label: v!.optionTranslations.find((tr) => tr.optionId === o.id && tr.locale === 'en')?.label ?? o.key }));
      return { keys, published: !!q.published_version_id };
    });
    p.catch(() => byId!.delete(questionId));
    byId.set(questionId, p);
  }
  return p;
}

export function useOptionChoices(questionId: string): Resource<OptionChoices | null> {
  const api = useAdminApi();
  return useResource(() => (questionId ? loadOptionChoices(api, questionId) : Promise.resolve(null)), [api, questionId]);
}
