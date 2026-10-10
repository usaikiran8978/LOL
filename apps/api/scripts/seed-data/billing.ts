/**
 * Products and what they grant (BRD appendix tiers). Prices are NOT seeded: each needs a real Stripe / App Store /
 * Play price id, created by a Finance Admin (launch configuration — see docs/progress.md).
 */
import type { Transaction } from 'kysely';
import type { DB } from '../../src/common/db/schema';

type Ent = [key: string, limit: number | null, period: 'day' | 'week' | 'month' | null];
const PRODUCTS: Array<{ key: string; kind: 'subscription' | 'consumable'; tier?: string; rank: number; name: string; description: string; ents: Ent[]; grant?: [string, number] }> = [
  {
    key: 'premium', kind: 'subscription', tier: 'premium', rank: 10, name: 'Premium', description: 'Unlimited likes, advanced filters, compatibility insights, incognito, travel mode and more.',
    ents: [['likes', null, null], ['rewinds', null, null], ['rewind', null, null], ['super_likes', 5, 'week'], ['smart_matches', null, null], ['advanced_filters', null, null],
      ['compatibility_insights', null, null], ['incognito', null, null], ['travel_mode', null, null], ['priority_discovery', null, null], ['see_who_liked', null, null]],
  },
  {
    key: 'ai_premium', kind: 'subscription', tier: 'ai_premium', rank: 20, name: 'AI Premium', description: 'Everything in Premium plus advanced AI coaching for your profile, conversations and dates.',
    ents: [['likes', null, null], ['rewinds', null, null], ['rewind', null, null], ['super_likes', 5, 'week'], ['smart_matches', null, null], ['advanced_filters', null, null],
      ['compatibility_insights', null, null], ['incognito', null, null], ['travel_mode', null, null], ['priority_discovery', null, null], ['see_who_liked', null, null],
      ['ai_coach_advanced', null, null], ['ai_requests', 200, 'day']],
  },
  { key: 'boost_1', kind: 'consumable', rank: 0, name: '1 Boost', description: 'Be one of the top profiles in your area for 30 minutes.', ents: [], grant: ['boost', 1] },
  { key: 'boost_5', kind: 'consumable', rank: 0, name: '5 Boosts', description: 'Five 30-minute boosts.', ents: [], grant: ['boost', 5] },
  { key: 'super_like_5', kind: 'consumable', rank: 0, name: '5 Super Likes', description: 'Stand out with a Super Like.', ents: [], grant: ['super_like', 5] },
];

export async function seedBilling(trx: Transaction<DB>): Promise<void> {
  for (const p of PRODUCTS) {
    const exists = await trx.selectFrom('billing_products').select('id').where('key', '=', p.key).executeTakeFirst();
    if (exists) continue;
    const row = await trx.insertInto('billing_products').values({ key: p.key, kind: p.kind, tier: p.tier ?? null, rank: p.rank, consumable_item_key: p.grant?.[0] ?? null, consumable_quantity: p.grant?.[1] ?? null }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('billing_product_translations').values({ product_id: row.id, locale: 'en', name: p.name, description: p.description }).execute();
    if (p.ents.length) await trx.insertInto('plan_entitlements').values(p.ents.map(([entitlement_key, limit_value, limit_period]) => ({ product_id: row.id, entitlement_key, limit_value, limit_period }))).execute();
  }
}
