/**
 * Back-fill missing accounts.accounts_parameter rows for all branches.
 * Run: node scripts/backfill-integration-defaults.mjs
 */
import pg from 'pg';
import { ensureBranchIntegrationDefaults } from '../src/accounts/repositories/accountsParameter.repository.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
    || 'postgresql://moif:404cd0a6509235427ffb6678d940b6dd9ce638e8ac84db53@localhost:5433/moifone_uae',
});

const { rows: branches } = await pool.query(
  `SELECT company_id, branch_id FROM core.branch_master ORDER BY company_id, branch_id`,
);

let total = 0;
for (const { company_id: companyId, branch_id: branchId } of branches) {
  const { applied } = await ensureBranchIntegrationDefaults(pool, Number(companyId), Number(branchId));
  if (applied > 0) {
    console.log(`company ${companyId} branch ${branchId}: applied ${applied} defaults`);
    total += applied;
  }
}
console.log(`Done. ${total} parameter rows added/updated across ${branches.length} branches.`);
await pool.end();
