import { Client } from 'pg';
import { migrate } from '../scripts/migrate';
import { seed } from '../scripts/seed';
import { TEST_DATABASE_URL } from './env';

/** Recreates the test database from migrations + seed so every run starts from a known state. */
export default async function globalSetup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(dbName)) throw new Error(`Refusing to recreate non-test database "${dbName}"`);
  const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  await migrate(TEST_DATABASE_URL, () => undefined);
  await seed(TEST_DATABASE_URL, { quiet: true });
}
