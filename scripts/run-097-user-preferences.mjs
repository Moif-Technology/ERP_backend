import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const { Client } = pg;
const __dir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dir, '../.env') });
const sql   = readFileSync(join(__dir, '../database/migrations/097_user_preferences.sql'), 'utf8');

const DBS = [
  { label: 'DATABASE_URL', url: process.env.DATABASE_URL },
  { label: 'PROD_DATABASE_URL', url: process.env.PROD_DATABASE_URL },
].filter((db) => db.url);

if (!DBS.length) {
  console.error('Set DATABASE_URL or PROD_DATABASE_URL before running this migration.');
  process.exit(1);
}

for (const { label, url } of DBS) {
  console.log(`\n▶ ${label}`);
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(sql);
    console.log(`  ✓ 097_user_preferences applied`);
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
