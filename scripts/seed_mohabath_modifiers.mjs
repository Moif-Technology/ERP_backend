/**
 * Import kitchen-message modifiers from SQL Server MoifCore.ModifierTable
 * into Test1 Head Office (company 1, branch 1 — Deyno Pro Till).
 *
 * Source query (SSMS):
 *   SELECT TOP (200) Modifier, ModifierID, ModifierArabic, UploadStatus
 *   FROM ModifierTable
 *
 * Usage:
 *   node scripts/seed_mohabath_modifiers.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const COMPANY_ID = 1;
const BRANCH_ID = 1;

const MSSQL = {
  server: process.env.MSSQL_SERVER || 'SB\\SQLEXPRESS',
  user: process.env.MSSQL_USER || 'sa',
  password: process.env.MSSQL_PASSWORD || 'gtarc',
  database: process.env.MSSQL_DATABASE || 'MoifCore',
};

const MODIFIERS_TSV = path.join(__dirname, '_mohabath_modifiers.tsv');

function parseTsv(filePath, expectedCols) {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith('Msg ')) continue;
    const cols = trimmed.split('\t');
    if (cols.length < expectedCols) continue;
    rows.push(cols.map((c) => String(c ?? '').trim()));
  }
  return rows;
}

function exportFromSqlServer() {
  const sqlcmd = 'sqlcmd';
  execFileSync(sqlcmd, [
    '-S', MSSQL.server,
    '-U', MSSQL.user,
    '-P', MSSQL.password,
    '-d', MSSQL.database,
    '-h', '-1',
    '-s', '\t',
    '-W',
    '-f', '65001',
    '-o', MODIFIERS_TSV,
    '-Q',
    `SET NOCOUNT ON; SELECT TOP (200) CAST(ModifierID AS varchar(30)), ISNULL(Modifier,''), ISNULL(ModifierArabic,''), ISNULL(UploadStatus,'') FROM ModifierTable ORDER BY ModifierID, Modifier;`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function loadModifiers() {
  try {
    exportFromSqlServer();
    console.log(`Exported ${MSSQL.database}.ModifierTable via sqlcmd (${MSSQL.server}).`);
  } catch (err) {
    if (!existsSync(MODIFIERS_TSV)) {
      throw new Error(`sqlcmd export failed and no cached TSV found: ${err.message}`);
    }
    console.log('sqlcmd export failed — using cached TSV file.');
    console.log(String(err.message || err));
  }

  const rows = parseTsv(MODIFIERS_TSV, 2);
  const modifiers = [];
  const seen = new Set();
  for (const cols of rows) {
    const id = Number(cols[0]);
    const name = (cols[1] || '').slice(0, 150);
    if (!Number.isFinite(id) || id < 1 || !name) continue;
    const key = `${id}\t${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    modifiers.push({
      id,
      name,
      arabic: (cols[2] || '').slice(0, 200),
      uploadStatus: (cols[3] || '').slice(0, 50),
    });
  }
  if (!modifiers.length) throw new Error('No ModifierTable rows to import');
  return modifiers;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');

  const modifiers = loadModifiers();
  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE biz.modifier_master
          SET r_status = 'INACTIVE',
              is_deleted = TRUE,
              modified_at = NOW()
        WHERE company_id = $1
          AND branch_id = $2
          AND COALESCE(is_deleted, FALSE) = FALSE`,
      [COMPANY_ID, BRANCH_ID],
    );

    for (const m of modifiers) {
      await client.query(
        `INSERT INTO biz.modifier_master (
           company_id, branch_id, modifier_id, modifier, modifier_arabic,
           upload_status, r_status, is_deleted
         ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', FALSE)
         ON CONFLICT (company_id, branch_id, modifier_id, modifier) DO UPDATE
           SET modifier_arabic = EXCLUDED.modifier_arabic,
               upload_status = EXCLUDED.upload_status,
               r_status = 'ACTIVE',
               is_deleted = FALSE,
               modified_at = NOW()`,
        [COMPANY_ID, BRANCH_ID, m.id, m.name, m.arabic, m.uploadStatus],
      );
    }

    await client.query('COMMIT');

    const listed = await client.query(
      `SELECT modifier_id, modifier, modifier_arabic
         FROM biz.modifier_master
        WHERE company_id = $1
          AND branch_id = $2
          AND r_status = 'ACTIVE'
          AND COALESCE(is_deleted, FALSE) = FALSE
        ORDER BY modifier_id, modifier`,
      [COMPANY_ID, BRANCH_ID],
    );

    console.log('─────────────────────────────────────────');
    console.log(`Modifiers on company ${COMPANY_ID} / branch ${BRANCH_ID}`);
    console.log(`  source : ${MSSQL.database}.ModifierTable`);
    console.log(`  rows   : ${listed.rows.length}`);
    for (const r of listed.rows) {
      const ar = r.modifier_arabic ? ` / ${r.modifier_arabic}` : '';
      console.log(`  ${r.modifier_id}  ${r.modifier}${ar}`);
    }
    console.log('─────────────────────────────────────────');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
