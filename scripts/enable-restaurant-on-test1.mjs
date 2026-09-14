/**
 * Add a Deyno Pro test cashier onto the existing Test1 tenant, and a known
 * enroll admin so device pairing does not need the live owner password.
 *
 * Creates / updates:
 *   - Station 4 "Deyno Pro Till" (RESTAURANT_POS) — already present as Deyno Quick Till
 *   - Waiter role (RESTAURANT-POS) permissions
 *   - Admin  deyno.admin@test1.local / Test1234  (role_id = 1, for Device Setup)
 *   - Cashier Deyno / PIN 1234  (Waiter role, for Staff Sign In)
 *
 * Usage: node scripts/enable-restaurant-on-test1.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TENANT_EMAIL = 'moiftechz@gmail.com';
const STATION_ID = 4;
const WAITER_ROLE_ID = 7;

const ADMIN_EMAIL = 'deyno.admin@test1.local';
const ADMIN_LOGIN = 'deyno.admin';
const ADMIN_NAME = 'Deyno Admin';
const ADMIN_PASSWORD = 'Test1234';

const CASHIER_LOGIN = 'deyno';
const CASHIER_NAME = 'Deyno';
const CASHIER_EMAIL = 'deyno@test1.local';
const CASHIER_PIN = '1234';
const CASHIER_PASSWORD = 'Test1234';

async function upsertStaff(client, {
  companyId, staffId, branchId, name, login, email, pinHash, passwordHash, roleId, designation, now,
}) {
  const { rows } = await client.query(
    `SELECT staff_id FROM core.staff_master
      WHERE company_id = $1
        AND (
          staff_id = $2
          OR lower(login_name) = lower($3)
          OR lower(COALESCE(email,'')) = lower($4)
        )
      ORDER BY staff_id
      LIMIT 1`,
    [companyId, staffId, login, email],
  );

  if (rows.length) {
    const id = Number(rows[0].staff_id);
    await client.query(
      `UPDATE core.staff_master
          SET staff_name = $3,
              login_name = $4,
              email = $5,
              staff_pin = $6,
              password_hash = $7,
              role_id = $8,
              branch_id = $9,
              designation = $10,
              record_status = 'ACTIVE',
              email_verified = TRUE,
              modified_at = $11,
              modified_by = 'deyno_enable'
        WHERE company_id = $1 AND staff_id = $2`,
      [companyId, id, name, login, email, pinHash, passwordHash, roleId, branchId, designation, now],
    );
    return id;
  }

  const { rows: maxStaff } = await client.query(
    `SELECT COALESCE(MAX(staff_id), 0) + 1 AS n FROM core.staff_master WHERE company_id = $1`,
    [companyId],
  );
  const id = Number(maxStaff[0].n);
  await client.query(
    `INSERT INTO core.staff_master (
       company_id, staff_id, branch_id, staff_code, staff_name, designation,
       login_name, password_hash, staff_pin, role_id, record_status, email,
       email_verified, sync_status, server_status,
       created_at, created_by, modified_at, modified_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, 'ACTIVE', $11,
       TRUE, 'PENDING', 'PENDING',
       $12, 'deyno_enable', $12, 'deyno_enable'
     )`,
    [
      companyId,
      id,
      branchId,
      `U${id}`,
      name,
      designation,
      login,
      passwordHash,
      pinHash,
      roleId,
      email,
      now,
    ],
  );
  return id;
}

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
      [TENANT_EMAIL],
    );
    if (!users.length) throw new Error(`No staff found for ${TENANT_EMAIL}`);
    const companyId = Number(users[0].company_id);
    console.log(`Company ${companyId} — tenant ${users[0].email || users[0].login_name}`);

    const now = new Date().toISOString();
    const pinHash = await bcrypt.hash(CASHIER_PIN, 12);
    const cashierPasswordHash = await bcrypt.hash(CASHIER_PASSWORD, 12);
    const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    await client.query(
      `INSERT INTO core.role_master (
         company_id, role_id, role_name, discount_percent_allowed,
         software_type, created_by, modified_by
       ) VALUES ($1, $2, 'Waiter', 0, 'RESTAURANT-POS', 'seed', 'seed')
       ON CONFLICT (company_id, role_id) DO UPDATE
         SET software_type = EXCLUDED.software_type,
             role_name = EXCLUDED.role_name,
             record_status = 'ACTIVE'`,
      [companyId, WAITER_ROLE_ID],
    );

    await client.query(
      `INSERT INTO core.role_permission (company_id, role_id, permission_code, is_allowed)
       SELECT $1, $2, p.permission_code, TRUE
         FROM core.permission_master p
        WHERE p.is_active = TRUE AND p.permission_code LIKE 'pos.%'
       ON CONFLICT (company_id, role_id, permission_code)
         DO UPDATE SET is_allowed = TRUE, updated_at = NOW()`,
      [companyId, WAITER_ROLE_ID],
    );

    await client.query(
      `INSERT INTO core.station_master (
         company_id, branch_id, station_id, station_code, station_name,
         station_type, counter_no
       ) VALUES ($1, 1, $2, 'DEYNO1', 'Deyno Pro Till', 'RESTAURANT_POS', 1)
       ON CONFLICT (company_id, station_id) DO UPDATE
         SET station_type = EXCLUDED.station_type,
             station_name = EXCLUDED.station_name,
             station_code = EXCLUDED.station_code,
             branch_id = 1,
             is_deleted = FALSE`,
      [companyId, STATION_ID],
    );

    const adminId = await upsertStaff(client, {
      companyId,
      staffId: 50,
      branchId: 1,
      name: ADMIN_NAME,
      login: ADMIN_LOGIN,
      email: ADMIN_EMAIL,
      pinHash: null,
      passwordHash: adminPasswordHash,
      roleId: 1,
      designation: 'Admin',
      now,
    });

    const cashierId = await upsertStaff(client, {
      companyId,
      staffId: 51,
      branchId: 1,
      name: CASHIER_NAME,
      login: CASHIER_LOGIN,
      email: CASHIER_EMAIL,
      pinHash,
      passwordHash: cashierPasswordHash,
      roleId: WAITER_ROLE_ID,
      designation: 'Cashier',
      now,
    });

    await client.query(
      `INSERT INTO core.tenant_feature_override (company_id, feature_code, is_enabled, reason)
       VALUES ($1, 'pos', TRUE, 'Enable restaurant POS on Test1')
       ON CONFLICT (company_id, feature_code) DO UPDATE
         SET is_enabled = TRUE,
             reason = EXCLUDED.reason,
             is_deleted = FALSE`,
      [companyId],
    );

    await client.query('COMMIT');

    console.log('─────────────────────────────────────────');
    console.log('Deyno Pro test users on Test1.');
    console.log(`  company     : ${companyId} Test1`);
    console.log(`  station     : ${STATION_ID} Deyno Pro Till (RESTAURANT_POS)`);
    console.log(`  enroll as   : ${ADMIN_EMAIL}`);
    console.log(`  password    : ${ADMIN_PASSWORD}`);
    console.log(`  PIN user    : ${CASHIER_NAME} (staff_id=${cashierId})`);
    console.log(`  PIN         : ${CASHIER_PIN}`);
    console.log(`  admin staff : ${adminId}`);
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
