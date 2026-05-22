/**
 * Apply 045_platform_users.sql using DATABASE_URL from api/.env.
 * Usage: node scripts/run-platform-migration.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const migrationName = '045_platform_users.sql';
const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'database',
  'migrations',
  migrationName
);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing in api/.env');
    process.exit(1);
  }
  if (!fs.existsSync(migrationPath)) {
    console.error('Missing file:', migrationPath);
    process.exit(1);
  }
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    console.log('Applying', migrationName, '...');
    await client.query(sql);
    console.log('OK', migrationName);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
