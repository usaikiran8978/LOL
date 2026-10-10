import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, field, renderSignedIn } from '@/test/utils';
import { ChannelsPage } from './ChannelsPage';
import { emailProvider } from './test-fixtures';
import { writes } from './test-helpers';

const PUT = 'PUT /admin/notifications/channels/email/ses';

describe('ChannelsPage', () => {
  it('lists providers without ever rendering the secret reference', async () => {
    const user = userEvent.setup();
    const { container } = await renderSignedIn(<ChannelsPage />, { 'GET /admin/notifications/channels': () => [emailProvider] }, ['notifications.channels']);
    expect(await screen.findByText('ses')).toBeInTheDocument();
    expect(screen.getByText(t('notifications.channelsPage.secretConfigured'))).toBeInTheDocument();
    expect(screen.getByText('FR, DE')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('vault/ses-super-secret');

    await user.click(screen.getByRole('button', { name: `${t('common.edit')} ${t('notifications.channel.email')} ses` }));
    const d = screen.getByRole('dialog');
    const secret = within(d).getByLabelText(t('notifications.channelsPage.secretReplace'));
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toHaveValue('');
    expect(document.body.innerHTML).not.toContain('vault/ses-super-secret');
  });

  it('shows empty and error states', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<ChannelsPage />, { 'GET /admin/notifications/channels': () => (fail ? apiError(500, 'INTERNAL') : []) }, ['notifications.channels']);
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('notifications.channelsPage.empty'))).toBeInTheDocument();
  });

  it('is forbidden without notifications.channels', async () => {
    const { calls } = await renderSignedIn(<ChannelsPage />, {}, ['notifications.manage']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/admin/notifications/channels')).toBe(false);
  });

  it('keeps the stored secret reference when editing other fields, after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ChannelsPage />, { 'GET /admin/notifications/channels': () => [emailProvider], [PUT]: (c) => ({ ...emailProvider, ...(c.body as object) }) }, ['notifications.channels']);
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} ${t('notifications.channel.email')} ses` }));
    const d = screen.getByRole('dialog');
    const priority = within(d).getByLabelText(t('notifications.channelsPage.priority'));
    await user.clear(priority);
    await user.type(priority, '20');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    const confirm = screen.getByRole('dialog', { name: t('notifications.channelsPage.confirmTitle', { channel: t('notifications.channel.email'), provider: 'ses' }) });
    expect(writes(calls)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.path).toBe('/admin/notifications/channels/email/ses');
    expect(writes(calls)[0]!.body).toEqual({
      isEnabled: true, priority: 20, settings: { from: 'no-reply@amora.test', region: 'eu-west-1' }, secretRef: 'vault/ses-super-secret', countryCodes: ['FR', 'DE'],
    });
    expect(await screen.findByText(t('notifications.channelsPage.saved', { channel: t('notifications.channel.email'), provider: 'ses' }))).toBeInTheDocument();
  });

  it('replaces or clears the secret reference only on request', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ChannelsPage />, { 'GET /admin/notifications/channels': () => [emailProvider], [PUT]: (c) => c.body }, ['notifications.channels']);
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} ${t('notifications.channel.email')} ses` }));
    let d = screen.getByRole('dialog');
    await user.click(within(d).getByLabelText(t('notifications.channelsPage.secretClear')));
    expect(within(d).getByLabelText(t('notifications.channelsPage.secretReplace'))).toBeDisabled();
    await user.click(within(d).getByLabelText(t('notifications.channelsPage.enabled')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    // Disabling is called out in the confirmation.
    const confirm = screen.getByRole('dialog', { name: t('notifications.channelsPage.confirmTitle', { channel: t('notifications.channel.email'), provider: 'ses' }) });
    expect(within(confirm).getByText(t('notifications.channelsPage.confirmDisableBody'))).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toMatchObject({ isEnabled: false, secretRef: null });

    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} ${t('notifications.channel.email')} ses` }));
    d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('notifications.channelsPage.secretReplace')), 'vault/ses-v2');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await user.click(within(screen.getByRole('dialog', { name: t('notifications.channelsPage.confirmTitle', { channel: t('notifications.channel.email'), provider: 'ses' }) })).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]!.body).toMatchObject({ secretRef: 'vault/ses-v2' });
  });

  it('adds a provider with typed settings and validates its inputs', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ChannelsPage />, { 'GET /admin/notifications/channels': () => [], 'PUT /admin/notifications/channels/sms/twilio': (c) => c.body }, ['notifications.channels']);
    await user.click(await screen.findByRole('button', { name: t('notifications.channelsPage.add') }));
    const d = screen.getByRole('dialog');
    await user.selectOptions(field(t('notifications.channelsPage.channel')), 'sms');
    await user.type(field(t('notifications.channelsPage.provider')), 'Twilio!');
    await user.type(within(d).getByLabelText(t('notifications.channelsPage.countries')), 'usa');
    await user.click(within(d).getByRole('button', { name: t('notifications.kv.addRow') }));
    await user.type(within(d).getByLabelText(t('notifications.kv.key', { n: 1 })), 'rate');
    await user.selectOptions(within(d).getByLabelText(t('notifications.kv.type', { n: 1 })), 'number');
    await user.type(within(d).getByLabelText(t('notifications.kv.value', { n: 1 })), 'abc');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('notifications.channelsPage.providerInvalid'))).toBeInTheDocument();
    expect(within(d).getByText(t('validation.notNumber'))).toBeInTheDocument();
    expect(within(d).getByText(t('validation.invalidFormat'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);

    await user.clear(field(t('notifications.channelsPage.provider')));
    await user.type(field(t('notifications.channelsPage.provider')), 'twilio');
    await user.clear(within(d).getByLabelText(t('notifications.channelsPage.countries')));
    await user.type(within(d).getByLabelText(t('notifications.channelsPage.countries')), 'us, ca');
    await user.clear(within(d).getByLabelText(t('notifications.kv.value', { n: 1 })));
    await user.type(within(d).getByLabelText(t('notifications.kv.value', { n: 1 })), '5');
    await user.click(within(d).getByRole('button', { name: t('notifications.kv.addRow') }));
    await user.type(within(d).getByLabelText(t('notifications.kv.key', { n: 2 })), 'sandbox');
    await user.selectOptions(within(d).getByLabelText(t('notifications.kv.type', { n: 2 })), 'boolean');
    await user.selectOptions(within(d).getByLabelText(t('notifications.kv.value', { n: 2 })), 'true');
    await user.type(within(d).getByLabelText(t('notifications.channelsPage.secretNew')), 'vault/twilio');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await user.click(within(screen.getByRole('dialog', { name: t('notifications.channelsPage.confirmTitle', { channel: t('notifications.channel.sms'), provider: 'twilio' }) })).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.path).toBe('/admin/notifications/channels/sms/twilio');
    expect(writes(calls)[0]!.body).toEqual({ isEnabled: false, priority: 0, settings: { rate: 5, sandbox: true }, secretRef: 'vault/twilio', countryCodes: ['US', 'CA'] });
  });
});
