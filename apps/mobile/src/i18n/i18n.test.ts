import { DISTANCE_BUCKETS, ENTITLEMENT_KEYS, ErrorCodes, MESSAGE_KINDS, NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS, PROFILE_ATTRIBUTE_KINDS, TAXONOMY_KINDS } from '@amora/shared';
import fs from 'node:fs';
import path from 'node:path';
import { CLIENT_ERROR_CODES } from '../api/errors';
import { CONTENT_KINDS, LEGAL_DOC_TYPES } from '../api/types';
import { ATTRIBUTE_GROUPS } from '../features/profile/AttributesEditor';
import { IDENTITY_FIELDS } from '../features/profile/IdentityTermEditor';
import { KNOWN_STEP_KEYS } from '../onboarding/registry';
import { CONSENT_TYPES } from '../screens/settings/ConsentsScreen';
import ar from './locales/ar.json';
import en from './locales/en.json';

type Tree = { [k: string]: string | Tree };
function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

const EN = flatten(en as Tree);
const AR = flatten(ar as Tree);
const ROOT = path.resolve(__dirname, '../..');
const NAMESPACES = new Set(Object.keys(en));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' || d.name === 'test' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}
const FILES = [...sourceFiles(path.join(ROOT, 'src')), ...sourceFiles(path.join(ROOT, 'app'))];

