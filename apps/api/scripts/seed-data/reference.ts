/**
 * Reference data owned by product/admins. Seeded once (insert-if-missing) so admin edits are never overwritten.
 * Labels are English; other locales are added through the admin console (fallback to English until then).
 */
import type { Transaction } from 'kysely';
import type { DB } from '../../src/common/db/schema';
import { geohashEncode } from '../../src/common/geo/geo';

type T = [key: string, label: string, extra?: { sensitive?: boolean; metadata?: Record<string, unknown> }];

export const TAXONOMY: Record<string, T[]> = {
  gender: [['woman', 'Woman'], ['man', 'Man'], ['non_binary', 'Non-binary'], ['trans_woman', 'Trans woman'], ['trans_man', 'Trans man'], ['genderfluid', 'Genderfluid'], ['other', 'Another identity']],
  orientation: [['straight', 'Straight', { sensitive: true }], ['gay', 'Gay', { sensitive: true }], ['lesbian', 'Lesbian', { sensitive: true }], ['bisexual', 'Bisexual', { sensitive: true }], ['pansexual', 'Pansexual', { sensitive: true }], ['asexual', 'Asexual', { sensitive: true }], ['queer', 'Queer', { sensitive: true }], ['questioning', 'Questioning', { sensitive: true }]],
  dating_intent: [
    ['life_partner', 'Life partner', { metadata: { group: 'serious' } }], ['long_term', 'Long-term relationship', { metadata: { group: 'serious' } }],
    ['long_term_open_short', 'Long-term, open to short', { metadata: { group: 'open' } }], ['short_term_open_long', 'Short-term, open to long', { metadata: { group: 'open' } }],
    ['short_term', 'Short-term fun', { metadata: { group: 'casual' } }], ['friends', 'New friends', { metadata: { group: 'social' } }], ['figuring_out', 'Still figuring it out', { metadata: { group: 'open' } }],
  ],
  relationship_goal: [['marriage', 'Marriage'], ['committed', 'Committed relationship'], ['companionship', 'Companionship'], ['casual', 'Something casual'], ['friendship', 'Friendship'], ['activity_partners', 'Activity partners']],
  relationship_status: [['single', 'Single'], ['separated', 'Separated'], ['divorced', 'Divorced'], ['widowed', 'Widowed'], ['ethical_nonmonogamy', 'In an open relationship']],
  education_level: [['high_school', 'High school'], ['vocational', 'Trade / vocational'], ['undergraduate', 'Undergraduate degree'], ['postgraduate', 'Postgraduate degree'], ['doctorate', 'Doctorate'], ['prefer_not', 'Prefer not to say']],
  lifestyle_drinking: [['never', 'Never'], ['rarely', 'Rarely'], ['socially', 'Socially'], ['regularly', 'Regularly'], ['sober', 'Sober']],
  lifestyle_smoking: [['non_smoker', 'Non-smoker'], ['social_smoker', 'Social smoker'], ['smoker', 'Smoker'], ['trying_to_quit', 'Trying to quit']],
  lifestyle_cannabis: [['never', 'Never'], ['sometimes', 'Sometimes'], ['often', 'Often']],
  lifestyle_exercise: [['daily', 'Every day'], ['often', 'Often'], ['sometimes', 'Sometimes'], ['never', 'Never']],
  lifestyle_diet: [['omnivore', 'Omnivore'], ['vegetarian', 'Vegetarian'], ['vegan', 'Vegan'], ['pescatarian', 'Pescatarian'], ['halal', 'Halal'], ['kosher', 'Kosher'], ['other', 'Other']],
  lifestyle_sleep: [['early_bird', 'Early bird'], ['night_owl', 'Night owl'], ['flexible', 'Flexible']],
  lifestyle_social: [['homebody', 'Homebody'], ['balanced', 'Balanced'], ['social_butterfly', 'Social butterfly']],
  pets: [['dog', 'Dog'], ['cat', 'Cat'], ['other_pet', 'Other pets'], ['no_pets', 'No pets'], ['allergic', 'Allergic to pets'], ['want_pets', 'Want pets']],
  children_have: [['no_children', "Don't have children"], ['have_children', 'Have children'], ['prefer_not', 'Prefer not to say']],
  children_want: [['want', 'Want children'], ['dont_want', "Don't want children"], ['open', 'Open to children'], ['not_sure', 'Not sure yet']],
  family_plans: [['soon', 'Starting a family soon'], ['someday', 'Someday'], ['not_planning', 'Not planning to']],
  religion: [['agnostic', 'Agnostic', { sensitive: true }], ['atheist', 'Atheist', { sensitive: true }], ['buddhist', 'Buddhist', { sensitive: true }], ['christian', 'Christian', { sensitive: true }], ['hindu', 'Hindu', { sensitive: true }], ['jewish', 'Jewish', { sensitive: true }], ['muslim', 'Muslim', { sensitive: true }], ['sikh', 'Sikh', { sensitive: true }], ['spiritual', 'Spiritual', { sensitive: true }], ['other', 'Other', { sensitive: true }]],
  religion_importance: [['very', 'Very important', { sensitive: true }], ['somewhat', 'Somewhat important', { sensitive: true }], ['not', 'Not important', { sensitive: true }]],
  politics: [['liberal', 'Liberal', { sensitive: true }], ['moderate', 'Moderate', { sensitive: true }], ['conservative', 'Conservative', { sensitive: true }], ['apolitical', 'Not political', { sensitive: true }], ['other', 'Other', { sensitive: true }]],
  communication_style: [['texter', 'Big texter'], ['caller', 'Phone caller'], ['video', 'Video chatter'], ['in_person', 'Better in person'], ['slow_replier', 'Slow but thoughtful replies']],
  love_language: [['words', 'Words of affirmation'], ['time', 'Quality time'], ['gifts', 'Receiving gifts'], ['acts', 'Acts of service'], ['touch', 'Physical touch']],
  travel_style: [['adventurer', 'Adventurer'], ['relaxer', 'Beach & relax'], ['culture', 'Culture seeker'], ['foodie', 'Food traveller'], ['homebody', 'Prefer home']],
  zodiac: [['aries', 'Aries'], ['taurus', 'Taurus'], ['gemini', 'Gemini'], ['cancer', 'Cancer'], ['leo', 'Leo'], ['virgo', 'Virgo'], ['libra', 'Libra'], ['scorpio', 'Scorpio'], ['sagittarius', 'Sagittarius'], ['capricorn', 'Capricorn'], ['aquarius', 'Aquarius'], ['pisces', 'Pisces']],
  event_category: [['interest', 'Interest-based'], ['dating_mixer', 'Dating mixer'], ['sports_fitness', 'Sports & fitness'], ['food_cooking', 'Food & cooking'], ['travel', 'Travel'], ['arts_culture', 'Arts & culture'], ['community', 'Community']],
  report_reason: [['fake_profile', 'Fake profile or catfish'], ['scam', 'Scam or asking for money'], ['harassment', 'Harassment or bullying'], ['inappropriate_content', 'Inappropriate photos or content'], ['underage', 'Appears to be under 18'], ['hate', 'Hate speech'], ['violence', 'Threats or violence'], ['offline_safety', 'Safety concern from a date'], ['spam', 'Spam or advertising'], ['impersonation', 'Impersonating someone'], ['other', 'Something else']],
  date_stage: [['first_date', 'First date'], ['second_date', 'Second date'], ['getting_to_know', 'Getting to know each other'], ['established', 'Established']],
  budget_tier: [['free', 'Free'], ['low', '$'], ['medium', '$$'], ['high', '$$$']],
};

