/**
 * One-time fix: products imported by seed_mohabath_menu.mjs got product_code = 'MOH-xxxxx'
 * (legacy MoifCore id). That value belongs in Own Ref No.
 *
 *   - own_ref_no   := the MOH code (unless own_ref_no already has a value)
 *   - product_code := the product's barcode, when it has one that no other product uses as code
 *   - no barcode / clash → code stays MOH-xxxxx and is listed, so the user enters a code by hand
 *     (the app never invents product codes).
 *
 * History rows (sales/purchase lines) keep their snapshot code.
 *
 * Usage (from api/):
 *   node scripts/move-moh-code-to-own-ref.mjs            # dry run, prints the plan
 *   node scripts/move-moh-code-to-own-ref.mjs --apply    # writes
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const APPLY = process.argv.includes('--apply');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const { rows: [db] } = await client.query(
      'SELECT current_database() AS db, inet_server_addr() AS host, inet_server_port() AS port',
    );
    console.log(`Target: ${db.db} @ ${db.host ?? 'local socket'}:${db.port}  (${APPLY ? 'APPLY' : 'dry run'})`);

    await client.query('BEGIN');
    const { rows: products } = await client.query(
      `SELECT company_id, product_id, product_code, barcode, own_ref_no, product_name
         FROM core.product_master
        WHERE product_code LIKE 'MOH-%' AND COALESCE(is_deleted, FALSE) = FALSE
        ORDER BY company_id, product_id`,
    );
    const { rows: codes } = await client.query(
      `SELECT company_id, UPPER(product_code) AS code FROM core.product_master`,
    );
    const taken = new Set(codes.map((r) => `${r.company_id}|${r.code}`));

    const moved = [];
    const kept = [];
    for (const p of products) {
      const barcode = String(p.barcode ?? '').trim();
      const key = `${p.company_id}|${barcode.toUpperCase()}`;
      const newCode = barcode && barcode.length <= 50 && !taken.has(key) ? barcode : null;
      if (newCode) taken.add(key);
      const ownRef = String(p.own_ref_no ?? '').trim() || p.product_code;
      await client.query(
        `UPDATE core.product_master
            SET own_ref_no = $3, product_code = $4,
                modified_by = 'moh_own_ref_fix', modified_at = NOW()
          WHERE company_id = $1 AND product_id = $2`,
        [p.company_id, p.product_id, ownRef, newCode ?? p.product_code],
      );
      (newCode ? moved : kept).push({ ...p, newCode });
    }

    console.log(`MOH products: ${products.length}`);
    console.log(`  code -> barcode, MOH -> Own Ref : ${moved.length}`);
    console.log(`  MOH -> Own Ref, code unchanged (no usable barcode — enter code by hand): ${kept.length}`);
    for (const p of kept) {
      console.log(`    co ${p.company_id}  ${p.product_code}  "${p.product_name}"  barcode=${p.barcode ?? ''}`);
    }

    await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
    console.log(APPLY ? 'Committed.' : 'Dry run — rolled back. Re-run with --apply to write.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
