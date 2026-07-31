import pg from 'pg';
const url = 'postgresql://moif:404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53@localhost:5433/moifone_uae';
const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
try {
  const res = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'ops'
    AND tablename = 'kot_master'
    AND (indexname LIKE '%pkey%' OR indexname LIKE '%unique%')
    ORDER BY indexname
  `);
  console.log('KOT master primary/unique indexes:');
  res.rows.forEach(r => {
    console.log(`  ${r.indexname}: ${r.indexdef}`);
  });

  const cols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'ops'
    AND table_name = 'kot_master'
    AND column_name LIKE '%id' OR column_name LIKE '%kot%'
    ORDER BY ordinal_position
  `);
  console.log('\nKOT ID columns:');
  cols.rows.forEach(r => {
    console.log(`  ${r.column_name}: ${r.data_type}`);
  });
} finally {
  client.release();
  await pool.end();
}
