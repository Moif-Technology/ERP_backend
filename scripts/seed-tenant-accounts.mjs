/**
 * Backfill default chart of accounts / voucher types / ledger params for
 * companies that have none. Idempotent (seed uses ON CONFLICT DO NOTHING).
 *
 *   node scripts/seed-tenant-accounts.mjs            # all companies missing a chart
 *   node scripts/seed-tenant-accounts.mjs 7          # only company_id 7
 *
 * Requires migration 079 applied first (per-company PK on account_head_master).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { seedDefaultTenantAccounts } from '../src/accounts/repositories/accountsSeed.repository.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const onlyCompany = process.argv[2] ? Number(process.argv[2]) : null;
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
           SELECT 1 FROM accounts.account_head_master a WHERE a.company_id = c.company_id
         )
         ORDER BY c.company_id`
      );
      companies = rows;
    }
    if (!companies.length) {
      console.log('No companies need seeding.');
      return;
    }
    for (const { company_id } of companies) {
      // Use the head-office branch (lowest branch_id) for the new company.
      const { rows: br } = await client.query(
        `SELECT MIN(branch_id) AS branch_id FROM core.branch_master WHERE company_id = $1`,
        [company_id]
      );
      const branchId = br[0]?.branch_id ?? 1;
      await client.query('BEGIN');
      await seedDefaultTenantAccounts(client, { companyId: company_id, branchId, actor: 'backfill' });
      await client.query('COMMIT');
      console.log(`  seeded accounts for company_id=${company_id} (branch ${branchId})`);
    }
    console.log(`Done. ${companies.length} company(ies) processed.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Seed failed:', e.message);
    if (e.code) console.error('  code:', e.code, e.detail || '');
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
