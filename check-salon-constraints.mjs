import pg from 'pg';
const url = 'postgresql://moif:404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53@localhost:5433/moifone_uae';
const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
try {
  const res = await client.query(`
    SELECT constraint_name, constraint_type, table_name
    FROM information_schema.table_constraints
    WHERE table_schema = 'ops'
    AND (table_name = 'salon_job_master' OR table_name = 'salon_job_child')
    ORDER BY table_name, constraint_type
  `);
  console.log('Constraints:');
  res.rows.forEach(r => {
    console.log(`  ${r.table_name}: ${r.constraint_name} (${r.constraint_type})`);
  });
} finally {
  client.release();
  await pool.end();
}
