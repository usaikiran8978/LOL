/** Notification templates, icebreakers, moderation rules and retention policies — all admin-editable data. */
import type { Transaction } from 'kysely';
import type { DB } from '../../src/common/db/schema';

type Content = { locale: string; channel: 'push' | 'email' | 'sms' | 'in_app'; title?: string; subject?: string; body: string };
type Template = { key: string; category: string; channels: Array<'push' | 'email' | 'sms' | 'in_app'>; deepLink?: string; quiet?: boolean; variables: string[]; contents: Content[] };

const both = (title: string, body: string): Content[] => [
  { locale: 'en', channel: 'push', title, body },
  { locale: 'en', channel: 'in_app', title, body },
];

export const TEMPLATES: Template[] = [
  {
    key: 'auth.otp', category: 'system', channels: ['email', 'sms'], quiet: false, variables: ['code', 'minutes'],
    contents: [
      { locale: 'en', channel: 'email', subject: 'Your verification code', body: '{{code}} is your verification code. It expires in {{minutes}} minutes. Never share this code with anyone.' },
      { locale: 'en', channel: 'sms', body: '{{code}} is your verification code. It expires in {{minutes}} min. Never share it.' },
      { locale: 'es', channel: 'email', subject: 'Tu código de verificación', body: '{{code}} es tu código de verificación. Caduca en {{minutes}} minutos. No lo compartas con nadie.' },
      { locale: 'es', channel: 'sms', body: '{{code}} es tu código. Caduca en {{minutes}} min. No lo compartas.' },
    ],
  },
  { key: 'match.new', category: 'match', channels: ['push', 'in_app'], deepLink: '{{scheme}}://matches/{{matchId}}', variables: ['name'], contents: both("It's a match!", 'You and {{name}} liked each other. Say hello!') },
  { key: 'message.new', category: 'message', channels: ['push', 'in_app'], deepLink: '{{scheme}}://chat/{{conversationId}}', variables: ['name'], contents: both('{{name}}', 'sent you a message') },
  { key: 'call.incoming', category: 'message', channels: ['push', 'in_app'], deepLink: '{{scheme}}://chat/{{conversationId}}', variables: ['name', 'kind'], contents: both('Incoming {{kind}} call', '{{name}} is calling you') },
  { key: 'like.new', category: 'like', channels: ['push', 'in_app'], deepLink: '{{scheme}}://likes', variables: [], contents: both('Someone likes you', 'Open the app to see who.') },
  { key: 'like.super', category: 'like', channels: ['push', 'in_app'], deepLink: '{{scheme}}://likes', variables: [], contents: both('You got a Super Like!', 'Someone really wants to meet you.') },
  { key: 'ai.recommendation', category: 'ai_recommendation', channels: ['push', 'in_app'], deepLink: '{{scheme}}://discover/smart', variables: [], contents: both('Your Smart Matches are ready', "We've picked today's most compatible people for you.") },
  { key: 'event.cancelled', category: 'event', channels: ['push', 'in_app', 'email'], deepLink: '{{scheme}}://events/{{eventId}}', variables: ['event', 'eventId'], contents: [...both('Event cancelled', '{{event}} has been cancelled. Any ticket payment is refunded automatically.'), { locale: 'en', channel: 'email', subject: 'Cancelled: {{event}}', body: '{{event}} has been cancelled. If you paid for a ticket, it is refunded automatically to your original payment method.' }] },
  { key: 'event.waitlist_promoted', category: 'event', channels: ['push', 'in_app'], deepLink: '{{scheme}}://events/{{eventId}}', variables: ['event', 'eventId'], contents: both("You're in!", 'A spot opened up at {{event}}. Your check-in code is in the event page.') },
  { key: 'event.updated', category: 'event', channels: ['push', 'in_app', 'email'], deepLink: '{{scheme}}://events/{{eventId}}', variables: ['event', 'eventId', 'note'], contents: [...both('Event details changed', 'The time or place of {{event}} has changed. {{note}}'), { locale: 'en', channel: 'email', subject: 'Updated: {{event}}', body: 'The time or place of {{event}} has changed. {{note}}\n\nOpen the event in the app for the new details.' }] },
  { key: 'event.approved', category: 'event', channels: ['push', 'in_app'], deepLink: '{{scheme}}://events/{{eventId}}', variables: ['event', 'eventId'], contents: both('Your event is live', '{{event}} is now visible to members.') },
  { key: 'event.rejected', category: 'event', channels: ['push', 'in_app'], deepLink: '{{scheme}}://events/{{eventId}}', variables: ['event', 'eventId', 'note'], contents: both('Your event needs changes', '{{event}} was not approved. {{note}}') },
  { key: 'event.reminder', category: 'event', channels: ['push', 'in_app', 'email'], deepLink: '{{scheme}}://events/{{eventId}}', variables: ['event', 'time'], contents: [...both('Upcoming: {{event}}', 'Starts {{time}}.'), { locale: 'en', channel: 'email', subject: 'Reminder: {{event}}', body: 'Your event {{event}} starts {{time}}. See you there!' }] },
  { key: 'date.reminder', category: 'date', channels: ['push', 'in_app'], deepLink: '{{scheme}}://dates/{{datePlanId}}', variables: ['name', 'time'], contents: both('Date with {{name}}', 'Your date starts {{time}}. Safety Mode is one tap away.') },
  { key: 'date.proposed', category: 'date', channels: ['push', 'in_app'], deepLink: '{{scheme}}://dates/{{datePlanId}}', variables: ['name'], contents: both('{{name}} suggested a date', 'Take a look and reply.') },
  { key: 'date.feedback_request', category: 'date', channels: ['push', 'in_app'], deepLink: '{{scheme}}://dates/{{datePlanId}}/feedback', variables: ['name'], contents: both('How was your date?', 'Your private feedback about {{name}} helps us find better matches.') },
  { key: 'safety.checkin_due', category: 'safety', channels: ['push', 'in_app', 'sms'], quiet: false, deepLink: '{{scheme}}://safety/{{sessionId}}', variables: [], contents: [...both('Are you OK?', 'Please check in for your date.'), { locale: 'en', channel: 'sms', body: 'Please check in for your date in the app. If you need help, contact local emergency services.' }] },
  { key: 'safety.trusted_contact_alert', category: 'safety', channels: ['sms', 'email'], quiet: false, variables: ['name', 'link', 'emergency'], contents: [
    { locale: 'en', channel: 'sms', body: '{{name}} has not checked in from a date and listed you as a trusted contact. Details: {{link}} . In an emergency call {{emergency}}.' },
    { locale: 'en', channel: 'email', subject: 'Safety alert for {{name}}', body: '{{name}} has not checked in from a date and listed you as a trusted contact.\n\nDate details: {{link}}\n\nIf you believe they are in danger, call {{emergency}}.' },
  ] },
  { key: 'safety.trusted_contact_resolved', category: 'safety', channels: ['sms', 'email'], quiet: false, variables: ['name', 'link', 'emergency'], contents: [
    { locale: 'en', channel: 'sms', body: '{{name}} has checked in and is OK. Thank you for being their trusted contact.' },
    { locale: 'en', channel: 'email', subject: '{{name}} has checked in', body: '{{name}} has checked in from their date and is OK. No action is needed.\n\nThank you for being their trusted contact.' },
  ] },
  { key: 'safety.trusted_contact_invite', category: 'safety', channels: ['sms', 'email'], quiet: false, variables: ['name', 'link'], contents: [
    { locale: 'en', channel: 'sms', body: '{{name}} would like to add you as a trusted contact for date safety alerts. Confirm: {{link}}' },
    { locale: 'en', channel: 'email', subject: '{{name}} added you as a trusted contact', body: '{{name}} would like you to receive safety alerts if they miss a date check-in. Confirm here: {{link}}' },
  ] },
  { key: 'verification.result', category: 'verification', channels: ['push', 'in_app'], deepLink: '{{scheme}}://settings/verification', variables: ['result'], contents: both('Verification update', 'Your verification was {{result}}.') },
  { key: 'subscription.renewal', category: 'subscription', channels: ['email', 'in_app'], deepLink: '{{scheme}}://settings/subscription', variables: ['plan', 'date'], contents: [{ locale: 'en', channel: 'in_app', title: 'Subscription renewing', body: 'Your {{plan}} renews on {{date}}.' }, { locale: 'en', channel: 'email', subject: 'Your {{plan}} renews soon', body: 'Your {{plan}} subscription renews on {{date}}. Manage it any time in Settings.' }] },
  { key: 'subscription.payment_failed', category: 'subscription', channels: ['email', 'push', 'in_app'], deepLink: '{{scheme}}://settings/subscription', variables: ['plan'], contents: [...both('Payment issue', "We couldn't renew {{plan}}. Update your payment method to keep your benefits."), { locale: 'en', channel: 'email', subject: 'Action needed: payment for {{plan}}', body: "We couldn't process the renewal for {{plan}}. Please update your payment method." }] },
  { key: 'moderation.action', category: 'moderation', channels: ['in_app', 'email'], quiet: false, deepLink: '{{scheme}}://settings/account-status', variables: ['action'], contents: [{ locale: 'en', channel: 'in_app', title: 'Account notice', body: 'A moderation action was taken on your account: {{action}}. You can appeal from Settings.' }, { locale: 'en', channel: 'email', subject: 'Notice about your account', body: 'A moderation action was taken on your account: {{action}}. You can review it and appeal in the app under Settings → Account status.' }] },
  { key: 'admin.invite', category: 'system', channels: ['email'], quiet: false, variables: ['link', 'hours'], contents: [{ locale: 'en', channel: 'email', subject: 'You have been invited to the admin console', body: 'Set your password within {{hours}} hours: {{link}}\n\nYou will be asked to enable two-factor authentication on first sign-in.' }] },
  { key: 'event.checked_in', category: 'event', channels: ['in_app'], quiet: false, deepLink: '{{scheme}}://events/{{eventId}}', variables: ['event', 'eventId'], contents: [{ locale: 'en', channel: 'in_app', title: 'Checked in', body: 'Enjoy {{event}}!' }] },
  { key: 'system.announcement', category: 'system', channels: ['push', 'in_app'], variables: ['title', 'body'], contents: both('{{title}}', '{{body}}') },
  { key: 'privacy.export_ready', category: 'system', channels: ['email', 'in_app'], quiet: false, deepLink: '{{scheme}}://settings/privacy', variables: ['link'], contents: [{ locale: 'en', channel: 'in_app', title: 'Your data export is ready', body: 'Download it from Settings → Privacy within 7 days.' }, { locale: 'en', channel: 'email', subject: 'Your data export is ready', body: 'Your data export is ready. Download it within 7 days: {{link}}' }] },
];

