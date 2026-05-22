import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

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
