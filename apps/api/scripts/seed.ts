/**
 * Idempotent reference-data seed: languages, launch countries + compliance config, initial legal documents,
 * admin RBAC catalog, and the bootstrap Super Admin. Safe to re-run; it upserts.
 *
 * Product content beyond this (taxonomy, questionnaire, matching config v1) is seeded by the phase that owns it.
 */
import { Algorithm, hash } from '@node-rs/argon2';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { PERMISSIONS, SYSTEM_ROLES } from '@amora/shared';
import type { DB } from '../src/common/db/schema';
import { seedAi } from './seed-data/ai';
import { seedBilling } from './seed-data/billing';
import { seedCommunications } from './seed-data/communications';
import { seedDates } from './seed-data/dates';
import { seedQuestionnaire } from './seed-data/questionnaire';
import { seedReference } from './seed-data/reference';

const LANGUAGES: Array<[code: string, name: string, native: string, rtl: boolean, appLocale: boolean]> = [
  ['en', 'English', 'English', false, true],
  ['es', 'Spanish', 'Español', false, true],
  ['fr', 'French', 'Français', false, true],
  ['de', 'German', 'Deutsch', false, true],
  ['pt-BR', 'Portuguese (Brazil)', 'Português (Brasil)', false, true],
  ['it', 'Italian', 'Italiano', false, false],
  ['ar', 'Arabic', 'العربية', true, true],
  ['he', 'Hebrew', 'עברית', true, false],
  ['hi', 'Hindi', 'हिन्दी', false, true],
  ['te', 'Telugu', 'తెలుగు', false, false],
  ['ta', 'Tamil', 'தமிழ்', false, false],
  ['ja', 'Japanese', '日本語', false, false],
  ['ko', 'Korean', '한국어', false, false],
  ['zh', 'Chinese', '中文', false, false],
  ['tr', 'Turkish', 'Türkçe', false, false],
  ['id', 'Indonesian', 'Bahasa Indonesia', false, false],
];

// Launch set. min_age defaults to 18 everywhere (DEC-006); emergency numbers used by the date-safety SOS flow (DEC-016).
const COUNTRIES: Array<{ code: string; name: string; locale: string; currency: string; measurement: 'metric' | 'imperial'; emergency: string; regime: string | null; region: string }> = [
  { code: 'US', name: 'United States', locale: 'en', currency: 'USD', measurement: 'imperial', emergency: '911', regime: 'CCPA', region: 'us' },
  { code: 'GB', name: 'United Kingdom', locale: 'en', currency: 'GBP', measurement: 'metric', emergency: '999', regime: 'UK-GDPR', region: 'eu' },
  { code: 'IN', name: 'India', locale: 'en', currency: 'INR', measurement: 'metric', emergency: '112', regime: 'DPDP', region: 'in' },
  { code: 'DE', name: 'Germany', locale: 'de', currency: 'EUR', measurement: 'metric', emergency: '112', regime: 'GDPR', region: 'eu' },
  { code: 'FR', name: 'France', locale: 'fr', currency: 'EUR', measurement: 'metric', emergency: '112', regime: 'GDPR', region: 'eu' },
  { code: 'ES', name: 'Spain', locale: 'es', currency: 'EUR', measurement: 'metric', emergency: '112', regime: 'GDPR', region: 'eu' },
  { code: 'BR', name: 'Brazil', locale: 'pt-BR', currency: 'BRL', measurement: 'metric', emergency: '190', regime: 'LGPD', region: 'br' },
  { code: 'AE', name: 'United Arab Emirates', locale: 'ar', currency: 'AED', measurement: 'metric', emergency: '999', regime: 'PDPL', region: 'global' },
  { code: 'CA', name: 'Canada', locale: 'en', currency: 'CAD', measurement: 'metric', emergency: '911', regime: 'PIPEDA', region: 'us' },
  { code: 'AU', name: 'Australia', locale: 'en', currency: 'AUD', measurement: 'metric', emergency: '000', regime: 'APP', region: 'global' },
];

