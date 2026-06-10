import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

const basePoolOptions = {
  max: config.pgPoolMax,
  min: config.pgPoolMin,
  idleTimeoutMillis: 30_000, // drop idle clients
  connectionTimeoutMillis: 5_000, // fail fast when pool exhausted
  // NOTE: remove the two timeouts below when running behind PgBouncer/RDS Proxy
  // in transaction-pooling mode (set them on the DB/pooler instead).
  statement_timeout: 15_000, // kill runaway query server-side
  query_timeout: 15_000, // kill runaway query client-side
  keepAlive: true,
};

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ...basePoolOptions,
});

// Read replica pool. Falls back to primary when DATABASE_REPLICA_URL unset.
// Route heavy/list/dashboard reads here; keep writes + read-after-write on `pool`.
export const readPool = config.replicaUrl
  ? new Pool({ connectionString: config.replicaUrl, ...basePoolOptions })
  : pool;

// Surface idle-client crashes instead of taking the process down silently.
pool.on('error', (err) => {
  console.error('[pg pool] idle client error:', err.message);
});
if (readPool !== pool) {
  readPool.on('error', (err) => {
    console.error('[pg readPool] idle client error:', err.message);
  });
}

/** Host:port/database for logs (no password). */
export function databaseSummaryForLog() {
  try {
    const u = new URL(config.databaseUrl.replace(/^postgres(ql)?:/i, 'http:'));
    const db = (u.pathname || '').replace(/^\//, '') || '(database)';
    const host = u.hostname || 'localhost';
    const port = u.port || '5432';
    return `${host}:${port} / ${db}`;
  } catch {
    return '(DATABASE_URL set)';
  }
}

export async function verifyDatabaseConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1 AS ok');
  } finally {
    client.release();
  }
}

/** End every pool (graceful shutdown). Safe when readPool === pool. */
export async function closeAllPools() {
  await pool.end().catch(() => {});
  if (readPool !== pool) {
    await readPool.end().catch(() => {});
  }
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
