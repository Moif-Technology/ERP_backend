import pg from 'pg';
const url = 'postgresql://moif:404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53@localhost:5433/moifone_uae';
const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
try {
  const res = await client.query(`
    SELECT constraint_name, constraint_type, column_name
    FROM information_schema.table_constraints tc
    LEFT JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'biz'
    AND tc.table_name = 'customer_master'
    AND column_name = 'customer_id'
    ORDER BY constraint_type
  `);
  console.log('Customer ID constraints:');
  res.rows.forEach(r => {
    console.log(`  ${r.constraint_name}: ${r.constraint_type} (${r.column_name})`);
  });

  // Also check the index
  const idx = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'biz'
    AND tablename = 'customer_master'
    AND indexname LIKE '%customer_id%'
  `);
  console.log('\nIndexes on customer_id:');
  idx.rows.forEach(r => {
    console.log(`  ${r.indexname}: ${r.indexdef}`);
  });
} finally {
  client.release();
  await pool.end();
}
