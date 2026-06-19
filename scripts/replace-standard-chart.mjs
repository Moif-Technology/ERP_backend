/**
 * Replace chart of accounts for one or all companies with the standard legacy template.
 *
 *   node scripts/replace-standard-chart.mjs        # all companies
 *   node scripts/replace-standard-chart.mjs 1      # company_id 1 only
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { replaceStandardChart } from '../src/accounts/repositories/accountsSeed.repository.js';

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
        `SELECT company_id FROM core.company_master ORDER BY company_id`,
      );
      companies = rows;
    }
    if (!companies.length) {
      console.log('No companies found.');
      return;
    }
    for (const { company_id } of companies) {
      const { rows: br } = await client.query(
        `SELECT MIN(branch_id) AS branch_id FROM core.branch_master WHERE company_id = $1`,
        [company_id],
      );
      const branchId = br[0]?.branch_id ?? 1;
    await client.query('BEGIN');
    await replaceStandardChart(client, {
        companyId: Number(company_id),
        branchId: Number(branchId),
        actor: 'replace-standard-chart',
      });
      await client.query('COMMIT');
      const { rows: cnt } = await client.query(
        `SELECT COUNT(*)::int n FROM accounts.account_head_master WHERE company_id = $1`,
        [company_id],
      );
      console.log(`  company_id=${company_id}: ${cnt[0].n} accounts (branch ${branchId})`);
    }
    console.log(`Done. ${companies.length} company(ies) replaced.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Replace failed:', e.message);
    if (e.detail) console.error('  detail:', e.detail);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
