import pg from 'pg';

const url = process.env.SCAN_DB_URL || 'postgresql://postgres:admin@localhost:5432/moifone_uae';
const pool = new pg.Pool({ connectionString: url });

const big = (n) => Number(n).toLocaleString();

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function main() {
  console.log('=== CONNECT ===', url.replace(/:[^:@]+@/, ':****@'));

  // 1. Biggest tables by row estimate + size
  console.log('\n=== TOP 25 TABLES (est rows + size) ===');
  const tables = await q(`
    SELECT n.nspname AS schema, c.relname AS table,
           c.reltuples::bigint AS est_rows,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
           pg_total_relation_size(c.oid) AS bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema')
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 25`);
  for (const t of tables) {
    console.log(`  ${t.schema}.${t.table.padEnd(34)} rows≈${big(t.est_rows).padStart(12)}  ${t.total_size}`);
  }

  // 2. Seq scan hotspots (tables read often without index)
  console.log('\n=== SEQ-SCAN HOTSPOTS (seq_scan vs idx_scan) ===');
  const seq = await q(`
    SELECT schemaname AS schema, relname AS table,
           seq_scan, idx_scan, n_live_tup AS rows
    FROM pg_stat_user_tables
    WHERE seq_scan > 0
    ORDER BY seq_scan DESC
    LIMIT 25`);
  if (!seq.length) console.log('  (no stats yet — DB freshly started or never queried)');
  for (const s of seq) {
    const ratio = s.idx_scan ? (s.seq_scan / (s.idx_scan + s.seq_scan) * 100).toFixed(0) : '100';
    const flag = (Number(s.rows) > 1000 && Number(s.seq_scan) > Number(s.idx_scan || 0)) ? '  <-- REVIEW' : '';
    console.log(`  ${s.schema}.${s.table.padEnd(34)} seq=${String(s.seq_scan).padStart(8)} idx=${String(s.idx_scan||0).padStart(8)} rows=${String(s.rows).padStart(8)} seq%=${ratio}${flag}`);
  }

  // 3. Index coverage on key multi-tenant tables: is company_id indexed?
  console.log('\n=== company_id INDEX COVERAGE (key tables) ===');
  const keyTables = await q(`
    SELECT n.nspname AS schema, c.relname AS table
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id' AND a.attnum > 0
    WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema')
    ORDER BY 1,2`);
  for (const t of keyTables) {
    const idx = await q(`
      SELECT i.relname AS index, pg_get_indexdef(ix.indexrelid) AS def
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class tb ON tb.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = tb.relnamespace
      WHERE n.nspname=$1 AND tb.relname=$2`, [t.schema, t.table]);
    const hasCompanyIdx = idx.some((r) => /\(company_id\b/.test(r.def) || /\(\s*company_id\b/.test(r.def));
    console.log(`  ${hasCompanyIdx ? '[OK] ' : '[!!]'} ${t.schema}.${t.table.padEnd(34)} indexes=${idx.length}${hasCompanyIdx ? '' : '  <-- NO company_id leading index'}`);
  }

  await pool.end();
}

main().catch((e) => { console.error('SCAN FAILED:', e.message); process.exit(1); });