const ICEBREAKERS: Array<[key: string, type: string, ref: string | null, text: string]> = [
  ['shared_interest_any', 'shared_interest', null, 'I see we both love {{interest}} — what got you into it?'],
  ['shared_hiking', 'shared_interest', 'hiking', 'Fellow hiker! What is the best trail you have done?'],
  ['shared_coffee', 'shared_interest', 'coffee', 'Important question: how do you take your coffee?'],
  ['prompt_ideal_sunday', 'prompt', 'ideal_sunday', 'Your ideal Sunday sounds great — what would you add to it?'],
  ['prompt_two_truths', 'prompt', 'two_truths', 'Okay, I have a guess about your two truths and a lie…'],
  ['generic_hello', 'generic', null, 'Hi {{name}}! What has been the best part of your week?'],
];

const MODERATION_RULES: Array<{ key: string; type: 'keyword' | 'regex'; scope: string; config: Record<string, unknown> }> = [
  { key: 'scam_money_requests', type: 'keyword', scope: 'message', config: { terms: ['gift card', 'western union', 'moneygram', 'send money', 'wire transfer', 'bitcoin', 'crypto investment', 'investment opportunity', 'pay for my ticket'], action: 'warn', score: 0.6, signal: 'scam' } },
  { key: 'off_platform_move', type: 'regex', scope: 'message', config: { pattern: '\\b(whats\\s?app|telegram|signal|snap(chat)?|kik)\\b', flags: 'iu', action: 'warn', score: 0.25, signal: 'off_platform_payment' } },
  { key: 'phone_number_early', type: 'regex', scope: 'message', config: { pattern: '\\+?\\d[\\d\\s().-]{8,}\\d', flags: 'u', action: 'warn', score: 0.15, signal: 'spam' } },
  { key: 'threats', type: 'keyword', scope: 'message', config: { terms: ['i will kill you', 'i will hurt you', 'i know where you live'], action: 'hide', score: 0.95, signal: 'violence' } },
  { key: 'profile_contact_details', type: 'regex', scope: 'profile_text', config: { pattern: '(@[a-z0-9_.]{3,}|\\+?\\d[\\d\\s().-]{8,}\\d)', flags: 'iu', action: 'warn', score: 0.3, signal: 'spam' } },
  { key: 'profile_scam_terms', type: 'keyword', scope: 'profile_text', config: { terms: ['sugar daddy', 'cashapp', 'onlyfans', 'investment'], action: 'warn', score: 0.5, signal: 'scam' } },
];