export const INTERESTS: Record<string, [string, string][]> = {
  'outdoors|Outdoors': [['hiking', 'Hiking'], ['camping', 'Camping'], ['climbing', 'Climbing'], ['cycling', 'Cycling'], ['surfing', 'Surfing'], ['gardening', 'Gardening']],
  'fitness|Fitness & sports': [['gym', 'Gym'], ['running', 'Running'], ['yoga', 'Yoga'], ['football', 'Football'], ['cricket', 'Cricket'], ['basketball', 'Basketball'], ['tennis', 'Tennis'], ['swimming', 'Swimming'], ['martial_arts', 'Martial arts']],
  'food|Food & drink': [['cooking', 'Cooking'], ['baking', 'Baking'], ['coffee', 'Coffee'], ['wine', 'Wine'], ['street_food', 'Street food'], ['fine_dining', 'Fine dining']],
  'arts|Arts & culture': [['museums', 'Museums'], ['theatre', 'Theatre'], ['photography', 'Photography'], ['painting', 'Painting'], ['writing', 'Writing'], ['poetry', 'Poetry']],
  'music|Music': [['live_music', 'Live music'], ['concerts', 'Concerts'], ['singing', 'Singing'], ['playing_instrument', 'Playing an instrument'], ['dancing', 'Dancing'], ['djing', 'DJing']],
  'entertainment|Entertainment': [['movies', 'Movies'], ['series', 'TV series'], ['anime', 'Anime'], ['gaming', 'Gaming'], ['board_games', 'Board games'], ['podcasts', 'Podcasts']],
  'learning|Learning & ideas': [['reading', 'Reading'], ['languages', 'Languages'], ['science', 'Science'], ['history', 'History'], ['tech', 'Technology'], ['entrepreneurship', 'Entrepreneurship']],
  'travel|Travel': [['backpacking', 'Backpacking'], ['road_trips', 'Road trips'], ['beaches', 'Beaches'], ['city_breaks', 'City breaks']],
  'social|Social & causes': [['volunteering', 'Volunteering'], ['activism', 'Activism'], ['spirituality', 'Spirituality'], ['meditation', 'Meditation'], ['pets_animals', 'Animals']],
};

