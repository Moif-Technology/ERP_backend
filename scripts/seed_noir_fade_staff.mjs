/**
 * Reset Noir Fade DXB staff — delete all, insert Shanid/Faslu/Ajmal/Haris with PINs.
 *
 * Usage:
 *   node scripts/seed_noir_fade_staff.mjs           # dry run
 *   node scripts/seed_noir_fade_staff.mjs --execute
 */
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';

dotenv.config();

const COMPANY_ID = 7;
const BRANCH_ID = 1;
const EXECUTE = process.argv.includes('--execute');
const SALT_ROUNDS = 12;

const STAFF = [
  { staffId: 1, name: 'Shanid', login: 'shanid', pin: '1997', roleId: 1, designation: 'Admin' },
  { staffId: 2, name: 'Faslu', login: 'faslu', pin: '1995', roleId: 2, designation: 'Stylist' },
  { staffId: 3, name: 'Ajmal', login: 'ajmal', pin: '2001', roleId: 2, designation: 'Stylist' },
  { staffId: 4, name: 'Haris', login: 'haris', pin: '1234', roleId: 2, designation: 'Stylist' },
];

async function main() {
  const client = new pg.Client(
    process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:5432/moifone_uae',
  );
  await client.connect();

  try {
    const co = await client.query(
      `SELECT company_id, company_code, company_name FROM core.company_master WHERE company_id = $1`,
      [COMPANY_ID],
    );
    if (!co.rows.length) throw new Error(`Company ${COMPANY_ID} not found`);
    console.log('Company:', co.rows[0]);
    console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN (pass --execute to apply)'}\n`);

    const before = await client.query(
      `SELECT staff_id, staff_name, login_name, role_id FROM core.staff_master WHERE company_id = $1 ORDER BY staff_id`,
      [COMPANY_ID],
    );
    console.log(`Current staff (${before.rows.length}):`);
    for (const row of before.rows) {
      console.log(`  ${row.staff_id} ${row.staff_name} (${row.login_name}) role=${row.role_id}`);
    }
    console.log('');

    if (!EXECUTE) {
      console.log('Will insert:');
      for (const s of STAFF) {
        console.log(`  ${s.name} login=${s.login} PIN=${s.pin} role=${s.roleId}${s.roleId === 1 ? ' (Admin)' : ''}`);
      }
      return;
    }

    await client.query('BEGIN');

    const del = await client.query(`DELETE FROM core.staff_master WHERE company_id = $1`, [COMPANY_ID]);
    console.log(`Deleted ${del.rowCount} staff row(s)`);

    const now = new Date().toISOString();
    for (const s of STAFF) {
      const pinHash = await bcrypt.hash(s.pin, SALT_ROUNDS);
      const passwordHash = await bcrypt.hash(s.pin, SALT_ROUNDS);
      await client.query(
        `INSERT INTO core.staff_master (
           company_id, staff_id, branch_id, staff_code, staff_name, designation,
           login_name, password_hash, staff_pin, role_id, record_status,
           sync_status, server_status, created_at, created_by, modified_at, modified_by
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, 'ACTIVE',
           'PENDING', 'PENDING', $11, 'staff_seed', $11, 'staff_seed'
         )`,
        [
          COMPANY_ID,
          s.staffId,
          BRANCH_ID,
          `U${s.staffId}`,
          s.name,
          s.designation,
          s.login,
          passwordHash,
          pinHash,
          s.roleId,
          now,
        ],
      );
      console.log(`Inserted ${s.name} (staff_id=${s.staffId}, login=${s.login}, PIN=${s.pin}, role=${s.roleId})`);
    }

    await client.query('COMMIT');
    console.log('\nDone — Noir Fade staff reset complete.');
    console.log('Shanid is Admin (role_id=1) — POS admin menus + device enrollment.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
