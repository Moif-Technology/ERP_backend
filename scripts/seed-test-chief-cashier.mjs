/**
 * Create / update a CHIEF CASHIER test login for the restaurant POS branch.
 * Username 123 / password 123 — for AdminLoginFrm approval in Deyno.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const LOGIN = '123';
const PASSWORD = '123';
const PIN = '1234';
const DESIGNATION = 'CHIEF CASHIER';
const STAFF_NAME = 'Test Chief Cashier';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing');
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const stations = await client.query(
      `SELECT c.company_id, c.company_name, s.station_id, s.station_name,
              s.branch_id AS physical_branch_id, s.station_type
         FROM core.station_master s
         JOIN core.company_master c ON c.company_id = s.company_id
        WHERE UPPER(COALESCE(s.station_type, '')) IN ('RESTAURANT_POS', 'RESTAURANT-POS')
          AND COALESCE(s.is_deleted, FALSE) = FALSE
        ORDER BY
          CASE WHEN LOWER(s.station_name) LIKE '%deyno%' THEN 0 ELSE 1 END,
          c.company_id, s.station_id`,
    );
    if (!stations.rows.length) {
      throw new Error('No RESTAURANT_POS station found');
    }
    console.log('Restaurant stations:');
    for (const row of stations.rows) {
      console.log(
        `  company ${row.company_id} ${row.company_name} / station ${row.station_id} ${row.station_name} / branch ${row.physical_branch_id}`,
      );
    }

    const station = stations.rows[0];
    const companyId = Number(station.company_id);
    const stationId = Number(station.station_id);
    const staffBranchId = Number(station.physical_branch_id) || stationId;

    const roles = await client.query(
      `SELECT role_id, role_name, software_type
         FROM core.role_master
        WHERE company_id = $1
          AND record_status = 'ACTIVE'
        ORDER BY role_id`,
      [companyId],
    );
    console.log('Roles:', roles.rows.map((r) => `${r.role_id}:${r.role_name}/${r.software_type}`).join(', ') || '(none)');

    let roleId =
      roles.rows.find((r) => String(r.role_name).toUpperCase() === 'ADMIN')?.role_id ??
      roles.rows.find((r) => String(r.role_name).toUpperCase().includes('CHIEF'))?.role_id ??
      roles.rows.find((r) => Number(r.role_id) === 1)?.role_id ??
      null;
    if (roleId == null) {
      const nextRole = await client.query(
        `SELECT COALESCE(MAX(role_id), 0) + 1 AS n FROM core.role_master WHERE company_id = $1`,
        [companyId],
      );
      roleId = Number(nextRole.rows[0].n);
      await client.query(
        `INSERT INTO core.role_master (
            company_id, role_id, role_name, software_type, record_status, created_at, modified_at
         ) VALUES ($1, $2, 'Admin', 'RESTAURANT-POS', 'ACTIVE', NOW(), NOW())`,
        [companyId, roleId],
      );
      console.log(`Created Admin role_id=${roleId}`);
    }
    roleId = Number(roleId);

    const existingLogin = await client.query(
      `SELECT id, company_id, staff_id, login_name, designation, branch_id, record_status
         FROM core.staff_master
        WHERE LOWER(login_name) = LOWER($1)`,
      [LOGIN],
    );

    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    const pinHash = await bcrypt.hash(PIN, 12);

    if (existingLogin.rows.length) {
      const row = existingLogin.rows[0];
      if (Number(row.company_id) !== companyId) {
        throw new Error(
          `Login "${LOGIN}" already exists on company ${row.company_id}, not restaurant company ${companyId}`,
        );
      }
      await client.query(
        `UPDATE core.staff_master SET
            password_hash = $2,
            staff_pin = $3,
            designation = $4,
            role_id = $5,
            branch_id = $6,
            record_status = 'ACTIVE',
            staff_name = COALESCE(NULLIF(staff_name, ''), $7),
            modified_at = NOW(),
            modified_by = 'test_seed'
         WHERE id = $1`,
        [row.id, passwordHash, pinHash, DESIGNATION, roleId, staffBranchId, STAFF_NAME],
      );
      await client.query('COMMIT');
      console.log(
        `Updated existing staff id=${row.id} staff_id=${row.staff_id} as ${DESIGNATION} on branch ${staffBranchId} / station ${stationId}`,
      );
    } else {
      const nextId = await client.query(
        `SELECT COALESCE(MAX(staff_id), 0) + 1 AS n FROM core.staff_master WHERE company_id = $1`,
        [companyId],
      );
      const staffId = Number(nextId.rows[0].n);
      const staffCode = `CC${String(staffId).padStart(3, '0')}`;
      await client.query(
        `INSERT INTO core.staff_master (
            company_id, staff_id, branch_id, staff_code, staff_name, designation,
            login_name, password_hash, staff_pin, role_id, mobile_no, email,
            sync_status, server_status, record_status,
            created_at, created_by, modified_at, modified_by
         ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, NULL, $11,
            'PENDING', 'PENDING', 'ACTIVE',
            NOW(), 'test_seed', NOW(), 'test_seed'
         )`,
        [
          companyId,
          staffId,
          staffBranchId,
          staffCode,
          STAFF_NAME,
          DESIGNATION,
          LOGIN,
          passwordHash,
          pinHash,
          roleId,
          `${LOGIN}@restaurant.local`,
        ],
      );
      await client.query('COMMIT');
      console.log(
        `Created staff_id=${staffId} ${DESIGNATION} login=${LOGIN} company=${companyId} branch=${staffBranchId} station=${stationId} (${station.company_name} / ${station.station_name})`,
      );
    }

    const check = await client.query(
      `SELECT s.staff_id, s.login_name, s.designation, s.branch_id, s.role_id, r.role_name, r.software_type
         FROM core.staff_master s
         LEFT JOIN core.role_master r ON r.company_id = s.company_id AND r.role_id = s.role_id
        WHERE s.company_id = $1 AND LOWER(s.login_name) = LOWER($2)`,
      [companyId, LOGIN],
    );
    console.log('Verify row:', check.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