describe('i18n resources', () => {
  it('every literal translation key referenced in code exists in English', () => {
    // Any string literal shaped like "<namespace>.<path>" is treated as a key (covers t('x'), message maps, ternaries).
    const missing: string[] = [];
    for (const f of FILES) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/['"`]([a-z][A-Za-z]*(?:\.[A-Za-z0-9_]+)+)['"`]/g)) {
        const key = m[1]!;
        if (!NAMESPACES.has(key.split('.')[0]!)) continue;
        if (!EN.has(key) && ![...EN.keys()].some((k) => k.startsWith(`${key}.`))) missing.push(`${path.relative(ROOT, f)}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('dynamic key families are complete', () => {
    const expected = [
      ...Object.keys(ErrorCodes).map((c) => `errors.${c}`),
      ...CLIENT_ERROR_CODES.map((c) => `errors.${c}`),
      ...KNOWN_STEP_KEYS.flatMap((k) => [`onboarding.steps.${k}.title`, `onboarding.steps.${k}.body`]),
      ...['display_name', 'city_id', 'gender_id', 'orientation_id', 'dating_intent_id', 'relationship_goal_id', 'attribute', 'gender_preference', 'interests', 'photos', 'prompts', 'languages'].map((r) => `onboarding.missing.${r}`),
      ...TAXONOMY_KINDS.map((k) => `profile.terms.${k}`),
      ...PROFILE_ATTRIBUTE_KINDS.map((k) => `profile.terms.${k}`),
      ...Object.keys(IDENTITY_FIELDS).map((k) => `profile.terms.${k}`),
      ...Object.keys(ATTRIBUTE_GROUPS).map((g) => `profile.attributeGroups.${g}`),
      ...['gender', 'orientation', 'datingIntent', 'relationshipGoal', 'relationshipStatus'].map((k) => `profile.identity.${k}`),
      ...['none', 'phone', 'email', 'selfie', 'identity'].map((v) => `profile.verificationLevels.${v}`),
      ...CONSENT_TYPES.map((c) => `consents.types.${c}`),
      ...CONTENT_KINDS.map((k) => `content.kinds.${k}`),
      ...LEGAL_DOC_TYPES.map((k) => `legal.types.${k}`),
      ...['native', 'fluent', 'conversational', 'learning'].map((k) => `languages.levels.${k}`),
      ...['uploading', 'processing', 'ready', 'failed', 'unknown'].map((k) => `media.processing.${k}`),
      ...['pending', 'approved', 'rejected', 'needs_review', 'unknown'].map((k) => `media.moderation.${k}`),
      ...['everyone', 'liked_only', 'nobody'].map((k) => `privacy.discoverable.${k}`),
      ...['off', '24h', '72h', '7d'].map((k) => `privacy.snoozeOptions.${k}`),
      ...['ios', 'android', 'web'].map((k) => `sessions.platforms.${k}`),
      ...DISTANCE_BUCKETS.map((b) => `discover.distance.${b}`),
      ...['swipe', 'smart', 'daily'].map((k) => `discover.surfaces.${k}`),
      ...[...MESSAGE_KINDS, 'other'].map((k) => `chat.kinds.${k}`),
      ...ENTITLEMENT_KEYS.map((k) => `premium.entitlements.${k}`),
      ...['likes', 'super_likes', 'rewinds', 'smart_matches', 'ai_requests'].map((k) => `premium.allowances.${k}`),
      ...['trialing', 'active', 'past_due', 'in_grace', 'paused', 'canceled', 'expired', 'refunded'].map((k) => `premium.subStatus.${k}`),
      ...['week', 'month', 'year'].map((k) => `premium.per.${k}`),
      ...NOTIFICATION_CATEGORIES.map((k) => `notifications.categories.${k}`),
      ...NOTIFICATION_CHANNELS.map((k) => `notifications.channels.${k}`),
      ...['pending', 'processing', 'needs_review', 'approved', 'rejected', 'expired', 'cancelled'].map((k) => `verification.status.${k}`),
      ...['none', 'selfie', 'identity'].map((k) => `verification.levels.${k}`),
      ...['selfie', 'id_front', 'id_back'].map((k) => `verification.capture.${k}`),
      ...['scheduled', 'active', 'checked_in', 'checked_out', 'overdue', 'escalated', 'sos', 'ended', 'cancelled'].map((k) => `dateSafety.status.${k}`),
      ...['interested', 'registered', 'waitlisted', 'cancelled', 'checked_in', 'no_show', 'removed'].map((k) => `events.myStatus.${k}`),
      ...['draft', 'pending_review', 'published', 'cancelled', 'completed', 'rejected'].map((k) => `events.status.${k}`),
      ...['draft', 'proposed', 'accepted', 'declined', 'rescheduled', 'cancelled', 'completed'].map((k) => `dates.status.${k}`),
      ...['received', 'verifying', 'in_progress', 'completed', 'rejected', 'cancelled'].map((k) => `dataPrivacy.status.${k}`),
      ...['answered', 'skipped', 'unanswered', 'needsReanswer'].map((k) => `questionnaire.state.${k}`),
      ...['0', '1', '2', '3'].map((k) => `questionnaire.importanceLevels.${k}`),
      ...['ended', 'declined', 'missed'].map((k) => `calls.status.${k}`),
      ...['user', 'message', 'date'].map((k) => `report.subtitle.${k}`),
      ...['bio', 'prompts', 'photos', 'interests', 'details'].map((k) => `ai.areas.${k}`),
      'errors.RATE_LIMITED_retry',
      'errors.ACCOUNT_LOCKED_retry',
    ];
    expect(expected.filter((k) => !EN.has(k))).toEqual([]);
  });

  it('Arabic has exactly the same keys as English and the same interpolation variables', () => {
    expect([...AR.keys()].sort()).toEqual([...EN.keys()].sort());
    const vars = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
    const mismatched = [...EN].filter(([k, v]) => JSON.stringify(vars(v)) !== JSON.stringify(vars(AR.get(k) ?? '')));
    expect(mismatched.map(([k]) => k)).toEqual([]);
  });

  it('no values are empty', () => {
    expect([...EN, ...AR].filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });
});

describe('no hard-coded user-facing strings', () => {
  it('JSX text and text props never contain literal words', () => {
    const offenders: string[] = [];
    const TEXT_PROPS = /\b(label|title|subtitle|placeholder|hint|accessibilityLabel|accessibilityHint|emptyTitle|emptyBody|body|submitLabel|description)=["']([^"']*[A-Za-z][^"']*)["']/g;
    for (const f of FILES.filter((x) => x.endsWith('.tsx'))) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(TEXT_PROPS)) offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`);
      // Text children: >Some words< (ignores {expressions} and symbol-only glyphs like ✓ or ›).
      for (const m of src.matchAll(/(?<![=-])>\s*([^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*)\s*</g)) {
        const text = m[1]!.trim();
        if (text && !/^[\w.]+\s*=>/.test(text) && !/[=;()]/.test(text)) offenders.push(`${path.relative(ROOT, f)}: ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
