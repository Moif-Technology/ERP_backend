import pg from 'pg';
const url = 'postgresql://moif:404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53@localhost:5433/moifone_uae';
const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
try {
  console.log('Testing foreign key from biz.customer_master...');
  const res = await client.query(`
    CREATE TABLE IF NOT EXISTS test_fk (
      id SERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES biz.customer_master(customer_id)
    )
  `);
  console.log('Success!');
  await client.query(`DROP TABLE test_fk`);
} catch (e) {
  console.error('Error:', e.message);
  if (e.code) console.error('Code:', e.code);
  if (e.detail) console.error('Detail:', e.detail);
} finally {
  client.release();
  await pool.end();
}
