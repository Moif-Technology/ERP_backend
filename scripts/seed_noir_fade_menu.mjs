/**
 * Seed Noir Fade DXB (company_id=7) menu from price board.
 * Groups order: Noir Special → Hair Treatments → Hair Colouring → Face Special
 *
 * Usage: node scripts/seed_noir_fade_menu.mjs
 */
import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();

const COMPANY_ID = 7;
const BRANCHES = [1, 2];

const GROUPS = [
  { id: 1, code: 'NOIR_SPECIAL', name: 'Noir Special', sort: 1 },
  { id: 2, code: 'HAIR_TREAT', name: 'Hair Treatments', sort: 2 },
  { id: 3, code: 'HAIR_COLOUR', name: 'Hair Colouring', sort: 3 },
  { id: 4, code: 'FACE_SPECIAL', name: 'Face Special', sort: 4 },
];

const PRODUCTS = [
  // Noir Special
  { id: 1, code: 'NF-001', name: 'Haircut', price: 15, g: 1 },
  { id: 2, code: 'NF-002', name: 'Beard Trim', price: 15, g: 1 },
  { id: 3, code: 'NF-003', name: 'Head Massage', price: 15, g: 1 },
  { id: 4, code: 'NF-004', name: 'Face Scrub', price: 15, g: 1 },
  { id: 5, code: 'NF-005', name: 'Hair Wash', price: 5, g: 1 },
  { id: 6, code: 'NF-006', name: 'Nose Strip', price: 5, g: 1 },
  { id: 7, code: 'NF-007', name: 'Hair Wax Styling', price: 15, g: 1 },
  { id: 8, code: 'NF-008', name: 'Threading', price: 10, g: 1 },
  // Hair Treatments
  { id: 9, code: 'NF-009', name: 'Dandruff Treatment', price: 35, g: 2 },
  { id: 10, code: 'NF-010', name: 'Hair Smoothing', price: 45, g: 2 },
  { id: 11, code: 'NF-011', name: 'Hair Straightening (Short)', price: 50, g: 2 },
  { id: 12, code: 'NF-012', name: 'Hair Straightening (Medium)', price: 80, g: 2 },
  { id: 13, code: 'NF-013', name: 'Hair Straightening (Long)', price: 100, g: 2 },
  { id: 14, code: 'NF-014', name: 'Keratin Treatment', price: 200, g: 2 },
  { id: 15, code: 'NF-015', name: 'Hammam Zait', price: 20, g: 2 },
  // Hair Colouring
  { id: 16, code: 'NF-016', name: 'Beard Colour', price: 25, g: 3 },
  { id: 17, code: 'NF-017', name: 'Hair Colour', price: 35, g: 3 },
  { id: 18, code: 'NF-018', name: 'Fashion Hair Colours', price: 70, g: 3 },
  { id: 19, code: 'NF-019', name: 'Hair Bleach', price: 45, g: 3 },
  { id: 20, code: 'NF-020', name: 'Best Colour', price: 40, g: 3 },
  // Face Special
  { id: 21, code: 'NF-021', name: 'Facial', price: 70, g: 4 },
  { id: 22, code: 'NF-022', name: 'D-Tan', price: 40, g: 4 },
  { id: 23, code: 'NF-023', name: 'Olive Bleach', price: 30, g: 4 },
  { id: 24, code: 'NF-024', name: 'Mini Facial', price: 50, g: 4 },
  { id: 25, code: 'NF-025', name: 'Deep Cleaning', price: 30, g: 4 },
  { id: 26, code: 'NF-026', name: 'Black Mask Charcoal', price: 20, g: 4 },
];