export const PROMPTS: [string, string, string][] = [
  ['ideal_sunday', 'about_me', 'My ideal Sunday is…'],
  ['green_flag', 'dating', 'A green flag I look for is…'],
  ['two_truths', 'fun', 'Two truths and a lie…'],
  ['geek_out', 'about_me', 'I geek out on…'],
  ['first_date', 'dating', 'The perfect first date would be…'],
  ['looking_for', 'dating', "I'm looking for someone who…"],
  ['life_goal', 'values', 'A life goal of mine is…'],
  ['travel_story', 'fun', 'My best travel story…'],
  ['love_language_prompt', 'values', 'I feel most appreciated when…'],
  ['dealbreaker_prompt', 'values', 'A non-negotiable for me is…'],
];

export const CITIES: Array<[country: string, name: string, region: string, lat: number, lon: number, tz: string, pop: number]> = [
  ['US', 'New York', 'NY', 40.7128, -74.006, 'America/New_York', 8336817], ['US', 'Los Angeles', 'CA', 34.0522, -118.2437, 'America/Los_Angeles', 3979576],
  ['US', 'San Francisco', 'CA', 37.7749, -122.4194, 'America/Los_Angeles', 873965], ['US', 'Chicago', 'IL', 41.8781, -87.6298, 'America/Chicago', 2693976],
  ['GB', 'London', 'England', 51.5072, -0.1276, 'Europe/London', 8982000], ['GB', 'Manchester', 'England', 53.4808, -2.2426, 'Europe/London', 553230],
  ['IN', 'Hyderabad', 'Telangana', 17.385, 78.4867, 'Asia/Kolkata', 6809970], ['IN', 'Bengaluru', 'Karnataka', 12.9716, 77.5946, 'Asia/Kolkata', 8443675],
  ['IN', 'Mumbai', 'Maharashtra', 19.076, 72.8777, 'Asia/Kolkata', 12442373], ['IN', 'Delhi', 'Delhi', 28.7041, 77.1025, 'Asia/Kolkata', 11034555],
  ['IN', 'Chennai', 'Tamil Nadu', 13.0827, 80.2707, 'Asia/Kolkata', 4646732], ['DE', 'Berlin', 'Berlin', 52.52, 13.405, 'Europe/Berlin', 3644826],
  ['DE', 'Munich', 'Bavaria', 48.1351, 11.582, 'Europe/Berlin', 1471508], ['FR', 'Paris', 'Île-de-France', 48.8566, 2.3522, 'Europe/Paris', 2161000],
  ['ES', 'Madrid', 'Madrid', 40.4168, -3.7038, 'Europe/Madrid', 3223334], ['ES', 'Barcelona', 'Catalonia', 41.3874, 2.1686, 'Europe/Madrid', 1620343],
  ['BR', 'São Paulo', 'SP', -23.5505, -46.6333, 'America/Sao_Paulo', 12325232], ['BR', 'Rio de Janeiro', 'RJ', -22.9068, -43.1729, 'America/Sao_Paulo', 6747815],
  ['AE', 'Dubai', 'Dubai', 25.2048, 55.2708, 'Asia/Dubai', 3331420], ['CA', 'Toronto', 'ON', 43.6532, -79.3832, 'America/Toronto', 2731571],
  ['AU', 'Sydney', 'NSW', -33.8688, 151.2093, 'Australia/Sydney', 5312163], ['AU', 'Melbourne', 'VIC', -37.8136, 144.9631, 'Australia/Melbourne', 5078193],
];

