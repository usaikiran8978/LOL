import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, field, renderSignedIn } from '@/test/utils';
import { InterestsPage } from './InterestsPage';
import { PromptsPage } from './PromptsPage';
import { TaxonomyTermsPage } from './TaxonomyTermsPage';

const term = { id: '0f7a3c2e-1111-4a8e-9d1c-1f2a3b4c5d6e', kind: 'gender', key: 'woman', parent_id: null, position: 0, is_sensitive: false, is_active: true, metadata: {}, translations: { en: { label: 'Woman', description: null } } };

describe('TaxonomyTermsPage', () => {
  it('creates a term with the shared contract shape and the CSRF header', async () => {
    const user = userEvent.setup();
    const { calls, mutations } = await renderSignedIn(<TaxonomyTermsPage />, {
      'GET /admin/taxonomy/terms': (c) => (c.query.get('kind') === 'gender' ? [term] : []),
      'POST /admin/taxonomy/terms': (c) => ({ ...term, id: 'new', key: (c.body as { key: string }).key }),
    });
    expect(await screen.findByText('Woman')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('taxonomy.newTerm') }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }));
    expect(within(dialog).getByText(t('validation.invalidFormat'))).toBeInTheDocument();
    expect(mutations().filter((c) => c.path.startsWith('/admin/taxonomy'))).toHaveLength(0);

    await user.type(field(t('common.key')), 'non_binary');
    await user.type(within(dialog).getByLabelText(`${t('taxonomy.fields.label')} (en)`, { exact: false }), 'Non-binary');
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = calls.find((c) => c.method === 'POST' && c.path === '/admin/taxonomy/terms')!;
    expect(post.headers['X-CSRF-Token']).toBe('csrf-1');
    expect(post.body).toEqual({ kind: 'gender', key: 'non_binary', parentId: null, position: 0, isSensitive: false, isActive: true, metadata: {}, translations: { en: { label: 'Non-binary' } } });
    expect(screen.getByText(t('common.created'))).toBeInTheDocument();
  });

  it('keeps key and kind read-only on edit and maps server errors', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<TaxonomyTermsPage />, {
      'GET /admin/taxonomy/terms': () => [term],
      [`PUT /admin/taxonomy/terms/${term.id}`]: () => apiError(409, 'CONFLICT'),
    });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} woman` }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(t('common.key'))).toHaveAttribute('readonly');
    expect(within(dialog).getByLabelText(t('taxonomy.kind'))).toHaveAttribute('readonly');
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }));
    expect(await within(dialog).findByText(t('errors.CONFLICT'))).toBeInTheDocument();
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({ kind: 'gender', key: 'woman' });
  });

  it('loads terms per kind and shows the empty state', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<TaxonomyTermsPage />, { 'GET /admin/taxonomy/terms': (c) => (c.query.get('kind') === 'gender' ? [term] : []) });
    await screen.findByText('Woman');
    await user.selectOptions(field(t('taxonomy.kind')), 'pets');
    expect(await screen.findByText(t('taxonomy.empty'))).toBeInTheDocument();
  });
});

describe('InterestsPage', () => {
  const cat = { id: '1c0a3c2e-1111-4a8e-9d1c-1f2a3b4c5d6e', key: 'outdoors', icon: null, position: 0, is_active: true, translations: { en: { label: 'Outdoors' } } };
  it('lists categories and interests and creates an interest in a category', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<InterestsPage />, {
      'GET /admin/taxonomy/interest-categories': () => [cat],
      'GET /admin/taxonomy/interests': () => [{ id: 'i1', key: 'hiking', category_id: cat.id, icon: null, position: 0, is_active: true, translations: { en: { label: 'Hiking' } } }],
      'POST /admin/taxonomy/interests': () => ({}),
    });
    expect(await screen.findByText('Hiking')).toBeInTheDocument();
    expect(screen.getAllByText('Outdoors').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: t('interests.newInterest') }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(t('common.key'), { exact: false }), 'climbing');
    await user.selectOptions(within(dialog).getByLabelText(t('interests.category'), { exact: false }), cat.id);
    await user.type(within(dialog).getByLabelText(`${t('interests.fields.label')} (en)`, { exact: false }), 'Climbing');
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(calls.some((c) => c.path === '/admin/taxonomy/interests' && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.path === '/admin/taxonomy/interests' && c.method === 'POST')!.body).toMatchObject({ key: 'climbing', categoryId: cat.id, translations: { en: { label: 'Climbing' } } });
  });

  it('explains that a category is needed before interests', async () => {
    await renderSignedIn(<InterestsPage />, { 'GET /admin/taxonomy/interest-categories': () => [], 'GET /admin/taxonomy/interests': () => [] });
    expect(await screen.findByText(t('interests.emptyCategories'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('interests.newInterest') })).toBeDisabled();
  });
});

describe('PromptsPage', () => {
  it('edits a prompt translation', async () => {
    const user = userEvent.setup();
    const p = { id: '2c0a3c2e-1111-4a8e-9d1c-1f2a3b4c5d6e', key: 'ideal_sunday', category: 'general', position: 0, is_active: true, translations: { en: { text: 'My ideal Sunday' } } };
    const { calls } = await renderSignedIn(<PromptsPage />, { 'GET /admin/taxonomy/prompts': () => [p], [`PUT /admin/taxonomy/prompts/${p.id}`]: () => p });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} ideal_sunday` }));
    const text = within(screen.getByRole('dialog')).getByLabelText(`${t('prompts.fields.text')} (en)`, { exact: false });
    await user.clear(text);
    await user.click(screen.getByRole('button', { name: t('common.save') }));
    expect(within(screen.getByRole('dialog')).getAllByText(t('validation.required')).length).toBeGreaterThan(0);
    await user.type(text, 'A perfect Sunday');
    await user.click(screen.getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ key: 'ideal_sunday', category: 'general', position: 0, isActive: true, translations: { en: { text: 'A perfect Sunday' } } });
  });
});
