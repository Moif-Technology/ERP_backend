/**
 * Seed the Falaknuma restaurant menu from Excel into company 9 / branch 1.
 *
 * Excel columns: Item name | Price (AED) | Category | Subcategory
 *   Category    -> biz.group_master
 *   Subcategory -> biz.sub_group_master
 *   Item        -> core.product_master + core.product_inventory (unit_price)
 *
 * Tax is 0% for now (prices are entered without VAT).
 * Everything uses the FAL- code prefix. Re-running upserts on the same ids.
 *
 * Usage:
 *   node scripts/seed_falaknuma_menu.mjs "<path to xlsx>"           # dry run
 *   node scripts/seed_falaknuma_menu.mjs "<path to xlsx>" --apply   # commit
 */
import dotenv from 'dotenv';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
// xlsx is installed in ERP_frontend, not api
const XLSX = createRequire(path.join(__dirname, '..', '..', 'ERP_frontend', 'package.json'))('xlsx');

const COMPANY_ID = 9;
const BRANCH_ID = 1;
const TAX_RATE = 0;
const CODE_PREFIX = 'FAL-';
const SEED_BY = 'falaknuma_seed';

const file = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!file) throw new Error('Usage: node scripts/seed_falaknuma_menu.mjs <xlsx> [--apply]');

const slug = (s) => String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function loadCatalogue() {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Menu, { header: 1 }).slice(1);
  const groups = new Map();    // name -> {id, code, name, sort}
  const subGroups = new Map(); // "cat|sub" -> {id, groupId, code, name}
  const products = [];
  const sgCodes = new Set();

  for (const [i, r] of rows.entries()) {
    const [rawName, rawPrice, rawCat, rawSub] = r;
    if (!rawName && !rawCat) continue;
    const name = String(rawName ?? '').trim();
    const cat = String(rawCat ?? '').trim();
    const sub = String(rawSub ?? '').trim();
    const price = Number(rawPrice);
    if (!name || !cat || !sub || !Number.isFinite(price) || price < 0) {
      throw new Error(`Bad row ${i + 2}: ${JSON.stringify(r)}`);
    }

    if (!groups.has(cat)) {
      const id = groups.size + 1;
      groups.set(cat, { id, code: `${CODE_PREFIX}${slug(cat)}`.slice(0, 50), name: cat, sort: id });
    }
    const g = groups.get(cat);

    const sgKey = `${cat}|${sub}`;
    if (!subGroups.has(sgKey)) {
      let code = `${CODE_PREFIX}SG-${slug(sub)}`.slice(0, 50);
      if (sgCodes.has(code)) code = `${CODE_PREFIX}SG-${slug(cat)}-${slug(sub)}`.slice(0, 50);
      sgCodes.add(code);
      subGroups.set(sgKey, { id: subGroups.size + 1, groupId: g.id, code, name: sub });
    }

    const id = products.length + 1;
    products.push({
      id,
      code: `${CODE_PREFIX}${String(id).padStart(5, '0')}`,
      name: name.slice(0, 150),
      price,
      g: g.id,
      sg: subGroups.get(sgKey).id,
    });
  }
  return { groups: [...groups.values()], subGroups: [...subGroups.values()], products };
}