// Legal copy must come from counsel. These seeds exist so sign-up works end to end; they are published as v1 drafts
// and clearly labelled. Replace via Admin → Legal before launch (tracked in docs/progress.md as a launch blocker).
const LEGAL_PLACEHOLDER = (title: string) =>
  `# ${title}\n\n> **Pre-launch notice:** this document has not yet been approved by legal counsel and must be replaced ` +
  `through Admin → Legal before public launch.\n`;

export async function seed(url: string, opts: { quiet?: boolean } = {}): Promise<void> {
  const log = opts.quiet ? () => undefined : console.log;
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 2 }) }) });

  try {
    await db.transaction().execute(async (trx) => {
      for (const [code, name, native_name, is_rtl, is_app_locale] of LANGUAGES) {
        await trx.insertInto('languages').values({ code, name, native_name, is_rtl, is_app_locale })
          .onConflict((oc) => oc.column('code').doUpdateSet({ name, native_name, is_rtl, is_app_locale })).execute();
      }

      for (const c of COUNTRIES) {
        await trx.insertInto('countries').values({ code: c.code, name: c.name, default_locale: c.locale, default_currency: c.currency, measurement: c.measurement, is_active: true })
          .onConflict((oc) => oc.column('code').doUpdateSet({ name: c.name, default_locale: c.locale, default_currency: c.currency, measurement: c.measurement })).execute();
        await trx.insertInto('country_configs').values({ country_code: c.code, min_age: 18, emergency_number: c.emergency, privacy_regime: c.regime, data_region: c.region })
          .onConflict((oc) => oc.column('country_code').doNothing()).execute();
      }

      for (const [doc_type, title] of [['terms', 'Terms of Service'], ['privacy', 'Privacy Policy'], ['community_guidelines', 'Community Guidelines']] as const) {
        const exists = await trx.selectFrom('legal_documents').select('id').where('doc_type', '=', doc_type).where('locale', '=', 'en').executeTakeFirst();
        if (!exists) {
          await trx.insertInto('legal_documents').values({ doc_type, version: 1, locale: 'en', title, body_md: LEGAL_PLACEHOLDER(title), status: 'published', effective_at: new Date() }).execute();
        }
      }

      for (const [key, description] of Object.entries(PERMISSIONS)) {
        await trx.insertInto('admin_permissions').values({ key, domain: key.split('.')[0]!, description, is_sensitive: /pii|evidence|location|messages|export/.test(key) })
          .onConflict((oc) => oc.column('key').doUpdateSet({ description })).execute();
      }
      for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
        const { id } = await trx.insertInto('admin_roles').values({ key, name: role.name, description: role.description, is_system: true })
          .onConflict((oc) => oc.column('key').doUpdateSet({ name: role.name, description: role.description }))
          .returning('id').executeTakeFirstOrThrow();
        // System roles are re-synced exactly to the catalog so permission changes ship with code review.
        await trx.deleteFrom('admin_role_permissions').where('role_id', '=', id).execute();
        await trx.insertInto('admin_role_permissions').values(role.permissions.map((permission_key) => ({ role_id: id, permission_key }))).execute();
      }

      await seedReference(trx);
      await seedQuestionnaire(trx);
      await seedCommunications(trx);
      await seedBilling(trx);
      await seedAi(trx);
      await seedDates(trx);

      const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
      const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
      if (email && password) {
        if (password.length < 14) throw new Error('ADMIN_BOOTSTRAP_PASSWORD must be at least 14 characters');
        const existing = await trx.selectFrom('admin_users').select('id').where('email', '=', email).executeTakeFirst();
        if (!existing) {
          const password_hash = await hash(password, { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
          const admin = await trx.insertInto('admin_users').values({ email, display_name: 'Super Admin', password_hash, status: 'active' }).returning('id').executeTakeFirstOrThrow();
          const role = await trx.selectFrom('admin_roles').select('id').where('key', '=', 'super_admin').executeTakeFirstOrThrow();
          await trx.insertInto('admin_user_roles').values({ admin_user_id: admin.id, role_id: role.id }).execute();
          await trx.insertInto('audit_logs').values({ actor_type: 'system', action: 'admin.bootstrap_created', target_type: 'admin_user', target_id: admin.id }).execute();
          log(`created bootstrap super admin ${email} — enable MFA on first login`);
        }
      }
    });
    log('seed complete');
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  seed(url).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
