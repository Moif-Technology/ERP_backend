/**
 * Seed default PINs for all staff that don't have one.
 * Each company starts at 1234, increments per staff (ordered by staff_id).
 * PINs are bcrypt-hashed (cost 10) matching the auth flow.
 * Usage: node scripts/seed-staff-pins.mjs [--dry-run]
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const SALT_ROUNDS = 10;
const PIN_START = 1234;

function nextPin(n) {
  // Wrap at 9999 back to 1000 to keep 4 digits
  return n >= 9999 ? 1000 : n + 1;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    // Get all companies
    const { rows: companies } = await client.query(
      `SELECT DISTINCT company_id FROM core.staff_master WHERE record_status = 'ACTIVE' ORDER BY company_id`
    );

    console.log(`Companies found: ${companies.length}`);
    if (DRY_RUN) console.log('[DRY RUN] No writes will happen.\n');

    let totalUpdated = 0;

    for (const { company_id } of companies) {
      // Get staff without pin, ordered by staff_id
      const { rows: staff } = await client.query(
        `SELECT staff_id, staff_name FROM core.staff_master
         WHERE company_id = $1 AND record_status = 'ACTIVE' AND staff_pin IS NULL
         ORDER BY staff_id ASC`,
        [company_id]
      );

      if (staff.length === 0) {
        console.log(`Company ${company_id}: all staff already have pins. Skipping.`);
        continue;
      }

      console.log(`Company ${company_id}: assigning pins to ${staff.length} staff...`);

      let pin = PIN_START;
      for (const s of staff) {
        const pinStr = String(pin).padStart(4, '0');
        console.log(`  staff_id=${s.staff_id} "${s.staff_name}" → PIN ${pinStr}`);

        if (!DRY_RUN) {
          const hash = await bcrypt.hash(pinStr, SALT_ROUNDS);
          await client.query(
            `UPDATE core.staff_master SET staff_pin = $1, modified_at = NOW(), modified_by = 'pin_seed'
             WHERE company_id = $2 AND staff_id = $3`,
            [hash, company_id, s.staff_id]
          );
        }

        totalUpdated++;
        pin = nextPin(pin);
      }
    }

    console.log(`\nDone. ${DRY_RUN ? '[DRY RUN] Would have updated' : 'Updated'} ${totalUpdated} staff records.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
