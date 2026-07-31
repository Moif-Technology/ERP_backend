import pg from 'pg';
const url = 'postgresql://moif:404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53@localhost:5433/moifone_uae';
const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
try {
  const res = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'core'
    AND tablename = 'staff_master'
    ORDER BY indexname
  `);
  console.log('Staff master indexes:');
  res.rows.forEach(r => {
    console.log(`  ${r.indexname}: ${r.indexdef}`);
  });
} finally {
  client.release();
  await pool.end();
}
