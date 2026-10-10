/** Admin-managed date idea catalog (grounding for the AI date planner and the ideas list). */
import type { Transaction } from 'kysely';
import type { DB } from '../../src/common/db/schema';

const IDEAS: Array<{ key: string; activity: string; budget: string; stages: string[]; interests: string[]; indoor: boolean; times: string[]; minutes: number; title: string; description: string }> = [
  { key: 'coffee_walk', activity: 'coffee', budget: 'low', stages: ['first_date'], interests: ['coffee'], indoor: false, times: ['morning', 'afternoon'], minutes: 60, title: 'Coffee and a walk', description: 'Grab coffee at a busy café, then stroll somewhere scenic nearby.' },
  { key: 'museum_visit', activity: 'culture', budget: 'low', stages: ['first_date', 'second_date'], interests: ['museums', 'history'], indoor: true, times: ['afternoon'], minutes: 120, title: 'Museum afternoon', description: 'Pick an exhibition you are both curious about and swap favourites at the end.' },
  { key: 'food_market', activity: 'food', budget: 'medium', stages: ['first_date', 'second_date'], interests: ['street_food', 'cooking'], indoor: false, times: ['afternoon', 'evening'], minutes: 90, title: 'Food market tasting', description: 'Share small plates from different stalls at a lively food market.' },
  { key: 'easy_hike', activity: 'outdoors', budget: 'free', stages: ['second_date', 'getting_to_know'], interests: ['hiking'], indoor: false, times: ['morning'], minutes: 180, title: 'Popular trail hike', description: 'An easy, well-used trail with a viewpoint — bring water and tell a friend your route.' },
  { key: 'live_music', activity: 'music', budget: 'medium', stages: ['second_date', 'getting_to_know'], interests: ['live_music', 'concerts'], indoor: true, times: ['evening'], minutes: 150, title: 'Live music night', description: 'A small venue gig — easier to talk between sets than at a big concert.' },
  { key: 'cooking_class', activity: 'class', budget: 'high', stages: ['getting_to_know', 'established'], interests: ['cooking', 'baking'], indoor: true, times: ['evening'], minutes: 150, title: 'Cooking class', description: 'Learn a dish together in a hosted class, then eat what you made.' },
  { key: 'board_game_cafe', activity: 'games', budget: 'low', stages: ['first_date', 'second_date'], interests: ['board_games', 'gaming'], indoor: true, times: ['afternoon', 'evening'], minutes: 120, title: 'Board game café', description: 'Friendly competition breaks the ice — pick a quick co-op game first.' },
  { key: 'sunset_picnic', activity: 'outdoors', budget: 'low', stages: ['second_date', 'getting_to_know', 'established'], interests: ['beaches', 'photography'], indoor: false, times: ['evening'], minutes: 120, title: 'Sunset picnic', description: 'A picnic in a busy park or beach at golden hour.' },
];

export async function seedDates(trx: Transaction<DB>): Promise<void> {
  const term = async (kind: string, key: string) => (await trx.selectFrom('taxonomy_terms').select('id').where('kind', '=', kind).where('key', '=', key).executeTakeFirst())?.id ?? null;
  for (const i of IDEAS) {
    const exists = await trx.selectFrom('date_ideas').select('id').where('key', '=', i.key).executeTakeFirst();
    if (exists) continue;
    const stages = (await Promise.all(i.stages.map((s) => term('date_stage', s)))).filter((x): x is string => !!x);
    const interests = (await trx.selectFrom('interests').select('id').where('key', 'in', i.interests).execute()).map((r) => r.id);
    const row = await trx.insertInto('date_ideas').values({
      key: i.key, activity_type: i.activity, budget_term_id: await term('budget_tier', i.budget), date_stage_term_ids: stages, interest_ids: interests, indoor: i.indoor, time_of_day: i.times, typical_duration_min: i.minutes,
    }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('date_idea_translations').values({ idea_id: row.id, locale: 'en', title: i.title, description: i.description }).execute();
  }
}
