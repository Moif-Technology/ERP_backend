import pg from 'pg';
const url = 'postgresql://moif:404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53@localhost:5433/moifone_uae';
const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
try {
  const res = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name LIKE '%customer%'
    ORDER BY table_schema, table_name
  `);
  console.log('Customer tables:', res.rows);
} finally {
  client.release();
  await pool.end();
}