const RETENTION: Array<[entity: string, days: number, action: 'delete' | 'anonymize']> = [
  ['messages', 730, 'delete'],
  ['verification_evidence', 30, 'delete'],
  ['crossed_path_sightings', 14, 'delete'],
  ['ai_requests', 365, 'delete'],
  ['analytics_events', 760, 'anonymize'],
  ['date_safety_locations', 30, 'delete'],
  ['notifications', 180, 'delete'],
];

export async function seedCommunications(trx: Transaction<DB>): Promise<void> {
  for (const t of TEMPLATES) {
    const exists = await trx.selectFrom('notification_templates').select('id').where('key', '=', t.key).executeTakeFirst();
    if (exists) continue;
    const tpl = await trx.insertInto('notification_templates').values({ key: t.key, category: t.category, channels: t.channels, respects_quiet_hours: t.quiet ?? true, deep_link_pattern: t.deepLink ?? null }).returning('id').executeTakeFirstOrThrow();
    const v = await trx.insertInto('notification_template_versions').values({ template_id: tpl.id, version: 1, status: 'published', variables: t.variables, published_at: new Date() }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('notification_template_contents').values(t.contents.map((c) => ({ version_id: v.id, locale: c.locale, channel: c.channel, title: c.title ?? null, subject: c.subject ?? null, body: c.body }))).execute();
  }
  for (const [key, trigger_type, trigger_ref, text] of ICEBREAKERS) {
    const row = await trx.insertInto('icebreaker_templates').values({ key, trigger_type, trigger_ref }).onConflict((oc) => oc.column('key').doNothing()).returning('id').executeTakeFirst();
    if (row) await trx.insertInto('icebreaker_template_translations').values({ template_id: row.id, locale: 'en', text }).execute();
  }
  for (const r of MODERATION_RULES) {
    await trx.insertInto('moderation_rules').values({ key: r.key, rule_type: r.type, scope: r.scope, config: JSON.stringify(r.config) }).onConflict((oc) => oc.column('key').doNothing()).execute();
  }
  for (const [entity, retention_days, action] of RETENTION) {
    await trx.insertInto('retention_policies').values({ entity, retention_days, action }).onConflict((oc) => oc.column('entity').doNothing()).execute();
  }
}
