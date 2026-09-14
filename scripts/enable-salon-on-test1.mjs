/**
 * Add Salon POS onto the existing Test1 tenant (moiftechz@gmail.com)
 * without replacing Counter POS (C1/C2).
 *
 * Creates:
 *   - Branch "Salon" (branch_id = station 3) so salon bills number separately
 *   - SALON_POS station 3 "Salon Front Desk" on that branch
 *   - Stylist role (SALON-POS)
 *   - User Test / PIN 1234 on the salon branch
 *   - Salon floor, chairs, groups, and a small service catalogue
 *
 * Usage: node scripts/enable-salon-on-test1.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ADMIN_EMAIL = 'moiftechz@gmail.com';
const TEST_LOGIN = 'test';
const TEST_NAME = 'Test';
const TEST_PIN = '1234';
const TEST_PASSWORD = 'Test1234';
const STATION_ID = 3;
const STYLIST_ROLE_ID = 10;

const AREAS = [
  { areaId: 1, name: 'Main Floor', prefix: 'MF' },
  { areaId: 2, name: 'VIP Room', prefix: 'VIP' },
];

const CHAIRS = [
  { tableId: 1, no: '1', name: 'Styling 1', areaId: 1 },
  { tableId: 2, no: '2', name: 'Styling 2', areaId: 1 },
  { tableId: 3, no: '3', name: 'Styling 3', areaId: 1 },
  { tableId: 4, no: '4', name: 'Wash 1', areaId: 1 },
  { tableId: 5, no: '5', name: 'Nail Bar 1', areaId: 1 },
  { tableId: 6, no: '6', name: 'VIP Suite 1', areaId: 2 },
  { tableId: 7, no: '7', name: 'Facial Room', areaId: 2 },
];

const GROUPS = [
  { groupId: 9, code: 'SLN-HAIR', name: 'Hair' },
  { groupId: 10, code: 'SLN-NAIL', name: 'Nails' },
  { groupId: 11, code: 'SLN-SKIN', name: 'Skin & Spa' },
  { groupId: 12, code: 'SLN-PACK', name: 'Packages' },
  { groupId: 13, code: 'SLN-RET', name: 'Retail' },
];

const SUBGROUPS = [
  { subGroupId: 6, groupId: 9, code: 'SLN-CUT', name: 'Cut & Style' },
  { subGroupId: 7, groupId: 9, code: 'SLN-COL', name: 'Colour' },
  { subGroupId: 8, groupId: 10, code: 'SLN-MANI', name: 'Manicure' },
  { subGroupId: 9, groupId: 10, code: 'SLN-PEDI', name: 'Pedicure' },
  { subGroupId: 10, groupId: 11, code: 'SLN-FAC', name: 'Facials' },
  { subGroupId: 11, groupId: 12, code: 'SLN-BRD', name: 'Bridal' },
  { subGroupId: 12, groupId: 13, code: 'SLN-CARE', name: 'Hair Care' },
];

const CATALOGUE = [
  { id: 16, code: 'SLN-CUT', name: 'Haircut', type: 'SERVICE', price: 60, duration: 45, g: 9, sg: 6 },
  { id: 17, code: 'SLN-CUTK', name: 'Kids Haircut', type: 'SERVICE', price: 35, duration: 30, g: 9, sg: 6 },
  { id: 18, code: 'SLN-BLOW', name: 'Blow Dry', type: 'SERVICE', price: 50, duration: 30, g: 9, sg: 6 },
  { id: 19, code: 'SLN-BEARD', name: 'Beard Trim', type: 'SERVICE', price: 35, duration: 20, g: 9, sg: 6 },
  { id: 20, code: 'SLN-COLOR', name: 'Hair Colour', type: 'SERVICE', price: 220, duration: 120, g: 9, sg: 7 },
  { id: 21, code: 'SLN-MANI', name: 'Manicure', type: 'SERVICE', price: 55, duration: 40, g: 10, sg: 8 },
  { id: 22, code: 'SLN-GEL', name: 'Gel Polish', type: 'SERVICE', price: 80, duration: 50, g: 10, sg: 8 },
  { id: 23, code: 'SLN-PEDI', name: 'Pedicure', type: 'SERVICE', price: 65, duration: 45, g: 10, sg: 9 },
  { id: 24, code: 'SLN-FACIAL', name: 'Classic Facial', type: 'SERVICE', price: 150, duration: 60, g: 11, sg: 10 },
  { id: 25, code: 'SLN-THREAD', name: 'Threading', type: 'SERVICE', price: 25, duration: 15, g: 11, sg: 10 },
  { id: 26, code: 'SLN-BRIDAL', name: 'Bridal Package', type: 'SERVICE', price: 1200, duration: 300, g: 12, sg: 11 },
  { id: 27, code: 'SLN-SHAM', name: 'Shampoo 250ml', type: 'STOCK', price: 45, duration: null, g: 13, sg: 12 },
];

const SALON_FEATURES = [
  'pos.salon.jobs',
  'pos.salon.stylists',
  'pos.salon.appointments',
  'pos.salon.service_status',
  'pos.salon.stylist_reassign',
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing in api/.env');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: users } = await client.query(
      `SELECT company_id, staff_id, staff_name, login_name, email
         FROM core.staff_master
        WHERE lower(COALESCE(email,'')) = $1
           OR lower(COALESCE(login_name,'')) = $1
        LIMIT 1`,
      [ADMIN_EMAIL]
    );
    if (!users.length) throw new Error(`No staff found for ${ADMIN_EMAIL}`);
    const companyId = Number(users[0].company_id);
    console.log(`Company ${companyId} — admin ${users[0].email || users[0].login_name}`);

    const now = new Date().toISOString();

    await client.query(
      `INSERT INTO core.branch_master (
         company_id, branch_id, branch_code, branch_name, status, created_at, updated_at
       ) VALUES ($1, $2, 'SALON', 'Salon', 'ACTIVE', $3, $3)
       ON CONFLICT (company_id, branch_id) DO UPDATE
         SET branch_name = EXCLUDED.branch_name,
             branch_code = EXCLUDED.branch_code,
             status = 'ACTIVE',
             updated_at = EXCLUDED.updated_at`,
      [companyId, STATION_ID, now]
    );

    await client.query(
      `INSERT INTO core.role_master (
         company_id, role_id, role_name, discount_percent_allowed,
         software_type, created_by, modified_by
       ) VALUES ($1, $2, 'Stylist', 0, 'SALON-POS', 'seed', 'seed')
       ON CONFLICT (company_id, role_id) DO UPDATE
         SET software_type = EXCLUDED.software_type,
             role_name = EXCLUDED.role_name,
             record_status = 'ACTIVE'`,
      [companyId, STYLIST_ROLE_ID]
    );

    await client.query(
      `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
       SELECT $1, $2, p.permission_code, TRUE
         FROM core.permission_master p
        WHERE p.is_active = TRUE AND p.permission_code LIKE 'pos.%'
       ON CONFLICT (company_id, role_id, permission_code)
         DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
      [companyId, STYLIST_ROLE_ID]
    );

    const { rows: existingTest } = await client.query(
      `SELECT staff_id, login_name, staff_name
         FROM core.staff_master
        WHERE company_id = $1
          AND (
            lower(login_name) = $2
            OR lower(staff_name) = $3
          )
        ORDER BY staff_id
        LIMIT 1`,
      [companyId, TEST_LOGIN, TEST_NAME.toLowerCase()]
    );

    const pinHash = await bcrypt.hash(TEST_PIN, 12);
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

    let testStaffId;
    if (existingTest.length) {
      testStaffId = Number(existingTest[0].staff_id);
      await client.query(
        `UPDATE core.staff_master
            SET staff_name = $3,
                login_name = $4,
                staff_pin = $5,
                password_hash = $6,
                role_id = $7,
                branch_id = $9,
                designation = 'Stylist',
                record_status = 'ACTIVE',
                email_verified = TRUE,
                modified_at = $8,
                modified_by = 'salon_enable'
          WHERE company_id = $1 AND staff_id = $2`,
        [companyId, testStaffId, TEST_NAME, TEST_LOGIN, pinHash, passwordHash, STYLIST_ROLE_ID, now, STATION_ID]
      );
      console.log(`Updated existing staff_id=${testStaffId} → Test / PIN ${TEST_PIN}`);
    } else {
      const { rows: maxStaff } = await client.query(
        `SELECT COALESCE(MAX(staff_id), 0) + 1 AS n FROM core.staff_master WHERE company_id = $1`,
        [companyId]
      );
      testStaffId = Number(maxStaff[0].n);
      await client.query(
        `INSERT INTO core.staff_master (
           company_id, staff_id, branch_id, staff_code, staff_name, designation,
           login_name, password_hash, staff_pin, role_id, record_status, email,
           email_verified, sync_status, server_status,
           created_at, created_by, modified_at, modified_by
         ) VALUES (
           $1, $2, $3, $4, $5, 'Stylist',
           $6, $7, $8, $9, 'ACTIVE', $10,
           TRUE, 'PENDING', 'PENDING',
           $11, 'salon_enable', $11, 'salon_enable'
         )`,
        [
          companyId,
          testStaffId,
          STATION_ID,
          `U${testStaffId}`,
          TEST_NAME,
          TEST_LOGIN,
          passwordHash,
          pinHash,
          STYLIST_ROLE_ID,
          'test@test1.local',
          now,
        ]
      );
      console.log(`Created staff_id=${testStaffId} Test / PIN ${TEST_PIN}`);
    }

    await client.query(
      `INSERT INTO core.station_master (
         company_id, branch_id, station_id, station_code, station_name,
         station_type, counter_no
       ) VALUES ($1, $2, $2, 'SALON1', 'Salon Front Desk', 'SALON_POS', 1)
       ON CONFLICT (company_id, station_id) DO UPDATE
         SET station_type = EXCLUDED.station_type,
             station_name = EXCLUDED.station_name,
             station_code = EXCLUDED.station_code,
             branch_id = EXCLUDED.branch_id,
             is_deleted = FALSE`,
      [companyId, STATION_ID]
    );

    await client.query(
      `UPDATE core.pos_device_enrollment
          SET branch_id = $2
        WHERE company_id = $1 AND station_id = $2 AND branch_id IS DISTINCT FROM $2`,
      [companyId, STATION_ID]
    );

    await client.query(
      `INSERT INTO accounts.accounts_parameter (
         company_id, branch_id, station_id, parameter_name, account_id,
         numeric_value, string_value, created_at, updated_at
       )
       SELECT company_id, $2, station_id, parameter_name, account_id,
              numeric_value, string_value, NOW(), NOW()
         FROM accounts.accounts_parameter
        WHERE company_id = $1 AND branch_id = 1
       ON CONFLICT (company_id, branch_id, parameter_name) DO NOTHING`,
      [companyId, STATION_ID]
    );

    await client.query(
      `UPDATE ops.job_master
          SET branch_id = $2
        WHERE company_id = $1 AND station_id = $2 AND branch_id IS DISTINCT FROM $2`,
      [companyId, STATION_ID]
    );
    await client.query(
      `UPDATE ops.job_child
          SET branch_id = $2
        WHERE company_id = $1 AND station_id = $2 AND branch_id IS DISTINCT FROM $2`,
      [companyId, STATION_ID]
    );

    for (const a of AREAS) {
      await client.query(
        `INSERT INTO core.area_master (
           company_id, branch_id, area_id, area_name, supply_type, kot_prefix,
           created_by, modified_by
         ) VALUES ($1, $2, $3, $4, 'GENERAL', $5, NULL, NULL)
         ON CONFLICT (company_id, branch_id, area_id) DO UPDATE
           SET area_name = EXCLUDED.area_name,
               kot_prefix = EXCLUDED.kot_prefix`,
        [companyId, STATION_ID, a.areaId, a.name, a.prefix]
      );
    }

    for (const t of CHAIRS) {
      await client.query(
        `INSERT INTO core.table_master (
           table_id, company_id, branch_id, area_id,
           table_no, table_name, no_of_chairs, table_format,
           created_by, modified_by
         ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'SQUARE', NULL, NULL)
         ON CONFLICT (company_id, branch_id, table_id) DO UPDATE
           SET table_name = EXCLUDED.table_name,
               area_id = EXCLUDED.area_id`,
        [t.tableId, companyId, STATION_ID, t.areaId, t.no, t.name]
      );
    }

    // Groups are read by the caller's station id (stored in branch_id). Seed
    // HQ (1) so subgroup FKs resolve, and station 3 so the salon till sees them.
    for (const branchScope of [1, STATION_ID]) {
      for (const g of GROUPS) {
        await client.query(
          `INSERT INTO biz.group_master (
             group_id, company_id, branch_id, group_code, group_description, r_status
           ) VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
           ON CONFLICT (company_id, branch_id, group_id) DO UPDATE
             SET group_description = EXCLUDED.group_description,
                 group_code = EXCLUDED.group_code,
                 r_status = 'ACTIVE'`,
          [g.groupId, companyId, branchScope, g.code, g.name]
        );
      }
    }

    for (const sg of SUBGROUPS) {
      await client.query(
        `INSERT INTO biz.sub_group_master (
           sub_group_id, company_id, group_id, branch_id,
           sub_group_code, sub_group_description, r_status
         ) VALUES ($1, $2, $3, 1, $4, $5, 'ACTIVE')
         ON CONFLICT (company_id, sub_group_id) DO UPDATE
           SET sub_group_description = EXCLUDED.sub_group_description,
               group_id = EXCLUDED.group_id,
               r_status = 'ACTIVE'`,
        [sg.subGroupId, companyId, sg.groupId, sg.code, sg.name]
      );
    }

    const { rows: invMax } = await client.query(
      `SELECT COALESCE(MAX(product_inventory_id), 0) AS n
         FROM core.product_inventory WHERE company_id = $1`,
      [companyId]
    );
    let nextInvId = Number(invMax[0].n);

    for (const p of CATALOGUE) {
      await client.query(
        `INSERT INTO core.product_master (
           company_id, product_id, product_code, product_name, short_name,
           product_type, unit_name, pack_qty, group_id, subgroup_id,
           product_status, record_status, default_duration_minutes,
           created_by, modified_by
         ) VALUES ($1, $2, $3, $4, $5, $6, 'NOS', 1, $8, $9,
                   'ACTIVE', 'ACTIVE', $7, 'salon_enable', 'salon_enable')
         ON CONFLICT (company_id, product_id) DO UPDATE
           SET product_name = EXCLUDED.product_name,
               product_code = EXCLUDED.product_code,
               product_type = EXCLUDED.product_type,
               group_id = EXCLUDED.group_id,
               subgroup_id = EXCLUDED.subgroup_id,
               default_duration_minutes = EXCLUDED.default_duration_minutes`,
        [companyId, p.id, p.code, p.name, p.name.slice(0, 20), p.type, p.duration, p.g, p.sg]
      );

      const { rows: existingInv } = await client.query(
        `SELECT product_inventory_id
           FROM core.product_inventory
          WHERE company_id = $1 AND branch_id = $2 AND product_id = $3`,
        [companyId, STATION_ID, p.id]
      );
      const invId = existingInv.length
        ? Number(existingInv[0].product_inventory_id)
        : ++nextInvId;

      await client.query(
        `INSERT INTO core.product_inventory (
           company_id, branch_id, product_inventory_id, product_id,
           pack_qty, qty_on_hand, unit_price, output_tax_1_rate,
           record_status, created_by, modified_by
         ) VALUES ($1, $2, $3, $4, 1, $5, $6, 5, 'ACTIVE', 'salon_enable', 'salon_enable')
         ON CONFLICT (company_id, branch_id, product_id) DO UPDATE
           SET unit_price = EXCLUDED.unit_price,
               qty_on_hand = EXCLUDED.qty_on_hand`,
        [companyId, STATION_ID, invId, p.id, p.type === 'SERVICE' ? 0 : 100, p.price]
      );
    }

    for (const code of SALON_FEATURES) {
      await client.query(
        `INSERT INTO core.tenant_feature_override (company_id, feature_code, is_enabled, reason)
         VALUES ($1, $2, TRUE, 'Enable salon POS on Test1')
         ON CONFLICT (company_id, feature_code) DO UPDATE
           SET is_enabled = TRUE,
               reason = EXCLUDED.reason,
               is_deleted = FALSE`,
        [companyId, code]
      );
    }

    await client.query('COMMIT');

    console.log('─────────────────────────────────────────');
    console.log('Salon added to Test1 (counter POS kept).');
    console.log(`  company     : ${companyId} Test1`);
    console.log(`  branch      : ${STATION_ID} Salon`);
    console.log(`  station     : ${STATION_ID} Salon Front Desk (SALON_POS)`);
    console.log(`  enroll as   : ${ADMIN_EMAIL}  (existing admin password)`);
    console.log(`  PIN user    : ${TEST_NAME}`);
    console.log(`  login_name  : ${TEST_LOGIN}`);
    console.log(`  PIN         : ${TEST_PIN}`);
    console.log(`  password    : ${TEST_PASSWORD}  (optional username login)`);
    console.log('─────────────────────────────────────────');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FAILED (rolled back)');
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
