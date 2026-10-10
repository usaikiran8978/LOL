import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, renderSignedIn } from '@/test/utils';
import { NotificationsHome } from './NotificationsHome';
import { writes } from './test-helpers';
import { helloTemplate, unpublishedTemplate } from './test-fixtures';
import { TemplatesPage } from './TemplatesPage';

describe('TemplatesPage', () => {
  it('shows loading, then the template catalogue with version status and detail links', async () => {
    await renderSignedIn(<TemplatesPage />, { 'GET /admin/notifications/templates': () => [helloTemplate, unpublishedTemplate] });
    expect(screen.getByText(t('app.loading'))).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'test.hello' });
    expect(link).toHaveAttribute('href', '/notifications/templates/test.hello');
    expect(screen.getByText(t('notifications.templates.publishedVersion', { version: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t('notifications.templates.draftCount', { count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t('notifications.templates.noPublished'))).toBeInTheDocument();
    expect(screen.getByText(`${t('notifications.channel.push')}, ${t('notifications.channel.email')}`)).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    await renderSignedIn(<TemplatesPage />, { 'GET /admin/notifications/templates': () => [] });
    expect(await screen.findByText(t('notifications.templates.empty'))).toBeInTheDocument();
  });

  it('shows the error with a working retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<TemplatesPage />, { 'GET /admin/notifications/templates': () => (fail ? apiError(500, 'INTERNAL') : [helloTemplate]) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByRole('link', { name: 'test.hello' })).toBeInTheDocument();
  });

  it('validates and creates a template', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<TemplatesPage />, {
      'GET /admin/notifications/templates': () => [],
      'PUT /admin/notifications/templates/event.reminder_v2': (c) => ({ ...(c.body as object), id: 'n' }),
    });
    await screen.findByText(t('notifications.templates.empty'));
    await user.click(screen.getByRole('button', { name: t('notifications.templates.new') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('notifications.templates.key'), { exact: false }), 'Bad Key');
    await user.click(within(d).getByRole('button', { name: t('common.create') }));
    expect(within(d).getByText(t('validation.invalidFormat'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);

    await user.clear(within(d).getByLabelText(t('notifications.templates.key'), { exact: false }));
    await user.type(within(d).getByLabelText(t('notifications.templates.key'), { exact: false }), 'event.reminder_v2');
    await user.selectOptions(within(d).getByLabelText(t('notifications.templates.category'), { exact: false }), 'event');
    await user.click(within(d).getByLabelText(t('notifications.channel.push')));
    await user.type(within(d).getByLabelText(t('notifications.templates.deepLink')), 'amora://events/{{{{eventId}}');
    await user.click(within(d).getByRole('button', { name: t('common.create') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({
      key: 'event.reminder_v2', category: 'event', channels: ['push', 'in_app'], isTransactional: true, respectsQuietHours: true,
      deepLinkPattern: 'amora://events/{{eventId}}', isActive: true,
    });
    expect(await screen.findByText(t('notifications.templates.created', { key: 'event.reminder_v2' }))).toBeInTheDocument();
  });

  it('requires at least one channel', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<TemplatesPage />, { 'GET /admin/notifications/templates': () => [] });
    await screen.findByText(t('notifications.templates.empty'));
    await user.click(screen.getByRole('button', { name: t('notifications.templates.new') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('notifications.templates.key'), { exact: false }), 'a.b');
    await user.click(within(d).getByLabelText(t('notifications.channel.in_app')));
    await user.click(within(d).getByRole('button', { name: t('common.create') }));
    expect(within(d).getByText(t('validation.tooFewItems', { min: 1 }))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
  });

  it('confirms before saving settings of an existing template', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<TemplatesPage />, {
      'GET /admin/notifications/templates': () => [helloTemplate],
      'PUT /admin/notifications/templates/test.hello': (c) => c.body,
    });
    await user.click(await screen.findByRole('button', { name: `${t('notifications.templates.editSettings')} test.hello` }));
    const d = screen.getByRole('dialog');
    expect(within(d).getByLabelText(t('notifications.templates.key'))).toHaveAttribute('readonly');
    await user.click(within(d).getByLabelText(t('notifications.templates.active')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    const confirm = screen.getByRole('dialog', { name: t('notifications.templates.confirmTitle', { key: 'test.hello' }) });
    expect(writes(calls)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toMatchObject({ key: 'test.hello', channels: ['push', 'email'], isActive: false });
  });
});

describe('NotificationsHome', () => {
  it('sends admins without template access to the channels section', async () => {
    const { calls } = await renderSignedIn(<NotificationsHome />, { 'GET /admin/notifications/channels': () => [] }, ['notifications.channels']);
    expect(await screen.findByText(t('notifications.channelsPage.empty'))).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/admin/notifications/templates')).toBe(false);
  });

  it('shows templates to template managers', async () => {
    await renderSignedIn(<NotificationsHome />, { 'GET /admin/notifications/templates': () => [] }, ['notifications.manage']);
    expect(await screen.findByText(t('notifications.templates.empty'))).toBeInTheDocument();
  });
});
