import pg from 'pg';
const url = 'postgresql://moif:404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53@localhost:5433/moifone_uae';
const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
try {
  const res = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'biz'
    AND table_name = 'customer_master'
    ORDER BY ordinal_position
  `);
  console.log('Columns:');
  res.rows.forEach(r => console.log('  ', r.column_name, r.data_type, r.is_nullable));
} finally {
  client.release();
  await pool.end();
}
