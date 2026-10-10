import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { routerMock } from '@/test/setup';
import { apiError, json, renderSignedIn } from '@/test/utils';
import { QuestionDetailPage } from './QuestionDetailPage';
import { baseHandlers, CAT2_ID, detail, Q_ID, v1, V1_ID, V2_ID, writes } from './test-fixtures';

const noContent = () => new Response(null, { status: 204 });
const versionHref = (id: string) => `/questionnaire/${Q_ID}/versions/${id}`;

describe('QuestionDetailPage', () => {
  beforeEach(() => routerMock.push.mockClear());

  it('shows meta, versions, publish history and analytics', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<QuestionDetailPage questionId={Q_ID} />, baseHandlers());
    expect(screen.getByText(t('app.loading'))).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'coffee', level: 1 })).toBeInTheDocument();
    const vt = within(screen.getByRole('region', { name: t('questionnaire.versions.title') }));
    expect(vt.getByText(t('questionnaire.versionStatus.draft'))).toBeInTheDocument();
    expect(vt.getByRole('link', { name: `${t('common.edit')} ${t('questionnaire.versions.versionN', { version: 2 })}` })).toHaveAttribute('href', versionHref(V2_ID));
    expect(vt.getByRole('link', { name: `${t('common.view')} ${t('questionnaire.versions.versionN', { version: 1 })}` })).toHaveAttribute('href', versionHref(V1_ID));
    // A pending draft exists, so "new draft" becomes a link to it.
    expect(screen.getByRole('link', { name: t('questionnaire.detail.openPending', { version: 2 }) })).toHaveAttribute('href', versionHref(V2_ID));

    const history = within(screen.getByRole('region', { name: t('questionnaire.history.title') }));
    expect(history.getByText(t('questionnaire.history.actions.publish'))).toBeInTheDocument();
    await user.click(history.getByRole('button', { name: t('questionnaire.history.showImpact') }));
    expect(history.getByText(t('questionnaire.impact.answersCarriedOver'))).toBeInTheDocument();

    const analytics = within(screen.getByRole('region', { name: t('questionnaire.analytics.title') }));
    expect(await analytics.findByText(t('questionnaire.analytics.distribution', { version: 1 }))).toBeInTheDocument();
    const dist = analytics.getByRole('table', { name: t('questionnaire.analytics.distribution', { version: 1 }) });
    const rows = within(dist).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Coffee'); // option order of the version, not response order
    expect(rows[0]).toHaveTextContent('75');
  });

  it('shows the error state with retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<QuestionDetailPage questionId={Q_ID} />, { ...baseHandlers(), [`GET /admin/questions/${Q_ID}`]: () => (fail ? apiError(404, 'NOT_FOUND') : detail()) });
    expect(await screen.findByText(t('errors.NOT_FOUND'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByRole('heading', { name: 'coffee', level: 1 })).toBeInTheDocument();
  });

  it('creates a new draft copied from the latest version and opens it', async () => {
    const user = userEvent.setup();
    const q = detail({ versions: [v1] });
    const { calls } = await renderSignedIn(<QuestionDetailPage questionId={Q_ID} />, {
      ...baseHandlers(q),
      [`POST /admin/questions/${Q_ID}/drafts`]: () => json(201, { questionId: Q_ID, versionId: V2_ID }),
    });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.detail.newDraft') }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(versionHref(V2_ID)));
    expect(writes(calls)[0]).toMatchObject({ method: 'POST', path: `/admin/questions/${Q_ID}/drafts`, body: {} });
  });

  it('opens the existing draft when the API reports one already exists', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<QuestionDetailPage questionId={Q_ID} />, {
      ...baseHandlers(detail({ versions: [v1] })),
      [`POST /admin/questions/${Q_ID}/drafts`]: () => apiError(409, 'CONFLICT', { draftVersionId: V2_ID }),
    });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.detail.newDraft') }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(versionHref(V2_ID)));
  });

  it('deactivates after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<QuestionDetailPage questionId={Q_ID} />, { ...baseHandlers(), [`POST /admin/questions/${Q_ID}/deactivate`]: noContent });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.detail.deactivate') }));
    const d = screen.getByRole('dialog', { name: t('questionnaire.detail.deactivateTitle', { key: 'coffee' }) });
    expect(writes(calls)).toHaveLength(0);
    await user.click(within(d).getByRole('button', { name: t('questionnaire.detail.deactivate') }));
    await waitFor(() => expect(writes(calls).map((c) => c.path)).toEqual([`/admin/questions/${Q_ID}/deactivate`]));
    expect(await screen.findByText(t('questionnaire.detail.deactivated'))).toBeInTheDocument();
  });

  it('activates an inactive question', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<QuestionDetailPage questionId={Q_ID} />, { ...baseHandlers(detail({ is_active: false })), [`POST /admin/questions/${Q_ID}/activate`]: noContent });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.detail.activate') }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('questionnaire.detail.activate') }));
    await waitFor(() => expect(writes(calls).map((c) => c.path)).toEqual([`/admin/questions/${Q_ID}/activate`]));
  });

  it('archives only after typing the key, and lists dependent questions on conflict', async () => {
    const user = userEvent.setup();
    let conflict = true;
    const { calls } = await renderSignedIn(<QuestionDetailPage questionId={Q_ID} />, {
      ...baseHandlers(),
      [`POST /admin/questions/${Q_ID}/archive`]: () => (conflict ? apiError(409, 'CONFLICT', { dependents: ['pet_type'] }) : noContent()),
    });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.detail.archive') }));
    const d = screen.getByRole('dialog', { name: t('questionnaire.detail.archiveTitle', { key: 'coffee' }) });
    await user.click(within(d).getByRole('button', { name: t('questionnaire.detail.archive') }));
    expect(within(d).getByText(t('confirmText.mismatch'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
    await user.type(within(d).getByLabelText(t('confirmText.label', { phrase: 'coffee' }), { exact: false }), 'coffee');
    await user.click(within(d).getByRole('button', { name: t('questionnaire.detail.archive') }));
    expect(await within(d).findByText('pet_type')).toBeInTheDocument();
    expect(within(d).getByText(t('questionnaire.detail.dependents'))).toBeInTheDocument();
    conflict = false;
    await user.click(within(d).getByRole('button', { name: t('questionnaire.detail.archive') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes(calls)).toHaveLength(2);
  });

  it('rolls back to a superseded version', async () => {
    const user = userEvent.setup();
    const v3 = { ...v1, id: '44444444-4444-4444-8444-444444444443', version: 3, status: 'published' as const };
    const q = detail({ published_version_id: v3.id, versions: [v3, { ...v1, status: 'superseded' }] });
    const { calls } = await renderSignedIn(<QuestionDetailPage questionId={Q_ID} />, {
      ...baseHandlers(q),
      [`POST /admin/questions/${Q_ID}/rollback/${V1_ID}`]: () => ({ versionId: 'new' }),
    });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.rollback.action', { version: 1 }) }));
    expect(screen.queryByRole('button', { name: t('questionnaire.rollback.action', { version: 3 }) })).not.toBeInTheDocument();
    const d = screen.getByRole('dialog', { name: t('questionnaire.rollback.title', { version: 1 }) });
    await user.click(within(d).getByRole('button', { name: t('questionnaire.rollback.confirm') }));
    await waitFor(() => expect(writes(calls).map((c) => c.path)).toEqual([`/admin/questions/${Q_ID}/rollback/${V1_ID}`]));
  });

  it('shows validation issues when the rollback target is no longer valid', async () => {
    const user = userEvent.setup();
    const v3 = { ...v1, id: '44444444-4444-4444-8444-444444444443', version: 3, status: 'published' as const };
    await renderSignedIn(<QuestionDetailPage questionId={Q_ID} />, {
      ...baseHandlers(detail({ published_version_id: v3.id, versions: [v3, { ...v1, status: 'superseded' }] })),
      [`POST /admin/questions/${Q_ID}/rollback/${V1_ID}`]: () => apiError(422, 'PUBLISH_VALIDATION_FAILED', { issues: [{ path: 'rules.0', code: 'target_unpublished', message: 'x' }] }),
    });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.rollback.action', { version: 1 }) }));
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByRole('button', { name: t('questionnaire.rollback.confirm') }));
    expect(await within(d).findByText(t('questionnaire.issues.target_unpublished'), { exact: false })).toBeInTheDocument();
  });

  it('moves the question to another category', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<QuestionDetailPage questionId={Q_ID} />, { ...baseHandlers(), [`PUT /admin/questions/${Q_ID}`]: (c) => c.body });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.detail.editMeta') }));
    const d = screen.getByRole('dialog');
    await user.selectOptions(within(d).getByLabelText(t('questionnaire.list.category'), { exact: false }), CAT2_ID);
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ categoryId: CAT2_ID, position: 0 });
  });

  it('hides every mutation for view-only admins', async () => {
    await renderSignedIn(<QuestionDetailPage questionId={Q_ID} />, baseHandlers(detail({ versions: [v1, { ...v1, id: 'old', version: 0, status: 'superseded' }] })), ['questions.view']);
    await screen.findByRole('heading', { name: 'coffee', level: 1 });
    for (const name of [t('questionnaire.detail.newDraft'), t('questionnaire.detail.editMeta'), t('questionnaire.detail.deactivate'), t('questionnaire.detail.archive'), t('questionnaire.rollback.short')]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('shows archive/activate only with questions.archive and rollback only with questions.publish', async () => {
    await renderSignedIn(<QuestionDetailPage questionId={Q_ID} />, baseHandlers(detail({ versions: [v1, { ...v1, id: 'old', version: 0, status: 'superseded' }] })), ['questions.view', 'questions.archive']);
    await screen.findByRole('heading', { name: 'coffee', level: 1 });
    expect(screen.getByRole('button', { name: t('questionnaire.detail.archive') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('questionnaire.rollback.action', { version: 0 }) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('questionnaire.detail.newDraft') })).not.toBeInTheDocument();
  });
});
