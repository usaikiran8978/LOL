import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { routerMock } from '@/test/setup';
import { apiError, renderSignedIn } from '@/test/utils';
import { ConfigVersionsPage } from './ConfigVersionsPage';
import { SCHEMA_DEFAULTS } from './CreateDraftDialog';
import { detailToInput } from './configForm';
import { detail, DRAFT_ID, OLD_ID, PUB_ID, summaries } from './testFixtures';

const noDraft = summaries.slice(1);

describe('ConfigVersionsPage', () => {
  beforeEach(() => routerMock.push.mockClear());

  it('lists versions with status and per-row actions', async () => {
    await renderSignedIn(<ConfigVersionsPage />, { 'GET /admin/matching/configs': () => summaries });
    expect(await screen.findByText('v3')).toBeInTheDocument();
    expect(within(screen.getByText('v2').closest('tr')!).getByText(t('status.published'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `${t('common.edit')} v3` })).toHaveAttribute('href', `/matching/configs/${DRAFT_ID}`);
    expect(screen.getByRole('link', { name: `${t('common.view')} v2` })).toHaveAttribute('href', `/matching/configs/${PUB_ID}`);
    expect(screen.getByRole('button', { name: `${t('matching.versions.deleteDraft')} v3` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('matching.versions.deleteDraft')} v2` })).not.toBeInTheDocument();
    // Only one draft may exist: creating another is disabled with a pointer to it.
    expect(screen.getByRole('button', { name: t('matching.versions.newDraft') })).toBeDisabled();
    expect(screen.getByRole('link', { name: t('matching.versions.openDraft', { version: 3 }) })).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    await renderSignedIn(<ConfigVersionsPage />, { 'GET /admin/matching/configs': () => [] });
    expect(await screen.findByText(t('matching.versions.empty'))).toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<ConfigVersionsPage />, { 'GET /admin/matching/configs': () => (fail ? apiError(500, 'INTERNAL') : summaries) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText('v3')).toBeInTheDocument();
  });

  it('hides edit actions without matching.edit', async () => {
    await renderSignedIn(<ConfigVersionsPage />, { 'GET /admin/matching/configs': () => summaries }, ['matching.view']);
    expect(await screen.findByRole('link', { name: `${t('common.view')} v3` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('matching.versions.newDraft') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('matching.versions.deleteDraft')} v3` })).not.toBeInTheDocument();
  });

  it('creates a draft as a server-side copy of the published version', async () => {
    const user = userEvent.setup();
    const { calls: all } = await renderSignedIn(<ConfigVersionsPage />, {
      'GET /admin/matching/configs': () => noDraft,
      'POST /admin/matching/configs': () => ({ id: DRAFT_ID, version: 3 }),
    });
    await user.click(await screen.findByRole('button', { name: t('matching.versions.newDraft') }));
    const posts = () => all.filter((c) => c.method === 'POST' && c.path === '/admin/matching/configs');
    const d = screen.getByRole('dialog', { name: t('matching.create.title') });
    expect(within(d).getByLabelText(t('matching.create.source'))).toHaveValue('published');
    await user.click(within(d).getByRole('button', { name: t('common.create') }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(`/matching/configs/${DRAFT_ID}`));
    expect(posts()[0]!.body).toEqual({});
    expect(await screen.findByText(t('matching.create.created', { version: 3 }))).toBeInTheDocument();
  });

  it('creates a draft from an archived version or the schema defaults', async () => {
    const user = userEvent.setup();
    const old = detail({ id: OLD_ID, version: 1, status: 'archived' });
    const { calls: all } = await renderSignedIn(<ConfigVersionsPage />, {
      'GET /admin/matching/configs': () => noDraft,
      [`GET /admin/matching/configs/${OLD_ID}`]: () => old,
      'POST /admin/matching/configs': () => ({ id: DRAFT_ID, version: 3 }),
    });
    await user.click(await screen.findByRole('button', { name: t('matching.versions.newDraft') }));
    const posts = () => all.filter((c) => c.method === 'POST' && c.path === '/admin/matching/configs');
    let d = screen.getByRole('dialog');
    await user.selectOptions(within(d).getByLabelText(t('matching.create.source')), `version:${OLD_ID}`);
    await user.click(within(d).getByRole('button', { name: t('common.create') }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual(detailToInput(old));

    await user.click(screen.getByRole('button', { name: t('matching.versions.newDraft') }));
    d = screen.getByRole('dialog');
    await user.selectOptions(within(d).getByLabelText(t('matching.create.source')), 'defaults');
    await user.click(within(d).getByRole('button', { name: t('common.create') }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1]!.body).toEqual(SCHEMA_DEFAULTS);
  });

  it('shows a conflict when a draft already exists', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<ConfigVersionsPage />, {
      'GET /admin/matching/configs': () => noDraft,
      'POST /admin/matching/configs': () => apiError(409, 'CONFLICT', { draftId: DRAFT_ID }),
    });
    await user.click(await screen.findByRole('button', { name: t('matching.versions.newDraft') }));
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByRole('button', { name: t('common.create') }));
    expect(await within(d).findByText(t('errors.CONFLICT'))).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('deletes a draft only after typing its version', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ConfigVersionsPage />, {
      'GET /admin/matching/configs': () => summaries,
      [`DELETE /admin/matching/configs/${DRAFT_ID}`]: () => new Response(null, { status: 204 }),
    });
    await user.click(await screen.findByRole('button', { name: `${t('matching.versions.deleteDraft')} v3` }));
    const d = screen.getByRole('dialog', { name: t('matching.versions.deleteTitle', { version: 3 }) });
    await user.click(within(d).getByRole('button', { name: t('matching.versions.deleteDraft') }));
    expect(within(d).getByText(t('confirmText.mismatch'))).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.type(within(d).getByLabelText(t('confirmText.label', { phrase: 'v3' }), { exact: false }), 'v3');
    await user.click(within(d).getByRole('button', { name: t('matching.versions.deleteDraft') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === `/admin/matching/configs/${DRAFT_ID}`)).toBe(true));
    expect(await screen.findByText(t('matching.versions.deleted', { version: 3 }))).toBeInTheDocument();
  });
});
