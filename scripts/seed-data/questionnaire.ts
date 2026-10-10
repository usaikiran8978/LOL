/**
 * Baseline compatibility model as DATA (DEC-012): compatibility categories + their signal sources, question
 * categories, starter questions (published v1), deal-breaker definitions, intent compatibility and matching config v1
 * carrying the TECH §7 example weights. Everything here is editable in the admin console; code has no defaults.
 * Insert-if-missing only, so admin edits are never overwritten.
 */
import type { Transaction } from 'kysely';
import type { DB } from '../../src/common/db/schema';

type Trx = Transaction<DB>;

const COMPAT: Array<{ key: string; label: string; source: string; weight: number; attributeKinds?: string[]; usesIntent?: boolean; usesInterests?: boolean; usesLocation?: boolean }> = [
  { key: 'relationship_intent', label: 'Relationship goals', source: 'mixed', weight: 0.25, usesIntent: true },
  { key: 'values', label: 'Values', source: 'mixed', weight: 0.2, attributeKinds: ['religion_importance', 'politics', 'children_want', 'family_plans'] },
  { key: 'personality', label: 'Personality', source: 'questionnaire', weight: 0.15 },
  { key: 'lifestyle', label: 'Lifestyle', source: 'mixed', weight: 0.15, attributeKinds: ['lifestyle_drinking', 'lifestyle_smoking', 'lifestyle_exercise', 'lifestyle_diet', 'lifestyle_sleep', 'lifestyle_social'] },
  { key: 'interests', label: 'Interests', source: 'interests', weight: 0.1, usesInterests: true },
  { key: 'communication', label: 'Communication', source: 'mixed', weight: 0.1, attributeKinds: ['communication_style', 'love_language'] },
  { key: 'location', label: 'Location', source: 'location', weight: 0.05, usesLocation: true },
];

const QCATS: Array<[key: string, label: string, compat: string]> = [
  ['goals', 'Relationship goals', 'relationship_intent'],
  ['values', 'Values & family', 'values'],
  ['personality', 'Personality', 'personality'],
  ['lifestyle', 'Lifestyle', 'lifestyle'],
  ['communication', 'Communication', 'communication'],
];

interface SeedQuestion {
  key: string; category: string; type: string; text: string; required?: boolean; weight?: number; allowDealbreaker?: boolean;
  options?: Array<[key: string, label: string, numeric?: number]>; scale?: [min: number, max: number, minLabel: string, maxLabel: string];
}

const QUESTIONS: SeedQuestion[] = [
  { key: 'relationship_pace', category: 'goals', type: 'single_choice', text: 'How quickly do you like a relationship to develop?', required: true, weight: 1.5,
    options: [['slow', 'Slow and steady', 1], ['natural', 'Let it happen naturally', 2], ['fast', 'When I know, I know', 3]] },
  { key: 'wants_children', category: 'values', type: 'single_choice', text: 'Do you want children?', required: true, weight: 3, allowDealbreaker: true,
    options: [['want', 'Yes, I want children'], ['dont_want', "No, I don't want children"], ['open', "I'm open to it"], ['have_and_done', 'I have children and want no more']] },
  { key: 'family_importance', category: 'values', type: 'scale', text: 'How important is family in your daily life?', weight: 1.5, scale: [1, 5, 'Not very', 'Extremely'] },
  { key: 'ambition', category: 'values', type: 'scale', text: 'How central is your career to your life right now?', weight: 1, scale: [1, 5, 'Not central', 'Very central'] },
  { key: 'introvert_extrovert', category: 'personality', type: 'scale', text: 'After a long week, how do you recharge?', required: true, weight: 1, scale: [1, 5, 'Quiet time alone', 'Out with people'] },
  { key: 'planner_spontaneous', category: 'personality', type: 'scale', text: 'Are you more of a planner or spontaneous?', weight: 1, scale: [1, 5, 'Planner', 'Spontaneous'] },
  { key: 'humor_style', category: 'personality', type: 'multiple_choice', text: 'What makes you laugh?', weight: 0.5,
    options: [['witty', 'Witty banter'], ['silly', 'Silly and goofy'], ['dark', 'Dark humour'], ['dry', 'Dry and sarcastic'], ['wholesome', 'Wholesome']] },
  { key: 'weekend_style', category: 'lifestyle', type: 'single_choice', text: 'Your ideal weekend looks like…', weight: 1,
    options: [['adventure', 'Out exploring', 3], ['social', 'Friends and plans', 2], ['cozy', 'Cozy at home', 1]] },
  { key: 'tidiness', category: 'lifestyle', type: 'scale', text: 'How tidy are you?', weight: 0.5, scale: [1, 5, 'Relaxed', 'Spotless'] },
  { key: 'conflict_style', category: 'communication', type: 'single_choice', text: 'When there is a disagreement, you prefer to…', required: true, weight: 1.5,
    options: [['talk_now', 'Talk it out right away', 1], ['cool_off', 'Cool off first, then talk', 2], ['avoid', 'Let it pass', 3]] },
  { key: 'texting_frequency', category: 'communication', type: 'scale', text: 'How much do you like to text during the day?', weight: 1, scale: [1, 5, 'Rarely', 'All day'] },
  { key: 'ranking_priorities', category: 'values', type: 'ranking', text: 'Rank what matters most in a partner', weight: 1,
    options: [['kindness', 'Kindness'], ['humor', 'Sense of humour'], ['ambition', 'Ambition'], ['loyalty', 'Loyalty'], ['adventure', 'Adventurousness']] },
];