async function main() {
  const client = new pg.Client(process.env.DATABASE_URL);
  await client.connect();

  const company = await client.query(
    `SELECT company_id, company_code, company_name FROM core.company_master WHERE company_id = $1`,
    [COMPANY_ID]
  );
  if (!company.rows.length) throw new Error(`Company ${COMPANY_ID} not found`);
  console.log('Seeding menu for', company.rows[0]);

  await client.query('BEGIN');
  try {
    for (const branchId of BRANCHES) {
      for (const g of GROUPS) {
        await client.query(
          `INSERT INTO biz.group_master (
             group_id, company_id, branch_id, group_code, group_description,
             sort_order, r_status, is_deleted, deleted_at, deleted_by
           ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', FALSE, NULL, NULL)
           ON CONFLICT (company_id, branch_id, group_id) DO UPDATE
             SET group_code = EXCLUDED.group_code,
                 group_description = EXCLUDED.group_description,
                 sort_order = EXCLUDED.sort_order,
                 r_status = 'ACTIVE',
                 is_deleted = FALSE,
                 deleted_at = NULL,
                 deleted_by = NULL,
                 modified_at = NOW()`,
          [g.id, COMPANY_ID, branchId, g.code, g.name, g.sort]
        );
      }
    }

    // Keep any leftover old products soft-deleted (ids > 26)
    await client.query(
      `UPDATE core.product_master
       SET record_status = 'DELETED',
           is_deleted = TRUE,
           deleted_at = COALESCE(deleted_at, NOW()),
           modified_at = NOW()
       WHERE company_id = $1
         AND product_id > $2
         AND COALESCE(is_deleted, FALSE) = FALSE`,
      [COMPANY_ID, PRODUCTS.length]
    );

    for (const p of PRODUCTS) {
      await client.query(
        `INSERT INTO core.product_master (
           company_id, product_id, product_code, product_name, short_name,
           product_type, unit_name, pack_qty, group_id,
           product_status, record_status, is_deleted, deleted_at, deleted_by,
           created_by, modified_by
         ) VALUES (
           $1, $2, $3, $4, $5,
           'SERVICE', 'NOS', 1, $6,
           'ACTIVE', 'ACTIVE', FALSE, NULL, NULL,
           'menu_seed', 'menu_seed'
         )
         ON CONFLICT (company_id, product_id) DO UPDATE
           SET product_code = EXCLUDED.product_code,
               product_name = EXCLUDED.product_name,
               short_name = EXCLUDED.short_name,
               product_type = EXCLUDED.product_type,
               unit_name = EXCLUDED.unit_name,
               group_id = EXCLUDED.group_id,
               product_status = 'ACTIVE',
               record_status = 'ACTIVE',
               is_deleted = FALSE,
               deleted_at = NULL,
               deleted_by = NULL,
               modified_by = 'menu_seed',
               modified_at = NOW()`,
        [COMPANY_ID, p.id, p.code, p.name, p.name.slice(0, 20), p.g]
      );

      for (const branchId of BRANCHES) {
        const invId = branchId === 1 ? p.id : p.id + 1000;
        await client.query(
          `INSERT INTO core.product_inventory (
             company_id, branch_id, product_inventory_id, product_id,
             pack_qty, qty_on_hand, unit_price, output_tax_1_rate,
             record_status, is_deleted, deleted_at, deleted_by,
             created_by, modified_by
           ) VALUES (
             $1, $2, $3, $4,
             1, 0, $5, 0,
             'ACTIVE', FALSE, NULL, NULL,
             'menu_seed', 'menu_seed'
           )
           ON CONFLICT (company_id, branch_id, product_id) DO UPDATE
             SET unit_price = EXCLUDED.unit_price,
                 output_tax_1_rate = EXCLUDED.output_tax_1_rate,
                 product_inventory_id = EXCLUDED.product_inventory_id,
                 record_status = 'ACTIVE',
                 is_deleted = FALSE,
                 deleted_at = NULL,
                 deleted_by = NULL,
                 modified_by = 'menu_seed',
                 modified_at = NOW()`,
          [COMPANY_ID, branchId, invId, p.id, p.price]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  const groups = await client.query(
    `SELECT branch_id, group_id, group_description, sort_order, r_status
     FROM biz.group_master
     WHERE company_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE
     ORDER BY branch_id, sort_order, group_id`,
    [COMPANY_ID]
  );
  const products = await client.query(
    `SELECT m.product_id, m.product_name, m.group_id, i.branch_id, i.unit_price
     FROM core.product_master m
     JOIN core.product_inventory i
       ON i.company_id = m.company_id AND i.product_id = m.product_id
     WHERE m.company_id = $1
       AND COALESCE(m.is_deleted, FALSE) = FALSE
       AND COALESCE(i.record_status, 'ACTIVE') = 'ACTIVE'
     ORDER BY m.group_id, m.product_id, i.branch_id`,
    [COMPANY_ID]
  );

  console.log('\nGroups:');
  for (const g of groups.rows) {
    console.log(
      `  branch ${g.branch_id} | ${g.sort_order}. ${g.group_description} (id=${g.group_id})`
    );
  }
  console.log(`\nProducts: ${products.rows.length / BRANCHES.length} services`);
  for (const p of products.rows.filter((r) => Number(r.branch_id) === 2)) {
    console.log(
      `  g${p.group_id} | ${p.product_name.padEnd(32)} AED ${Number(p.unit_price).toFixed(0)}`
    );
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
