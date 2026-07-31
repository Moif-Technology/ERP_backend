import pg from 'pg';
const url = 'postgresql://moif:404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53@localhost:5433/moifone_uae';
const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
try {
  const res = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'core'
    AND table_name = 'staff_master'
    AND (column_name LIKE '%id' OR column_name LIKE '%staff%')
    ORDER BY ordinal_position
  `);
  console.log('Staff key columns:', res.rows);
} finally {
  client.release();
  await pool.end();
}