const DEAL_BREAKERS: Array<{ key: string; subject: string; questionKey?: string; attributeKind?: string; entitlement?: string | null }> = [
  { key: 'children', subject: 'question', questionKey: 'wants_children', entitlement: null },
  { key: 'smoking', subject: 'attribute', attributeKind: 'lifestyle_smoking', entitlement: 'advanced_filters' },
  { key: 'religion', subject: 'attribute', attributeKind: 'religion', entitlement: 'advanced_filters' },
  { key: 'age', subject: 'age', entitlement: null },
  { key: 'distance', subject: 'distance', entitlement: null },
  { key: 'verified_only', subject: 'verification', entitlement: 'advanced_filters' },
];

// Intent group compatibility (by taxonomy metadata.group). Hard exclusions are deliberately absent: people choose.
const GROUP_SCORES: Record<string, number> = {
  'serious|serious': 1, 'serious|open': 0.7, 'serious|casual': 0.15, 'serious|social': 0.2,
  'open|open': 0.9, 'open|casual': 0.6, 'open|social': 0.4, 'casual|casual': 1, 'casual|social': 0.3, 'social|social': 1,
};

export async function seedQuestionnaire(trx: Trx): Promise<void> {
  const compatIds = new Map<string, string>();
  for (const [position, c] of COMPAT.entries()) {
    let row = await trx.selectFrom('compatibility_categories').select('id').where('key', '=', c.key).executeTakeFirst();
    if (!row) {
      row = await trx.insertInto('compatibility_categories').values({
        key: c.key, source: c.source, position, attribute_kinds: c.attributeKinds ?? [], uses_intent: !!c.usesIntent, uses_interests: !!c.usesInterests, uses_location: !!c.usesLocation,
      }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('compatibility_category_translations').values({ category_id: row.id, locale: 'en', label: c.label }).execute();
    }
    compatIds.set(c.key, row.id);
  }

  const qcatIds = new Map<string, string>();
  for (const [position, [key, label, compat]] of QCATS.entries()) {
    let row = await trx.selectFrom('question_categories').select('id').where('key', '=', key).executeTakeFirst();
    if (!row) {
      row = await trx.insertInto('question_categories').values({ key, position, compatibility_category_id: compatIds.get(compat)! }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('question_category_translations').values({ category_id: row.id, locale: 'en', label }).execute();
    }
    qcatIds.set(key, row.id);
  }

  const questionIds = new Map<string, string>();
  for (const [position, q] of QUESTIONS.entries()) {
    const existing = await trx.selectFrom('questions').select('id').where('key', '=', q.key).executeTakeFirst();
    if (existing) { questionIds.set(q.key, existing.id); continue; }
    const question = await trx.insertInto('questions').values({ key: q.key, category_id: qcatIds.get(q.category)!, position, is_active: true }).returning('id').executeTakeFirstOrThrow();
    const version = await trx.insertInto('question_versions').values({
      question_id: question.id, version: 1, status: 'published', answer_type: q.type, is_required: !!q.required, weight: q.weight ?? 1,
      is_scored: q.type !== 'text', allow_dealbreaker: !!q.allowDealbreaker, allow_skip: !q.required,
      scale_min: q.scale?.[0] ?? null, scale_max: q.scale?.[1] ?? null, scale_step: q.scale ? 1 : null, published_at: new Date(), change_note: 'Seed v1',
    }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('question_version_translations').values({ version_id: version.id, locale: 'en', text: q.text, scale_min_label: q.scale?.[2] ?? null, scale_max_label: q.scale?.[3] ?? null }).execute();
    for (const [i, [key, label, numeric]] of (q.options ?? []).entries()) {
      const o = await trx.insertInto('question_options').values({ version_id: version.id, key, position: i, numeric_value: numeric ?? null }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('question_option_translations').values({ option_id: o.id, locale: 'en', label }).execute();
    }
    await trx.updateTable('questions').set({ published_version_id: version.id }).where('id', '=', question.id).execute();
    questionIds.set(q.key, question.id);
  }

  for (const d of DEAL_BREAKERS) {
    await trx.insertInto('deal_breakers').values({
      key: d.key, subject_type: d.subject, question_id: d.questionKey ? questionIds.get(d.questionKey)! : null, attribute_kind: d.attributeKind ?? null,
      mode: 'user_optional', requires_entitlement: d.entitlement ?? null,
    }).onConflict((oc) => oc.column('key').doNothing()).execute();
  }

  const cfg = await trx.selectFrom('matching_config_versions').select('id').executeTakeFirst();
  if (!cfg) {
    const v1 = await trx.insertInto('matching_config_versions').values({
      version: 1, status: 'published', min_compatibility: 30, candidate_pool_limit: 2000, recommendation_batch_size: 50, daily_curated_count: 10,
      behavioral_weight: 0.15, diversity_max_share: 0.6, diversity_dimensions: ['age_band', 'intent'], repeat_suppression_days: 30,
      safety_exclude_threshold: 0.85, safety_downrank_threshold: 0.6, safety_downrank_factor: 0.5, missing_answer_policy: 'neutral',
      min_confidence: 0.3, notes: 'Seed v1 — TECH §7 example weights', published_at: new Date(),
    }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('matching_weights').values(COMPAT.map((c) => ({ config_version_id: v1.id, compatibility_category_id: compatIds.get(c.key)!, weight: c.weight }))).execute();
    await trx.insertInto('ranking_rules').values([
      { config_version_id: v1.id, key: 'boost_verified', rule_type: 'boost', condition: JSON.stringify({ field: 'verified', op: 'eq', value: true }), value: 0.1, priority: 0 },
      { config_version_id: v1.id, key: 'boost_active_boost', rule_type: 'boost', condition: JSON.stringify({ field: 'boosted', op: 'eq', value: true }), value: 0.5, priority: 1 },
      { config_version_id: v1.id, key: 'boost_priority_discovery', rule_type: 'boost', condition: JSON.stringify({ field: 'priorityDiscovery', op: 'eq', value: true }), value: 0.15, priority: 4 },
      { config_version_id: v1.id, key: 'penalty_inactive', rule_type: 'penalty', condition: JSON.stringify({ field: 'inactiveDays', op: 'gt', value: 14 }), value: 0.3, priority: 2 },
      { config_version_id: v1.id, key: 'penalty_no_bio', rule_type: 'penalty', condition: JSON.stringify({ field: 'hasBio', op: 'eq', value: false }), value: 0.05, priority: 3 },
    ]).execute();
    const intents = await trx.selectFrom('taxonomy_terms').select(['id', 'metadata']).where('kind', '=', 'dating_intent').execute();
    const group = (m: unknown) => ((m as { group?: string }).group ?? 'open');
    const rows = [];
    for (const a of intents) for (const b of intents) {
      const ga = group(a.metadata), gb = group(b.metadata);
      const score = a.id === b.id ? 1 : (GROUP_SCORES[`${ga}|${gb}`] ?? GROUP_SCORES[`${gb}|${ga}`] ?? 0.5);
      rows.push({ config_version_id: v1.id, intent_a_id: a.id, intent_b_id: b.id, score, is_hard_exclusion: false });
    }
    if (rows.length) await trx.insertInto('intent_compatibility').values(rows).execute();
  }
}
