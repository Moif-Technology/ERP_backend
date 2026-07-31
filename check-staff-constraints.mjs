import pg from 'pg';
const url = 'postgresql://moif:404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53@localhost:5433/moifone_uae';
const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
try {
  const res = await client.query(`
    SELECT column_name, constraint_type
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema = 'core'
    AND tc.table_name = 'staff_master'
    AND (column_name = 'staff_id' OR constraint_type = 'PRIMARY KEY')
  `);
  console.log('Staff constraints:', res.rows);
} finally {
  client.release();
  await pool.end();
}
