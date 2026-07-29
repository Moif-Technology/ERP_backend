/**
 * Generic migration runner. Replaces the one-off run-NNN-*.mjs pattern
 * (20 of those exist; this retires the need for a 21st).
 *
 * Usage:
 *   node scripts/run-migration.mjs 104_salon_pos.sql
 *   node scripts/run-migration.mjs 104_salon_pos.down.sql
 *   node scripts/run-migration.mjs --root 096_van_route_master.sql
 *   node scripts/run-migration.mjs --dry 104_salon_pos.sql
 *
 * There are TWO migration trees in this repo with colliding numbers:
 *   api/database/migrations   (default here) — 070..104
 *   database/migrations       (--root)       — up to 096
 * e.g. 084 exists in both with completely different content. Always be explicit
 * about which tree you mean.
 *
 * Statements marked between RUNNER_CONCURRENT_BLOCK_START/END are executed
 * separately, after the main body, because CREATE INDEX CONCURRENTLY cannot run
 * inside a transaction block.
 *
 * There is no migration ledger in this project — nothing records what has been
 * applied. Re-run safety comes entirely from IF NOT EXISTS / ON CONFLICT guards
 * inside the SQL. Keep writing them.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const CONCURRENT_START = 'RUNNER_CONCURRENT_BLOCK_START';
const CONCURRENT_END = 'RUNNER_CONCURRENT_BLOCK_END';

function parseArgs(argv) {
  const args = { file: null, root: false, dry: false };
  for (const a of argv) {
    if (a === '--root') args.root = true;
    else if (a === '--dry') args.dry = true;
    else if (!a.startsWith('--')) args.file = a;
  }
  return args;
}

/**
 * Split the file into the main body and the CONCURRENTLY-only tail.
 * Everything between the markers is stripped from the body.
 */
function splitConcurrent(sql) {
  const start = sql.indexOf(CONCURRENT_START);
  const end = sql.indexOf(CONCURRENT_END);
  if (start === -1 || end === -1 || end < start) {
    return { body: sql, concurrent: null };
  }
  const lineStart = sql.lastIndexOf('\n', start) + 1;
  const lineEnd = sql.indexOf('\n', end);
  const block = sql
    .slice(sql.indexOf('\n', start) + 1, lineStart === 0 ? end : sql.lastIndexOf('\n', end))
    .trim();
  const body = (sql.slice(0, lineStart) + sql.slice(lineEnd === -1 ? sql.length : lineEnd + 1)).trim();
  return { body, concurrent: block || null };
}

async function main() {
  const { file, root, dry } = parseArgs(process.argv.slice(2));

  if (!file) {
    console.error('Usage: node scripts/run-migration.mjs <file.sql> [--root] [--dry]');
    process.exit(1);
  }

  const dir = root
    ? path.join(__dirname, '..', '..', 'database', 'migrations')
    : path.join(__dirname, '..', 'database', 'migrations');
  const filePath = path.join(dir, file);

  if (!fs.existsSync(filePath)) {
    console.error('Migration not found:', filePath);
    console.error('Tip: pass --root to use the sibling database/migrations tree.');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing in api/.env');
    process.exit(1);
  }

  // Show which database, without leaking the password.
  let target = 'unknown';
  try {
    const u = new URL(url);
    target = `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch { /* keep 'unknown' */ }

  const sql = fs.readFileSync(filePath, 'utf8');
  const { body, concurrent } = splitConcurrent(sql);

  console.log(`Migration : ${file}`);
  console.log(`Tree      : ${root ? 'database/migrations (root)' : 'api/database/migrations'}`);
  console.log(`Target DB : ${target}`);
  console.log(`Concurrent: ${concurrent ? 'yes (runs after main body)' : 'none'}`);

  if (dry) {
    console.log('\n--dry given, nothing executed.');
    return;
  }

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    console.log('\nApplying main body...');
    await client.query(body);
    console.log('  main body OK');

    if (concurrent) {
      console.log('Applying CONCURRENTLY block (outside transaction)...');
      await client.query(concurrent);
      console.log('  concurrent block OK');
    }

    console.log(`\nDone: ${file}`);
    console.log('Reminder: api/CLAUDE.md requires running migrations on BOTH local and production.');
  } catch (err) {
    console.error('\nMIGRATION FAILED');
    console.error(`  ${err.code ? err.code + ': ' : ''}${err.message}`);
    if (err.detail) console.error(`  detail: ${err.detail}`);
    if (err.hint) console.error(`  hint: ${err.hint}`);
    console.error('\nThe main body is wrapped in BEGIN/COMMIT, so it rolled back cleanly.');
    if (concurrent) {
      console.error('The CONCURRENTLY block may or may not have applied — check manually.');
    }
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