async function main() {
  const { groups, subGroups, products } = loadCatalogue();

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    const [{ addr }] = (await client.query('SELECT inet_server_addr()::text AS addr')).rows;
    const [co] = (await client.query('SELECT company_name FROM core.company_master WHERE company_id = $1', [COMPANY_ID])).rows;
    if (!co) throw new Error(`company ${COMPANY_ID} not found`);
    const existing = (await client.query(
      'SELECT COUNT(*)::int AS n FROM core.product_master WHERE company_id = $1 AND product_code NOT LIKE $2',
      [COMPANY_ID, `${CODE_PREFIX}%`],
    )).rows[0].n;

    console.log('─────────────────────────────────────────');
    console.log(`DB ${addr}  company ${COMPANY_ID} "${co.company_name}" / branch ${BRANCH_ID}`);
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);
    console.log(`groups ${groups.length} | sub-groups ${subGroups.length} | items ${products.length} | tax ${TAX_RATE}%`);
    console.log(`non-FAL products already on company: ${existing}`);
    for (const g of groups) {
      const sgs = subGroups.filter((s) => s.groupId === g.id);
      const n = products.filter((p) => p.g === g.id).length;
      console.log(`  ${g.code}  ${g.name}  (${sgs.length} sub, ${n} items)`);
    }
    const nameCount = {};
    for (const p of products) nameCount[p.name.toLowerCase()] = (nameCount[p.name.toLowerCase()] || 0) + 1;
    const dups = Object.entries(nameCount).filter(([, n]) => n > 1);
    console.log(`duplicate names kept as separate items: ${dups.length}`);
    dups.forEach(([n, c]) => console.log(`  ${c}x ${n}`));
    console.log('sample:', products.slice(0, 3).map((p) => `${p.code} ${p.name} ${p.price}`).join(' | '));
    console.log('─────────────────────────────────────────');
    if (!APPLY) return;

    await client.query('BEGIN');

    for (const g of groups) {
      await client.query(
        `INSERT INTO biz.group_master (
           group_id, company_id, branch_id, group_code, group_description,
           sort_order, r_status, cr_by, is_deleted
         ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, FALSE)
         ON CONFLICT (company_id, branch_id, group_id) DO UPDATE
           SET group_code = EXCLUDED.group_code,
               group_description = EXCLUDED.group_description,
               sort_order = EXCLUDED.sort_order,
               r_status = 'ACTIVE',
               is_deleted = FALSE,
               modified_at = NOW()`,
        [g.id, COMPANY_ID, BRANCH_ID, g.code, g.name, g.sort, SEED_BY],
      );
    }

    for (const sg of subGroups) {
      await client.query(
        `INSERT INTO biz.sub_group_master (
           sub_group_id, company_id, branch_id, group_id, sub_group_code,
           sub_group_description, r_status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
         ON CONFLICT (company_id, sub_group_id) DO UPDATE
           SET group_id = EXCLUDED.group_id,
               branch_id = EXCLUDED.branch_id,
               sub_group_code = EXCLUDED.sub_group_code,
               sub_group_description = EXCLUDED.sub_group_description,
               r_status = 'ACTIVE',
               is_deleted = FALSE,
               modified_at = NOW()`,
        [sg.id, COMPANY_ID, BRANCH_ID, sg.groupId, sg.code, sg.name],
      );
    }

    for (const p of products) {
      await client.query(
        `INSERT INTO core.product_master (
           company_id, product_id, product_code, product_name, short_name,
           product_type, unit_name, pack_qty, group_id, subgroup_id,
           product_status, record_status, is_deleted, created_by, modified_by
         ) VALUES (
           $1, $2, $3, $4, $4,
           'FOOD', 'NOS', 1, $5, $6,
           'ACTIVE', 'ACTIVE', FALSE, $7, $7
         )
         ON CONFLICT (company_id, product_id) DO UPDATE
           SET product_code = EXCLUDED.product_code,
               product_name = EXCLUDED.product_name,
               short_name = EXCLUDED.short_name,
               group_id = EXCLUDED.group_id,
               subgroup_id = EXCLUDED.subgroup_id,
               product_status = 'ACTIVE',
               record_status = 'ACTIVE',
               is_deleted = FALSE,
               modified_by = EXCLUDED.modified_by,
               modified_at = NOW()`,
        [COMPANY_ID, p.id, p.code, p.name, p.g, p.sg, SEED_BY],
      );

      await client.query(
        `INSERT INTO core.product_inventory (
           company_id, branch_id, product_inventory_id, product_id,
           pack_qty, qty_on_hand, unit_price, output_tax_1_rate, output_tax_1_amount,
           record_status, is_deleted, created_by, modified_by
         ) VALUES ($1, $2, $3, $3, 1, 0, $4, $5, 0, 'ACTIVE', FALSE, $6, $6)
         ON CONFLICT (company_id, branch_id, product_id) DO UPDATE
           SET unit_price = EXCLUDED.unit_price,
               output_tax_1_rate = EXCLUDED.output_tax_1_rate,
               record_status = 'ACTIVE',
               is_deleted = FALSE,
               modified_by = EXCLUDED.modified_by,
               modified_at = NOW()`,
        [COMPANY_ID, BRANCH_ID, p.id, p.price, TAX_RATE, SEED_BY],
      );
    }

    await client.query('COMMIT');

    const listed = await client.query(
      `SELECT g.group_description, COUNT(*)::int AS items, SUM(i.unit_price)::numeric AS price_sum
         FROM core.product_master m
         JOIN core.product_inventory i ON i.company_id = m.company_id AND i.product_id = m.product_id AND i.branch_id = $2
         JOIN biz.group_master g ON g.company_id = m.company_id AND g.branch_id = $2 AND g.group_id = m.group_id
        WHERE m.company_id = $1 AND m.product_code LIKE $3
        GROUP BY g.sort_order, g.group_description
        ORDER BY g.sort_order`,
      [COMPANY_ID, BRANCH_ID, `${CODE_PREFIX}%`],
    );
    console.log('COMMITTED. In DB now:');
    console.table(listed.rows);
  } catch (err) {
    if (APPLY) await client.query('ROLLBACK').catch(() => {});
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
