import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, renderSignedIn } from '@/test/utils';
import { CategoriesPage } from './CategoriesPage';
import { QuestionListPage } from './QuestionListPage';
import { CAT_ID, COMPAT_ID, Q2_ID, Q_ID, categories, compat, listRows, writes } from './test-fixtures';

const VIEW_ONLY = ['questions.view'] as const;

describe('QuestionListPage', () => {
  it('shows loading, then questions sorted by category with their state', async () => {
    await renderSignedIn(<QuestionListPage />, {
      'GET /admin/questionnaire/categories': () => categories,
      'GET /admin/questions': () => [...listRows].reverse(),
    });
    expect(screen.getByText(t('app.loading'))).toBeInTheDocument();
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('coffee');
    expect(rows[0]).toHaveTextContent('Lifestyle');
    expect(rows[0]).toHaveTextContent(t('questionnaire.list.publishedV', { version: 1 }));
    expect(rows[0]).toHaveTextContent(t('questionnaire.list.draftV', { version: 2 }));
    expect(rows[1]).toHaveTextContent(t('questionnaire.state.unpublished'));
    expect(screen.getByRole('link', { name: `${t('common.view')} coffee` })).toHaveAttribute('href', `/questionnaire/${Q_ID}`);
  });

  it('filters on the server by category and status and searches locally', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<QuestionListPage />, {
      'GET /admin/questionnaire/categories': () => categories,
      'GET /admin/questions': (c) => listRows.filter((r) => !c.query.get('categoryId') || r.category_id === c.query.get('categoryId')),
    });
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText(t('questionnaire.list.category')), CAT_ID);
    await user.selectOptions(screen.getByLabelText(t('common.status')), 'active');
    await waitFor(() => expect(calls.some((c) => c.path === '/admin/questions' && c.query.get('categoryId') === CAT_ID && c.query.get('status') === 'active')).toBe(true));
    await user.type(screen.getByLabelText(t('questionnaire.list.search')), 'zzz');
    expect(await screen.findByText(t('common.noResults'))).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    await renderSignedIn(<QuestionListPage />, { 'GET /admin/questionnaire/categories': () => categories, 'GET /admin/questions': () => [] });
    expect(await screen.findByText(t('questionnaire.list.empty'))).toBeInTheDocument();
  });

  it('shows the error with retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<QuestionListPage />, {
      'GET /admin/questionnaire/categories': () => categories,
      'GET /admin/questions': () => (fail ? apiError(500, 'INTERNAL') : listRows),
    });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('reorders the questions of a category', async () => {
    const user = userEvent.setup();
    const other = { ...listRows[0]!, id: '33333333-3333-4333-8333-555555555555', key: 'tea_time', position: 1 };
    const { calls } = await renderSignedIn(<QuestionListPage />, {
      'GET /admin/questionnaire/categories': () => categories,
      'GET /admin/questions': () => [listRows[0]!, other],
      [`PUT /admin/questions/order/${CAT_ID}`]: () => new Response(null, { status: 204 }),
    });
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: t('questionnaire.reorder.action') })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText(t('questionnaire.list.category')), CAT_ID);
    await user.click(screen.getByRole('button', { name: t('questionnaire.reorder.action') }));
    const d = await screen.findByRole('dialog');
    await user.click(await within(d).findByRole('button', { name: `${t('common.moveUp')} — tea_time` }));
    await user.click(within(d).getByRole('button', { name: t('questionnaire.reorder.save') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ categoryId: CAT_ID, questionIds: [other.id, Q_ID] });
  });

  it('hides create and reorder without questions.edit', async () => {
    await renderSignedIn(<QuestionListPage />, { 'GET /admin/questionnaire/categories': () => categories, 'GET /admin/questions': () => listRows }, [...VIEW_ONLY]);
    await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: t('questionnaire.list.newQuestion') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('questionnaire.reorder.action') })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: `${t('common.view')} pets` })).toHaveAttribute('href', `/questionnaire/${Q2_ID}`);
  });
});

describe('CategoriesPage', () => {
  it('lists categories with their compatibility category and creates one with translations', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CategoriesPage />, {
      'GET /admin/questionnaire/categories': () => categories,
      'GET /admin/questionnaire/compatibility-categories': () => compat,
      'PUT /admin/questionnaire/categories/values': (c) => c.body,
    });
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Lifestyle fit');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('en, fr');
    await user.click(screen.getByRole('button', { name: t('questionnaire.categories.new') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('common.key'), { exact: false }), 'values');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getAllByText(t('validation.required')).length).toBeGreaterThan(0);
    expect(writes(calls)).toHaveLength(0);
    await user.type(within(d).getByLabelText(`${t('questionnaire.categories.label')} (en)`, { exact: false }), 'Values');
    await user.selectOptions(within(d).getByLabelText(t('questionnaire.editor.compatCategory')), COMPAT_ID);
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ key: 'values', compatibilityCategoryId: COMPAT_ID, position: 2, isActive: true, translations: { en: { label: 'Values' } } });
  });

  it('edits an existing category keeping its key', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CategoriesPage />, {
      'GET /admin/questionnaire/categories': () => categories,
      'GET /admin/questionnaire/compatibility-categories': () => compat,
      'PUT /admin/questionnaire/categories/family': (c) => c.body,
    });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} family` }));
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByLabelText(t('common.active')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ key: 'family', compatibilityCategoryId: null, position: 1, isActive: false, translations: { en: { label: 'Family', description: 'Kids and family' } } });
  });

  it('is read-only without questions.edit and skips compatibility categories without matching.view', async () => {
    const { calls } = await renderSignedIn(<CategoriesPage />, { 'GET /admin/questionnaire/categories': () => categories }, [...VIEW_ONLY]);
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: t('questionnaire.categories.new') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('common.edit')} family` })).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.includes('compatibility-categories'))).toBe(false);
  });

  it('shows empty and error states', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<CategoriesPage />, { 'GET /admin/questionnaire/categories': () => (fail ? apiError(500, 'INTERNAL') : []) }, [...VIEW_ONLY]);
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('questionnaire.categories.empty'))).toBeInTheDocument();
  });
});
