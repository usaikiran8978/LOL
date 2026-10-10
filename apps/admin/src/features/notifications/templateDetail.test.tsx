import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, field, renderSignedIn } from '@/test/utils';
import { TemplateDetailPage } from './TemplateDetailPage';
import { helloTemplate, helloV1, unpublishedTemplate } from './test-fixtures';
import { writes } from './test-helpers';

/** Label matcher tolerant of the required-field asterisk only. */
const req = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*)?$`);

const base = {
  'GET /admin/notifications/templates': () => [helloTemplate, unpublishedTemplate],
  'GET /admin/notifications/templates/test.hello/versions/1': () => helloV1,
  'GET /admin/notifications/templates/test.hello/versions/2': () => ({ ...helloV1, id: '00000000-0000-4000-8000-0000000000a2', version: 2, status: 'draft', published_at: null }),
};

const ALL = ['notifications.manage', 'notifications.send_test'] as const;

describe('TemplateDetailPage', () => {
  it('shows settings, versions and the published version contents per locale', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<TemplateDetailPage templateKey="test.hello" />, base, [...ALL]);
    expect(await screen.findByRole('heading', { name: t('notifications.templates.detailTitle', { key: 'test.hello' }) })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: t('notifications.versions.viewTitle', { version: 1 }) })).toBeInTheDocument();
    const tabs = await screen.findByRole('tablist', { name: t('notifications.versions.localesLabel') });
    expect(within(tabs).getByRole('tab', { name: 'en' })).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Hello {{name}}')).toBeInTheDocument();
    expect(within(panel).getByText('Welcome')).toBeInTheDocument();
    // HTML bodies render only inside a sandboxed frame.
    const frame = within(panel).getByTitle(t('notifications.versions.htmlFrame', { tag: `en · ${t('notifications.channel.email')}` }));
    expect(frame).toHaveAttribute('sandbox', '');
    await user.click(within(tabs).getByRole('tab', { name: 'fr' }));
    expect(within(screen.getByRole('tabpanel')).getByText('Bonjour {{name}}')).toBeInTheDocument();
  });

  it('switches to another version', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<TemplateDetailPage templateKey="test.hello" />, base, [...ALL]);
    await user.click(await screen.findByRole('button', { name: `${t('common.view')} ${t('notifications.versions.versionShort', { version: 2 })}` }));
    expect(await screen.findByRole('heading', { name: t('notifications.versions.viewTitle', { version: 2 }) })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/versions/2'))).toBe(true));
  });

  it('shows a not-found state for unknown keys', async () => {
    await renderSignedIn(<TemplateDetailPage templateKey="nope" />, base, [...ALL]);
    expect(await screen.findByText(t('notifications.templates.notFound', { key: 'nope' }))).toBeInTheDocument();
  });

  it('shows an error with retry when the template cannot be loaded', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<TemplateDetailPage templateKey="test.hello" />, { ...base, 'GET /admin/notifications/templates': () => (fail ? apiError(503, 'INTERNAL') : [helloTemplate]) }, [...ALL]);
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByRole('heading', { name: t('notifications.templates.detailTitle', { key: 'test.hello' }) })).toBeInTheDocument();
  });

  it('is forbidden without notifications.manage', async () => {
    const { calls } = await renderSignedIn(<TemplateDetailPage templateKey="test.hello" />, base, ['notifications.channels']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/admin/notifications'))).toBe(false);
  });

  it('publishes a draft only after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<TemplateDetailPage templateKey="test.hello" />, {
      ...base,
      'POST /admin/notifications/templates/test.hello/versions/2/publish': () => ({ id: '00000000-0000-4000-8000-0000000000a2', version: 2, status: 'published' }),
    }, [...ALL]);
    await user.click(await screen.findByRole('button', { name: `${t('notifications.versions.publish')} ${t('notifications.versions.versionShort', { version: 2 })}` }));
    const confirm = screen.getByRole('dialog', { name: t('notifications.versions.publishTitle', { key: 'test.hello', version: 2 }) });
    expect(within(confirm).getByText(t('notifications.versions.publishReplaces', { version: 1 }))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: t('notifications.versions.publish') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.path).toBe('/admin/notifications/templates/test.hello/versions/2/publish');
    expect(await screen.findByText(t('notifications.versions.published', { version: 2 }))).toBeInTheDocument();
  });

  it('shows the publish validation error from the API', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<TemplateDetailPage templateKey="test.hello" />, {
      ...base,
      'POST /admin/notifications/templates/test.hello/versions/2/publish': () => apiError(422, 'PUBLISH_VALIDATION_FAILED'),
    }, [...ALL]);
    await user.click(await screen.findByRole('button', { name: `${t('notifications.versions.publish')} ${t('notifications.versions.versionShort', { version: 2 })}` }));
    const confirm = screen.getByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: t('notifications.versions.publish') }));
    expect(await within(confirm).findByText(t('errors.PUBLISH_VALIDATION_FAILED'))).toBeInTheDocument();
  });

  it('creates a new version, rejecting undeclared placeholders client-side', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<TemplateDetailPage templateKey="test.hello" />, {
      ...base,
      'POST /admin/notifications/templates/test.hello/versions': () => ({ id: '00000000-0000-4000-8000-0000000000a3', version: 3 }),
      'GET /admin/notifications/templates/test.hello/versions/3': () => ({ ...helloV1, id: '00000000-0000-4000-8000-0000000000a3', version: 3, status: 'draft' }),
    }, [...ALL]);
    await user.click(await screen.findByRole('button', { name: t('notifications.versions.new') }));
    const d = screen.getByRole('dialog');
    const pushTag = `en · ${t('notifications.channel.push')}`;
    const emailTag = `en · ${t('notifications.channel.email')}`;
    // Fields follow the channel: push has a title, e-mail a subject and HTML body.
    expect(within(d).getByLabelText(t('notifications.versions.fieldTitle', { tag: pushTag }))).toBeInTheDocument();
    expect(within(d).queryByLabelText(t('notifications.versions.fieldSubject', { tag: pushTag }))).toBeNull();
    expect(within(d).getByLabelText(t('notifications.versions.fieldSubject', { tag: emailTag }))).toBeInTheDocument();

    await user.type(within(d).getByLabelText(req(t('notifications.versions.fieldBody', { tag: pushTag }))), 'Hey {{{{first}}');
    await user.type(within(d).getByLabelText(req(t('notifications.versions.fieldBody', { tag: emailTag }))), 'Mail body');
    await user.click(within(d).getByRole('button', { name: t('notifications.versions.createDraft') }));
    expect(within(d).getByText(t('notifications.versions.undeclared', { names: 'first' }))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);

    await user.type(within(d).getByLabelText(t('notifications.versions.variables')), 'first');
    await user.type(within(d).getByLabelText(t('notifications.versions.fieldSubject', { tag: emailTag })), 'Hi there');
    // Add a French push translation.
    await user.type(within(d).getByLabelText(t('notifications.versions.newLocale')), 'fr');
    await user.click(within(d).getByRole('button', { name: t('notifications.versions.addContent') }));
    const frTag = `fr · ${t('notifications.channel.push')}`;
    await user.type(within(d).getByLabelText(req(t('notifications.versions.fieldBody', { tag: frTag }))), 'Salut {{{{first}}');
    // Duplicates are refused.
    await user.type(within(d).getByLabelText(t('notifications.versions.newLocale')), 'fr');
    await user.click(within(d).getByRole('button', { name: t('notifications.versions.addContent') }));
    expect(within(d).getByText(t('notifications.versions.duplicateContent'))).toBeInTheDocument();

    await user.click(within(d).getByRole('button', { name: t('notifications.versions.createDraft') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({
      variables: ['first'],
      contents: [
        { locale: 'en', channel: 'push', body: 'Hey {{first}}' },
        { locale: 'en', channel: 'email', subject: 'Hi there', body: 'Mail body' },
        { locale: 'fr', channel: 'push', body: 'Salut {{first}}' },
      ],
    });
    expect(await screen.findByText(t('notifications.versions.created', { version: 3 }))).toBeInTheDocument();
  });

  it('copies an existing version into a new draft', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<TemplateDetailPage templateKey="test.hello" />, base, [...ALL]);
    await user.click(await screen.findByRole('button', { name: t('notifications.versions.copy') }));
    const d = screen.getByRole('dialog', { name: t('notifications.versions.newFromTitle', { key: 'test.hello', version: 1 }) });
    expect(within(d).getByLabelText(t('notifications.versions.variables'))).toHaveValue('name');
    expect(within(d).getByLabelText(req(t('notifications.versions.fieldBody', { tag: `fr · ${t('notifications.channel.push')}` })))).toHaveValue('Bonjour {{name}}');
  });

  it('previews every channel of the published version, showing locale fallback and per-channel errors', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<TemplateDetailPage templateKey="test.hello" />, {
      ...base,
      'POST /admin/notifications/templates/test.hello/preview': (c) => {
        const b = c.body as { channel: string; variables: Record<string, string> };
        if (b.channel === 'email') return apiError(404, 'TEMPLATE_NOT_FOUND');
        return { locale: 'fr', versionId: '00000000-0000-4000-8000-0000000000a1', title: 'Salut', subject: null, body: `Bonjour ${b.variables.name}`, htmlBody: null };
      },
    }, [...ALL]);
    const locale = await screen.findByLabelText(req(t('notifications.preview.locale')));
    await user.clear(locale);
    await user.type(locale, 'fr-CA');
    await user.type(screen.getByLabelText(t('notifications.preview.variable', { name: 'name' })), 'Léa');
    await user.click(screen.getByRole('button', { name: t('notifications.preview.run') }));
    const push = await screen.findByRole('region', { name: t('notifications.channel.push') });
    expect(within(push).getByText('Bonjour Léa')).toBeInTheDocument();
    expect(within(push).getByText(t('notifications.preview.fallback', { requested: 'fr-CA', used: 'fr' }))).toBeInTheDocument();
    const email = screen.getByRole('region', { name: t('notifications.channel.email') });
    expect(within(email).getByText(t('errors.TEMPLATE_NOT_FOUND'))).toBeInTheDocument();
    const previews = calls.filter((c) => c.path.endsWith('/preview'));
    expect(previews.map((c) => c.body)).toEqual([
      { locale: 'fr-CA', channel: 'push', versionId: '00000000-0000-4000-8000-0000000000a1', variables: { name: 'Léa' } },
      { locale: 'fr-CA', channel: 'email', versionId: '00000000-0000-4000-8000-0000000000a1', variables: { name: 'Léa' } },
    ]);
  });

  it('explains that preview needs a version', async () => {
    await renderSignedIn(<TemplateDetailPage templateKey="match.new" />, base, [...ALL]);
    expect(await screen.findByText(t('notifications.preview.needsVersion'))).toBeInTheDocument();
    expect(screen.getByText(t('notifications.versions.empty'))).toBeInTheDocument();
  });

  it('previews a draft version and hides test-send for it', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<TemplateDetailPage templateKey="test.hello" />, {
      ...base,
      'POST /admin/notifications/templates/test.hello/preview': () => ({ locale: 'en', versionId: '00000000-0000-4000-8000-0000000000a2', title: 'Draft', subject: null, body: 'Draft body', htmlBody: null }),
    }, [...ALL]);
    await user.click(await screen.findByRole('button', { name: `${t('common.view')} ${t('notifications.versions.versionShort', { version: 2 })}` }));
    expect(await screen.findByText(t('notifications.preview.draftNote'))).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: t('notifications.testSend.title') })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('notifications.preview.run') }));
    await screen.findAllByText('Draft body');
    expect(calls.filter((c) => c.path.endsWith('/preview')).every((c) => (c.body as { versionId: string }).versionId === '00000000-0000-4000-8000-0000000000a2')).toBe(true);
  });

  it('test-sends to a validated user id after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<TemplateDetailPage templateKey="test.hello" />, {
      ...base,
      'POST /admin/notifications/templates/test.hello/test-send': () => ({ created: 2 }),
    }, [...ALL]);
    await user.type(await screen.findByLabelText(t('notifications.preview.variable', { name: 'name' })), 'Ada');
    await user.type(field(t('notifications.testSend.userId')), 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: t('notifications.testSend.send') }));
    expect(screen.getByText(t('validation.invalidUuid'))).toBeInTheDocument();
    const id = '6f1c2b2e-6c1a-4a8e-9a7e-2a4f1f0f9b11';
    await user.clear(field(t('notifications.testSend.userId')));
    await user.type(field(t('notifications.testSend.userId')), id);
    await user.click(screen.getByRole('button', { name: t('notifications.testSend.send') }));
    const confirm = screen.getByRole('dialog', { name: t('notifications.testSend.confirmTitle', { key: 'test.hello' }) });
    expect(writes(calls)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: t('notifications.testSend.send') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ userId: id, variables: { name: 'Ada' } });
    expect(await screen.findByText(t('notifications.testSend.sent', { count: 2 }))).toBeInTheDocument();
  });

  it('hides test send without notifications.send_test', async () => {
    await renderSignedIn(<TemplateDetailPage templateKey="test.hello" />, base, ['notifications.manage']);
    expect(await screen.findByRole('button', { name: t('notifications.preview.run') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('notifications.testSend.send') })).toBeNull();
  });
});