export const ONBOARDING_FLOW_V1 = [
  { key: 'profile_basics', required: true },
  { key: 'location', required: true },
  { key: 'gender', required: true },
  { key: 'orientation', required: false },
  { key: 'dating_intent', required: true },
  { key: 'relationship_goal', required: true },
  { key: 'preferences', required: true },
  { key: 'interests', required: true },
  { key: 'lifestyle', required: false },
  { key: 'family', required: false },
  // Religion/values step only where the country enables it.
  { key: 'values', required: false, condition: { field: 'religionFieldEnabled', op: 'eq', value: true } },
  { key: 'communication_style', required: false },
  { key: 'languages', required: false },
  { key: 'photos', required: true },
  { key: 'prompts', required: false },
  { key: 'questionnaire', required: true },
  { key: 'permissions', required: false },
  { key: 'verification', required: false },
];

export const FLAGS: Array<[key: string, description: string, enabled: boolean, defaultValue: boolean]> = [
  ['matching.v2', 'New matching algorithm', false, false],
  ['questionnaire.v2', 'New questionnaire experience', false, false],
  ['ai.profile_coach', 'AI profile coach', true, true],
  ['ai.conversation_starters', 'AI conversation starters', true, true],
  ['ai.date_planner', 'AI date planner', true, true],
  ['ai.translation', 'Message translation', true, true],
  ['events', 'Events & experiences', true, true],
  ['travel_mode', 'Travel mode', true, true],
  ['crossed_paths', 'Crossed paths discovery', false, false],
  ['voice_calls', 'Voice calls', false, false],
  ['video_calls', 'Video calls', false, false],
  ['voice_messages', 'Voice messages in chat', true, true],
  ['subscriptions', 'Subscriptions & purchases', true, true],
  ['couple_space', 'Couple space', false, false],
  ['date_safety', 'Date safety mode', true, true],
];

export const FREE_TIER_LIMITS: Array<[key: string, limit: number | null, period: 'day' | 'week' | 'month' | null]> = [
  ['likes', 50, 'day'],
  ['super_likes', 1, 'week'],
  ['rewinds', 0, 'day'],
  ['ai_requests', 10, 'day'],
  ['smart_matches', 5, 'day'],
];

export const SETTINGS: Array<[key: string, value: unknown, type: 'string' | 'number' | 'boolean' | 'json' | 'duration', description: string]> = [
  ['profile.min_approved_photos', 1, 'number', 'Approved photos required to appear in discovery'],
  ['onboarding.min_photos', 2, 'number', 'Photos required to finish onboarding'],
  ['date_safety.escalate_after_overdue_min', 15, 'number', 'Minutes after a missed check-in before the trusted contact and Trust & Safety are alerted'],
  ['date_safety.recheck_after_min', 30, 'number', 'New check-in window when someone checks in after their deadline'],
  ['date_safety.max_trusted_contacts', 5, 'number', 'Trusted contacts a member can add'],
  ['date_safety.invite_resend_cooldown_min', 10, 'number', 'Minimum minutes between trusted-contact invite resends'],
  ['onboarding.min_interests', 3, 'number', 'Interests required to finish onboarding'],
  ['public.support_email', 'support@amora.app', 'string', 'Support contact shown in the app'],
  ['public.min_supported_app_version', '1.0.0', 'string', 'Clients below this version are asked to update'],
  ['public.max_prompts', 3, 'number', 'Maximum profile prompts'],
];

