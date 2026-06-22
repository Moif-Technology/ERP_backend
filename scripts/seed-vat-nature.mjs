/**
 * Seed standard VAT nature rows (legacy VATNatureTable) per company.
 *
 *   node scripts/seed-vat-nature.mjs              # companies with no VAT nature rows
 *   node scripts/seed-vat-nature.mjs 1            # company_id 1 only
 *   node scripts/seed-vat-nature.mjs 1 --replace  # delete + re-insert for company
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { seedVatNatures } from '../src/accounts/repositories/accountsSeed.repository.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const onlyCompany = process.argv[2] && !process.argv[2].startsWith('--')
    ? Number(process.argv[2])
    : null;
  const replace = process.argv.includes('--replace');

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    let companies;
    if (onlyCompany) {
      companies = [{ company_id: onlyCompany }];
    } else {
      const { rows } = await client.query(
        `SELECT c.company_id
         FROM core.company_master c
         WHERE NOT EXISTS (
           SELECT 1 FROM accounts.vat_nature_master v WHERE v.company_id = c.company_id
         )
         ORDER BY c.company_id`,
      );
      companies = rows;
    }

    if (!companies.length) {
      console.log('No companies need VAT nature seeding.');
      return;
    }

    for (const { company_id } of companies) {
      await client.query('BEGIN');
      if (replace) {
        await client.query(
          'DELETE FROM accounts.vat_nature_master WHERE company_id = $1',
          [company_id],
        );
      }
      await seedVatNatures(client, Number(company_id), replace ? 'vat-replace' : 'vat-seed');
      await client.query('COMMIT');
      const { rows: cnt } = await client.query(
        'SELECT COUNT(*)::int n FROM accounts.vat_nature_master WHERE company_id = $1',
        [company_id],
      );
      console.log(`  company_id=${company_id}: ${cnt[0].n} VAT nature rows`);
    }
    console.log(`Done. ${companies.length} company(ies) processed.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Seed failed:', e.message);
    if (e.detail) console.error('  detail:', e.detail);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
