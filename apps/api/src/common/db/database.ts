import { Kysely, PostgresDialect, Transaction } from 'kysely';
import { Pool, types } from 'pg';
import type { DB } from './schema';

// Return `date` columns as 'YYYY-MM-DD' strings instead of local-midnight Date objects.
types.setTypeParser(1082, (v) => v);
// bigint/int8 as JS numbers would silently lose precision; keep as string.
types.setTypeParser(20, (v) => v);

export type Database = Kysely<DB>;
export type Tx = Transaction<DB>;
export type { DB };
export const DATABASE = Symbol('DATABASE');

export function createDatabase(connectionString: string, max: number): Database {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max, idleTimeoutMillis: 30_000 }) }),
  });
}
