/**
 * Admin permission catalog (BRD §19, TECH §12–13). Permissions are `<domain>.<action>` strings granted
 * through roles; the API checks permissions, never role names. Seeded into admin_permissions /
 * admin_role_permissions; additional custom roles can be created by a Super Admin.
 */
export const PERMISSIONS = {
  // dashboard & analytics
  'dashboard.view': 'View KPI dashboard',
  'analytics.view': 'View analytics reports',
  'analytics.export': 'Export analytics data',
  // users
  'users.view': 'Search and view users',
  'users.view_pii': 'View user contact details and PII',
  'users.export': 'Export user lists',
  'users.suspend': 'Suspend / unsuspend users',
  'users.ban': 'Ban / unban users',
  'users.restore': 'Restore deactivated or deleted-pending users',
  'users.force_logout': 'Force logout all sessions of a user',
  'users.reset_controls': 'Reset selected account controls (e.g. lockout, MFA, verification)',
  'users.view_safety_history': 'View a user\'s safety & moderation history',
  'users.view_location': 'View a user\'s precise location (incident investigation only)',
  // profile review & verification
  'profiles.review': 'Review profiles and profile media',
  'verification.view': 'View verification queue and results',
  'verification.view_evidence': 'View verification evidence (selfie / ID images)',
  'verification.decide': 'Approve / reject verification',
  'verification.revoke': 'Unverify a user',
  // moderation
  'moderation.view': 'View reports and moderation cases',
  'moderation.assign': 'Assign cases',
  'moderation.action': 'Warn / restrict / suspend / remove content',
  'moderation.ban': 'Ban from a case',
  'moderation.escalate': 'Escalate cases',
  'moderation.appeals': 'Decide appeals',
  'moderation.view_messages': 'View reported message content',
  'moderation.rules.manage': 'Manage moderation rules & thresholds',
  // questionnaire & matching
  'questions.view': 'View questionnaire',
  'questions.edit': 'Create / edit question drafts',
  'questions.publish': 'Publish / schedule / roll back questions',
  'questions.archive': 'Archive / deactivate questions',
  'matching.view': 'View matching configuration',
  'matching.edit': 'Edit matching configuration drafts',
  'matching.publish': 'Publish matching configuration',
  'matching.test': 'Run Test Matching Rules on sample users',
  // taxonomy & config
  'taxonomy.manage': 'Manage interests, lifestyle, intents, goals taxonomy',
  'geo.manage': 'Manage countries, cities, languages and country configuration',
  'flags.manage': 'Manage feature flags',
  'experiments.manage': 'Manage A/B experiments',
  'settings.manage': 'Manage system settings',
  'onboarding.manage': 'Manage onboarding flow',
  // AI
  'ai.view': 'View AI configuration and usage',
  'ai.manage': 'Manage AI providers, models, features and limits',
  'ai.prompts.edit': 'Edit AI prompt drafts',
  'ai.prompts.publish': 'Publish AI prompt versions',
  // content
  'cms.manage': 'Manage FAQ, help, safety content and announcements',
  'legal.manage': 'Manage legal documents',
  'notifications.manage': 'Manage notification templates',
  'notifications.channels': 'Manage push / email / SMS provider configuration',
  'notifications.send_test': 'Send test notifications',
  'notifications.broadcast': 'Send system announcements',
  // events & dates
  'events.view': 'View events',
  'events.manage': 'Create / edit / moderate events',
  'date_safety.manage': 'Manage date-safety configuration',
  // billing
  'billing.view': 'View subscriptions & payments',
  'billing.plans.manage': 'Manage plans, prices & entitlements',
  'billing.refund': 'Issue refunds',
  'billing.grant': 'Grant entitlements / consumables',
  'billing.coupons.manage': 'Manage promotions & coupons',
  // privacy & admin
  'privacy.requests': 'Handle data export / deletion requests',
  'privacy.retention.manage': 'Manage data retention policies',
  'audit.view': 'View audit logs',
  'admins.manage': 'Manage admin users and roles',
} as const;

export type Permission = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as Permission[];

export const SYSTEM_ROLES: Record<string, { name: string; description: string; permissions: Permission[] }> = {
  super_admin: { name: 'Super Admin', description: 'All platform controls', permissions: ALL },
  product_admin: {
    name: 'Product Admin',
    description: 'Questions, matching, features, CMS, experiments',
    permissions: [
      'dashboard.view', 'analytics.view', 'questions.view', 'questions.edit', 'questions.publish', 'questions.archive',
      'matching.view', 'matching.edit', 'matching.publish', 'matching.test', 'taxonomy.manage', 'flags.manage',
      'experiments.manage', 'onboarding.manage', 'cms.manage', 'ai.view', 'notifications.manage', 'notifications.send_test',
      'events.view', 'users.view', 'audit.view',
    ],
  },
  trust_safety: {
    name: 'Trust & Safety',
    description: 'Reports, verification, moderation, safety',
    permissions: [
      'dashboard.view', 'users.view', 'users.view_pii', 'users.suspend', 'users.ban', 'users.force_logout',
      'users.view_safety_history', 'users.view_location', 'profiles.review', 'verification.view', 'verification.view_evidence',
      'verification.decide', 'verification.revoke', 'moderation.view', 'moderation.assign', 'moderation.action',
      'moderation.ban', 'moderation.escalate', 'moderation.appeals', 'moderation.view_messages', 'moderation.rules.manage',
      'events.view', 'events.manage', 'date_safety.manage', 'audit.view',
    ],
  },
  support: {
    name: 'Support',
    description: 'User support and limited account actions',
    permissions: [
      'users.view', 'users.view_pii', 'users.force_logout', 'users.reset_controls', 'users.restore',
      'verification.view', 'moderation.view', 'billing.view', 'privacy.requests', 'events.view',
    ],
  },
  finance_admin: {
    name: 'Finance Admin',
    description: 'Plans, payments, refunds and revenue',
    permissions: [
      'dashboard.view', 'analytics.view', 'billing.view', 'billing.plans.manage', 'billing.refund', 'billing.grant',
      'billing.coupons.manage', 'users.view',
    ],
  },
  analyst: {
    name: 'Analyst',
    description: 'Read-only analytics',
    permissions: ['dashboard.view', 'analytics.view', 'analytics.export', 'questions.view', 'matching.view', 'ai.view'],
  },
  content_admin: {
    name: 'Content Admin',
    description: 'Prompts, help content, event/content management',
    permissions: [
      'cms.manage', 'legal.manage', 'ai.view', 'ai.prompts.edit', 'notifications.manage', 'notifications.send_test',
      'events.view', 'events.manage', 'taxonomy.manage', 'questions.view',
    ],
  },
};
