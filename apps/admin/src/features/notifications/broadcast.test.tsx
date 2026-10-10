import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, field, renderSignedIn } from '@/test/utils';
import { BroadcastPage } from './BroadcastPage';
import { helloTemplate, unpublishedTemplate } from './test-fixtures';
import { writes } from './test-helpers';

const confirmLabel = (phrase: string) => t('confirmText.label', { phrase });

describe('BroadcastPage', () => {
  it('estimates the audience with a dry run, then sends only after the typed confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<BroadcastPage />, {
      'GET /admin/notifications/templates': () => [helloTemplate, unpublishedTemplate],
      'POST /admin/notifications/broadcast': (c) => ((c.body as { dryRun: boolean }).dryRun ? { dryRun: true, audienceUpperBound: 1234 } : { dryRun: false, queued: 1234 }),
    }, ['notifications.broadcast', 'notifications.manage']);
    const select = await screen.findByLabelText(t('notifications.broadcast.template'), { exact: false });
    // Only active templates with a published version are offered.
    expect(within(select).queryByRole('option', { name: 'match.new' })).toBeNull();
    await user.selectOptions(select, 'test.hello');
    await user.type(screen.getByLabelText(t('notifications.broadcast.countries')), 'us, fr');
    await user.click(screen.getByRole('button', { name: t('notifications.kv.addRow') }));
    await user.type(screen.getByLabelText(t('notifications.kv.key', { n: 1 })), 'title');
    await user.type(screen.getByLabelText(t('notifications.kv.value', { n: 1 })), 'Hello');

    await user.click(screen.getByRole('button', { name: t('notifications.broadcast.estimate') }));
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(writes(calls)[0]!.body).toEqual({ templateKey: 'test.hello', segmentKey: null, countryCodes: ['US', 'FR'], variables: { title: 'Hello' }, dryRun: true });

    await user.click(screen.getByRole('button', { name: t('notifications.broadcast.send') }));
    const confirm = screen.getByRole('dialog', { name: t('notifications.broadcast.confirmTitle') });
    expect(within(confirm).getByText(t('notifications.broadcast.confirmAudience', { count: '1,234' }))).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: t('notifications.broadcast.send') }));
    expect(within(confirm).getByText(t('confirmText.mismatch'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(1);
    await user.type(within(confirm).getByLabelText(confirmLabel('test.hello'), { exact: false }), 'test.hello');
    await user.click(within(confirm).getByRole('button', { name: t('notifications.broadcast.send') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]!.body).toEqual({ templateKey: 'test.hello', segmentKey: null, countryCodes: ['US', 'FR'], variables: { title: 'Hello' }, dryRun: false });
    expect(await screen.findByText(t('notifications.broadcast.queued', { count: '1,234' }))).toBeInTheDocument();
  });

  it('types the template key when the admin cannot list templates, and validates inputs', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<BroadcastPage />, {}, ['notifications.broadcast']);
    await user.type(field(t('notifications.broadcast.template')), 'Bad Key');
    await user.type(screen.getByLabelText(t('notifications.broadcast.countries')), 'France');
    await user.type(screen.getByLabelText(t('notifications.broadcast.segment')), 'Bad-Segment');
    await user.click(screen.getByRole('button', { name: t('notifications.broadcast.send') }));
    expect(screen.getAllByText(t('validation.invalidFormat')).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.some((c) => c.path === '/admin/notifications/templates')).toBe(false);
    expect(writes(calls)).toHaveLength(0);
  });

  it('warns when sending without an estimate for the current settings and shows API errors', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<BroadcastPage />, { 'POST /admin/notifications/broadcast': () => apiError(404, 'TEMPLATE_NOT_FOUND') }, ['notifications.broadcast']);
    await user.type(field(t('notifications.broadcast.template')), 'system.announcement');
    await user.click(screen.getByRole('button', { name: t('notifications.broadcast.estimate') }));
    expect(await screen.findByText(t('errors.TEMPLATE_NOT_FOUND'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('notifications.broadcast.send') }));
    const confirm = screen.getByRole('dialog');
    expect(within(confirm).getByText(t('notifications.broadcast.confirmNoEstimate'))).toBeInTheDocument();
    await user.type(within(confirm).getByLabelText(confirmLabel('system.announcement'), { exact: false }), 'system.announcement');
    await user.click(within(confirm).getByRole('button', { name: t('notifications.broadcast.send') }));
    expect(await within(confirm).findByText(t('errors.TEMPLATE_NOT_FOUND'))).toBeInTheDocument();
  });

  it('is forbidden without notifications.broadcast', async () => {
    await renderSignedIn(<BroadcastPage />, {}, ['notifications.manage']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
  });
});
