import type { ChannelConfigRow, NotificationTemplate, TemplateVersionDetail } from '@/lib/api/modules/notifications';

/** Test fixtures (imported by *.test.tsx only). */
export const helloTemplate: NotificationTemplate = {
  id: 't1',
  key: 'test.hello',
  category: 'system',
  channels: ['push', 'email'],
  is_transactional: true,
  respects_quiet_hours: true,
  deep_link_pattern: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  versions: [
    { id: '00000000-0000-4000-8000-0000000000a2', template_id: 't1', version: 2, status: 'draft', published_at: null },
    { id: '00000000-0000-4000-8000-0000000000a1', template_id: 't1', version: 1, status: 'published', published_at: '2026-02-01T10:00:00Z' },
  ],
};

export const unpublishedTemplate: NotificationTemplate = {
  ...helloTemplate, id: 't2', key: 'match.new', category: 'match', channels: ['in_app'], versions: [], is_active: false,
};

export const helloV1: TemplateVersionDetail = {
  id: '00000000-0000-4000-8000-0000000000a1', template_id: 't1', version: 1, status: 'published', variables: ['name'], created_by: null, created_at: '2026-01-15T00:00:00Z',
  published_at: '2026-02-01T10:00:00Z', published_by: null,
  contents: [
    { version_id: '00000000-0000-4000-8000-0000000000a1', locale: 'en', channel: 'push', title: 'Hi', subject: null, body: 'Hello {{name}}', html_body: null },
    { version_id: '00000000-0000-4000-8000-0000000000a1', locale: 'en', channel: 'email', title: null, subject: 'Welcome', body: 'Hello {{name}} by mail', html_body: '<p>Hello {{name}}</p>' },
    { version_id: '00000000-0000-4000-8000-0000000000a1', locale: 'fr', channel: 'push', title: 'Salut', subject: null, body: 'Bonjour {{name}}', html_body: null },
  ],
};

export const emailProvider: ChannelConfigRow = {
  channel: 'email', provider: 'ses', is_enabled: true, priority: 10, settings: { from: 'no-reply@amora.test', region: 'eu-west-1' },
  secret_ref: 'vault/ses-super-secret', country_codes: ['FR', 'DE'], updated_by: null, updated_at: '2026-03-01T00:00:00Z',
};
