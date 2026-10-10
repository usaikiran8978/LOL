import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { loadConfig } from '../src/common/config/config';
import { ENCRYPTED_COLUMNS, FieldEncryption, parseRetiredKeys } from '../src/common/crypto/field-encryption';

/**
 * Re-encrypts every FieldEncryption column with the current key (FIELD_ENCRYPTION_KEY / _VERSION).
 * Run after deploying a new key with the old one listed in FIELD_ENCRYPTION_RETIRED_KEYS; when it reports 0 remaining,
 * the retired key can be removed from config. Idempotent and resumable (rows already on the current key are skipped).
 */
export async function rotate(log: (m: string) => void = console.log): Promise<number> {
  const cfg = loadConfig();
  const enc = new FieldEncryption(cfg.FIELD_ENCRYPTION_KEY, cfg.FIELD_ENCRYPTION_KEY_VERSION, parseRetiredKeys(cfg.FIELD_ENCRYPTION_RETIRED_KEYS));
  const db = new Kysely<Record<string, Record<string, unknown>>>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: cfg.DATABASE_URL, max: 2 }) }) });
  let total = 0;
  try {
    for (const { table, id, column } of ENCRYPTED_COLUMNS) {
      let n = 0;
      for (;;) {
        // Only rows whose leading version byte differs from the current key; batches keep transactions short.
        const rows = await sql<{ id: string; blob: Buffer }>`
          SELECT ${sql.ref(id)}::text AS id, ${sql.ref(column)} AS blob FROM ${sql.table(table)}
          WHERE ${sql.ref(column)} IS NOT NULL AND get_byte(${sql.ref(column)}, 0) <> ${enc.currentVersion}
          LIMIT 500`.execute(db);
        if (!rows.rows.length) break;
        await db.transaction().execute(async (trx) => {
          for (const r of rows.rows) {
            let plain: string;
            try {
              plain = enc.decrypt(r.blob);
            } catch (err) {
              throw new Error(`${table}.${column} id=${r.id}: ${(err as Error).message} (is its key listed in FIELD_ENCRYPTION_RETIRED_KEYS?)`);
            }
            await sql`UPDATE ${sql.table(table)} SET ${sql.ref(column)} = ${enc.encrypt(plain)} WHERE ${sql.ref(id)}::text = ${r.id} AND ${sql.ref(column)} = ${r.blob}`.execute(trx);
          }
        });
        n += rows.rows.length;
      }
      log(`${table}.${column}: re-encrypted ${n}`);
      total += n;
    }
  } finally {
    await db.destroy();
  }
  return total;
}

if (require.main === module) {
  rotate().then((n) => console.log(`done: ${n} values re-encrypted`)).catch((err) => { console.error(err); process.exit(1); });
}
