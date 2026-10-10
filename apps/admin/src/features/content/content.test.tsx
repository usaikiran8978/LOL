import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, field, json, renderSignedIn } from '@/test/utils';
import { CmsPage } from './CmsPage';
import { LegalPage } from './LegalPage';

const entry = {
  id: 'e1', key: 'faq.delete_account', kind: 'faq', category: null, position: 0, country_codes: null, status: 'published', publish_at: null, unpublish_at: null,
  updated_at: '2026-01-01T00:00:00Z', translations: { en: { title: 'How do I delete my account?', bodyMarkdown: 'Settings → **Privacy**' } },
};

describe('CmsPage', () => {
  it('archives an entry only after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CmsPage />, { 'GET /admin/content/cms': () => [entry], 'DELETE /admin/content/cms/faq.delete_account': () => json(204) });
    await user.click(await screen.findByRole('button', { name: `${t('cms.archive')} faq.delete_account` }));
    const confirm = screen.getByRole('dialog', { name: t('cms.archiveTitle', { key: 'faq.delete_account' }) });
    // Destructive dialogs focus Cancel first.
    expect(within(confirm).getByRole('button', { name: t('common.cancel') })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: t('cms.archive') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(await screen.findByText(t('cms.archived'))).toBeInTheDocument();
  });

  it('creates a targeted entry, previews markdown and confirms publishing', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CmsPage />, { 'GET /admin/content/cms': () => [], 'PUT /admin/content/cms/safety.new': (c) => c.body });
    expect(await screen.findByText(t('cms.empty'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('cms.newEntry') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('common.key'), { exact: false }), 'safety.new');
    await user.selectOptions(within(d).getByLabelText(t('cms.kind')), 'safety_tip');
    await user.selectOptions(within(d).getByLabelText(t('common.status')), 'published');
    await user.click(within(d).getByLabelText(t('cms.specificCountries')));
    await user.type(within(d).getByLabelText(t('cms.countryCodes'), { exact: false }), 'de, fr');
    fireEvent.change(within(d).getByLabelText(t('cms.publishAt')), { target: { value: '2026-11-01T09:00' } });
    fireEvent.change(within(d).getByLabelText(t('cms.unpublishAt')), { target: { value: '2026-10-01T09:00' } });
    await user.type(within(d).getByLabelText(`${t('cms.fields.title')} (en)`, { exact: false }), 'Meet in public');
    fireEvent.change(field(`${t('cms.fields.bodyMarkdown')} (en)`), { target: { value: 'Choose a **busy** place' } });
    await user.click(within(d).getByRole('button', { name: t('markdown.preview') }));
    expect(within(d).getByText('busy').tagName).toBe('STRONG');

    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.windowOrder'))).toBeInTheDocument();
    fireEvent.change(within(d).getByLabelText(t('cms.unpublishAt')), { target: { value: '' } });
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    const confirm = screen.getByRole('dialog', { name: t('cms.publishTitle', { key: 'safety.new' }) });
    await user.click(within(confirm).getByRole('button', { name: t('cms.publishConfirm') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      key: 'safety.new', kind: 'safety_tip', position: 0, countryCodes: ['DE', 'FR'], status: 'published',
      publishAt: new Date('2026-11-01T09:00').toISOString(), unpublishAt: null,
      translations: { en: { title: 'Meet in public', bodyMarkdown: 'Choose a **busy** place' } },
    });
  });
});

const docs = [
  { id: '3f1f0f5e-2a40-4a8e-9d1c-1f2a3b4c5d6e', doc_type: 'terms', version: 2, locale: 'en', country_code: null, title: 'Terms v2', status: 'draft', effective_at: null, requires_reacceptance: true, created_at: '2026-02-01T00:00:00Z' },
  { id: '4f1f0f5e-2a40-4a8e-9d1c-1f2a3b4c5d6e', doc_type: 'terms', version: 1, locale: 'en', country_code: null, title: 'Terms', status: 'published', effective_at: '2026-01-01T00:00:00Z', requires_reacceptance: false, created_at: '2026-01-01T00:00:00Z' },
];

describe('LegalPage', () => {
  it('views a published version read-only and starts a new draft from it', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<LegalPage />, {
      'GET /admin/content/legal': () => docs,
      [`GET /admin/content/legal/${docs[1]!.id}`]: () => ({ ...docs[1], body_md: '# Terms\n\nBe kind.' }),
      'POST /admin/content/legal': () => ({ id: 'n', doc_type: 'terms', version: 3, locale: 'en', status: 'draft' }),
    });
    // Only drafts can be published; there is no edit action at all.
    expect(await screen.findAllByRole('button', { name: /^Publish/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: `${t('common.view')} ${t('legal.docTypes.terms')} v1 en` }));
    const view = screen.getByRole('dialog');
    expect(await within(view).findByRole('heading', { name: 'Terms' })).toBeInTheDocument();
    expect(within(view).getByText(t('legal.readOnly'))).toBeInTheDocument();
    await user.click(within(view).getByRole('button', { name: t('legal.newVersionFrom') }));
    const draft = screen.getByRole('dialog', { name: t('legal.newDraftTitle') });
    expect(within(draft).getByLabelText(t('legal.docTitle'), { exact: false })).toHaveValue('Terms');
    await user.click(within(draft).getByRole('button', { name: t('common.create') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/admin/content/legal')).toBe(true));
    expect(calls.find((c) => c.path === '/admin/content/legal' && c.method === 'POST')!.body).toEqual({
      docType: 'terms', locale: 'en', countryCode: null, title: 'Terms', bodyMarkdown: '# Terms\n\nBe kind.', requiresReacceptance: false,
    });
    expect(await screen.findByText(t('legal.draftCreated', { version: 3 }))).toBeInTheDocument();
  });

  it('publishes a draft with an effective date after confirmation and surfaces server errors', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const { calls } = await renderSignedIn(<LegalPage />, {
      'GET /admin/content/legal': () => docs,
      [`POST /admin/content/legal/${docs[0]!.id}/publish`]: () => (attempt++ === 0 ? apiError(409, 'CONFLICT') : { id: docs[0]!.id, status: 'published' }),
    });
    await user.click(await screen.findByRole('button', { name: `${t('legal.publish')} ${t('legal.docTypes.terms')} v2 en` }));
    const confirm = screen.getByRole('dialog');
    fireEvent.change(within(confirm).getByLabelText(t('legal.effectiveAtInput')), { target: { value: '2026-12-01T00:00' } });
    await user.click(within(confirm).getByRole('button', { name: t('legal.publish') }));
    expect(await within(confirm).findByText(t('errors.CONFLICT'))).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: t('legal.publish') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const posts = calls.filter((c) => c.path.endsWith('/publish'));
    expect(posts[1]!.body).toEqual({ effectiveAt: new Date('2026-12-01T00:00').toISOString() });
    expect(posts[1]!.headers['X-CSRF-Token']).toBe('csrf-1');
  });
});
