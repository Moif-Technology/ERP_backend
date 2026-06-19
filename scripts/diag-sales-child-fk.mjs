import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.DATABASE_URL || process.env.SCAN_DB_URL || 'postgresql://postgres:admin@localhost:5432/moifone_uae';
const pool = new pg.Pool({ connectionString: url });

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function main() {
  console.log('=== CONNECT ===', url.replace(/:[^:@]+@/, ':****@'));

  const fks = await q(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'ops.sales_child'::regclass AND contype = 'f'
  `);
  console.log('\n=== FK on ops.sales_child ===');
  for (const r of fks) console.log(`  ${r.conname}: ${r.def}`);

  const cols = await q(`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'ops' AND table_name = 'sales_child'
      AND column_name IN ('product_id', 'group_id')
  `);
  console.log('\n=== product_id / group_id columns ===');
  console.log(cols);

  const orphans = await q(`
    SELECT sc.company_id, sc.product_id, COUNT(*)::int AS cnt
    FROM ops.sales_child sc
    LEFT JOIN core.product_master pm
      ON pm.company_id = sc.company_id AND pm.product_id = sc.product_id
    WHERE pm.product_id IS NULL
    GROUP BY sc.company_id, sc.product_id
    ORDER BY cnt DESC
    LIMIT 20
  `);
  console.log('\n=== Existing orphan product_id in sales_child ===');
  console.log(orphans);

  const pmCount = await q(`SELECT COUNT(*)::int AS cnt FROM core.product_master`);
  console.log('\n=== product_master rows ===', pmCount[0].cnt);

  const sampleProducts = await q(`
    SELECT company_id, product_id, product_code, product_name
    FROM core.product_master
    ORDER BY product_id DESC
    LIMIT 5
  `);
  console.log('\n=== Sample products ===');
  console.log(sampleProducts);

  const groupOrphans = await q(`
    SELECT sc.company_id, sc.group_id, COUNT(*)::int AS cnt
    FROM ops.sales_child sc
    LEFT JOIN biz.group_master pg
      ON pg.company_id = sc.company_id AND pg.group_id = sc.group_id
    WHERE sc.group_id IS NOT NULL AND pg.group_id IS NULL
    GROUP BY sc.company_id, sc.group_id
    LIMIT 10
  `);
  console.log('\n=== Orphan group_id in sales_child ===');
  console.log(groupOrphans);

  const heldWithBadProduct = await q(`
    SELECT sc.sales_id, sc.product_id, sc.group_id, sc.short_description, sm.hold_status
    FROM ops.sales_child sc
    JOIN ops.sales_master sm ON sm.company_id = sc.company_id AND sm.sales_id = sc.sales_id
    LEFT JOIN core.product_master pm
      ON pm.company_id = sc.company_id AND pm.product_id = sc.product_id
    WHERE pm.product_id IS NULL
      AND sm.hold_status IN ('HOLD', 'DELIVERY')
    ORDER BY sc.id DESC
    LIMIT 15
  `);
  console.log('\n=== Pending holds/deliveries with bad product_id ===');
  console.log(heldWithBadProduct);

  await pool.end();
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
