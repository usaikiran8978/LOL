import { sql } from 'kysely';
import type { Database, Tx } from './database';

/** True if either user has blocked the other. Every cross-user read/write path must check this. */
export async function blockedEitherWay(db: Database | Tx, a: string, b: string): Promise<boolean> {
  const row = await db
    .selectFrom('blocks')
    .select(sql<number>`1`.as('x'))
    .where((eb) => eb.or([eb.and([eb('blocker_id', '=', a), eb('blocked_id', '=', b)]), eb.and([eb('blocker_id', '=', b), eb('blocked_id', '=', a)])]))
    .executeTakeFirst();
  return !!row;
}

/** Active match between two users, if any. */
export async function activeMatch(db: Database | Tx, a: string, b: string): Promise<{ id: string } | undefined> {
  const [low, high] = a < b ? [a, b] : [b, a];
  return db.selectFrom('matches').select('id').where('user_low_id', '=', low).where('user_high_id', '=', high).where('status', '=', 'active').executeTakeFirst();
}