export const CMS: Array<[key: string, kind: string, title: string, body: string]> = [
  ['safety.meet_in_public', 'safety_tip', 'Meet in public', 'For the first few dates, meet somewhere public and busy, and arrange your own transport.'],
  ['safety.tell_a_friend', 'safety_tip', 'Tell someone your plans', 'Share where you are going and who you are meeting. Date Safety Mode can do this for you.'],
  ['safety.never_send_money', 'safety_tip', 'Never send money', 'No genuine match will ask you for money, gift cards or crypto. Report anyone who does.'],
  ['safety.stay_on_platform', 'safety_tip', 'Keep chats in the app', 'Stay in the app until you trust someone — our safety tools only work here.'],
  ['faq.what_is_compatibility', 'faq', 'How is compatibility calculated?', 'We combine your answers, values, lifestyle, intentions and interests. You can see the top reasons on every Smart Match.'],
  ['faq.delete_account', 'faq', 'How do I delete my account?', 'Settings → Privacy → Delete account. You can also download a copy of your data first.'],
];

export async function seedReference(trx: Transaction<DB>): Promise<void> {
  for (const [kind, terms] of Object.entries(TAXONOMY)) {
    for (const [position, [key, label, extra]] of terms.entries()) {
      const row = await trx
        .insertInto('taxonomy_terms')
        .values({ kind, key, position, is_sensitive: extra?.sensitive ?? false, metadata: JSON.stringify(extra?.metadata ?? {}) })
        .onConflict((oc) => oc.columns(['kind', 'key']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (row) await trx.insertInto('taxonomy_term_translations').values({ term_id: row.id, locale: 'en', label }).execute();
    }
  }

  for (const [position, [catSpec, items]] of Object.entries(INTERESTS).entries()) {
    const [catKey, catLabel] = catSpec.split('|') as [string, string];
    let cat = await trx.selectFrom('interest_categories').select('id').where('key', '=', catKey).executeTakeFirst();
    if (!cat) {
      cat = await trx.insertInto('interest_categories').values({ key: catKey, position }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('interest_category_translations').values({ category_id: cat.id, locale: 'en', label: catLabel }).execute();
    }
    for (const [i, [key, label]] of items.entries()) {
      const row = await trx.insertInto('interests').values({ key, category_id: cat.id, position: i }).onConflict((oc) => oc.column('key').doNothing()).returning('id').executeTakeFirst();
      if (row) await trx.insertInto('interest_translations').values({ interest_id: row.id, locale: 'en', label }).execute();
    }
  }

  for (const [position, [key, category, text]] of PROMPTS.entries()) {
    const row = await trx.insertInto('prompt_catalog').values({ key, category, position }).onConflict((oc) => oc.column('key').doNothing()).returning('id').executeTakeFirst();
    if (row) await trx.insertInto('prompt_catalog_translations').values({ prompt_id: row.id, locale: 'en', text }).execute();
  }

  for (const [country_code, name, admin_region, latitude, longitude, timezone, population] of CITIES) {
    const exists = await trx.selectFrom('cities').select('id').where('country_code', '=', country_code).where('name', '=', name).executeTakeFirst();
    if (!exists) await trx.insertInto('cities').values({ country_code, name, admin_region, latitude, longitude, geohash5: geohashEncode(latitude, longitude, 5), timezone, population }).execute();
  }

  const flow = await trx.selectFrom('onboarding_flows').select('version').executeTakeFirst();
  if (!flow) await trx.insertInto('onboarding_flows').values({ version: 1, status: 'published', steps: JSON.stringify(ONBOARDING_FLOW_V1), published_at: new Date() }).execute();

  for (const [key, description, enabled, default_value] of FLAGS) {
    await trx.insertInto('feature_flags').values({ key, description, enabled, default_value }).onConflict((oc) => oc.column('key').doNothing()).execute();
  }
  for (const [entitlement_key, limit_value, limit_period] of FREE_TIER_LIMITS) {
    await trx.insertInto('free_tier_limits').values({ entitlement_key, limit_value, limit_period }).onConflict((oc) => oc.column('entitlement_key').doNothing()).execute();
  }
  for (const [key, value, value_type, description] of SETTINGS) {
    await trx.insertInto('system_settings').values({ key, value: JSON.stringify(value), value_type, description }).onConflict((oc) => oc.column('key').doNothing()).execute();
  }
  for (const [position, [key, kind, title, body]] of CMS.entries()) {
    const row = await trx.insertInto('cms_entries').values({ key, kind, position, status: 'published' }).onConflict((oc) => oc.column('key').doNothing()).returning('id').executeTakeFirst();
    if (row) await trx.insertInto('cms_entry_translations').values({ entry_id: row.id, locale: 'en', title, body_md: body }).execute();
  }
}
