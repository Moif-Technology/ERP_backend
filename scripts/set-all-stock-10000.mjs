/**
 * Set qty_on_hand = 10000 for all core.product_inventory rows (Product Child / branch stock).
 * Usage: node scripts/set-all-stock-10000.mjs [qty]
 */
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const qty = Number(process.argv[2] ?? 10000);
if (!Number.isFinite(qty) || qty < 0) {
  console.error('Usage: node scripts/set-all-stock-10000.mjs [qty]');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query('BEGIN');

  const before = await client.query(
    `SELECT company_id, branch_id, COUNT(*)::int AS rows,
            MIN(qty_on_hand)::numeric AS min_qty, MAX(qty_on_hand)::numeric AS max_qty
       FROM core.product_inventory
      GROUP BY company_id, branch_id
      ORDER BY company_id, branch_id`,
  );

  const { rowCount } = await client.query(
    `UPDATE core.product_inventory
        SET qty_on_hand = $1,
            modified_at = NOW(),
            modified_by = COALESCE(modified_by, 'stock-bulk-set')
      WHERE COALESCE(qty_on_hand, 0) IS DISTINCT FROM $1`,
    [qty],
  );

  const after = await client.query(
    `SELECT company_id, branch_id, COUNT(*)::int AS rows,
            MIN(qty_on_hand)::numeric AS min_qty, MAX(qty_on_hand)::numeric AS max_qty
       FROM core.product_inventory
      GROUP BY company_id, branch_id
      ORDER BY company_id, branch_id`,
  );

  await client.query('COMMIT');

  console.log(`Updated ${rowCount} product_inventory row(s) to qty_on_hand = ${qty}.`);
  console.log('\nBefore:');
  console.table(before.rows);
  console.log('\nAfter:');
  console.table(after.rows);
} catch (err) {
  await client.query('ROLLBACK');
  console.error('Failed:', err.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
