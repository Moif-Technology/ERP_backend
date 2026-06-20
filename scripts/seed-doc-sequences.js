/**
 * Seed script: populate core.document_sequence for all companies + branches.
 *
 * Run AFTER migrations 081 + 082 are applied.
 * Safe to re-run — ON CONFLICT DO NOTHING skips existing rows.
 *
 * Usage:
 *   node scripts/seed-doc-sequences.js
 *   node scripts/seed-doc-sequences.js --dry-run
 *   node scripts/seed-doc-sequences.js --year 2025
 */

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;
const DRY_RUN = process.argv.includes('--dry-run');
const EXTRA_YEARS = [];
const yIdx = process.argv.indexOf('--year');
if (yIdx !== -1 && process.argv[yIdx + 1]) EXTRA_YEARS.push(Number(process.argv[yIdx + 1]));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const CURRENT_YEAR = new Date().getFullYear();

// ── Sequence definitions (mirrors docSequence.service.js) ──────────────────
const NEVER = [
  // BACKOFFICE
  { module: 'BACKOFFICE', sequenceCode: 'GROUP',          sequenceName: 'Group Code',           prefix: 'GRP', padLength: 3 },
  { module: 'BACKOFFICE', sequenceCode: 'SUB_GROUP',      sequenceName: 'Sub Group Code',       prefix: 'SGP', padLength: 3 },
  { module: 'BACKOFFICE', sequenceCode: 'SUB_SUB_GROUP',  sequenceName: 'Sub Sub Group Code',   prefix: 'SSG', padLength: 3 },
  { module: 'BACKOFFICE', sequenceCode: 'CUSTOMER',       sequenceName: 'Customer Code',        prefix: 'CUS', padLength: 5 },
  { module: 'BACKOFFICE', sequenceCode: 'SUPPLIER',       sequenceName: 'Supplier Code',        prefix: 'SUP', padLength: 5 },
  { module: 'BACKOFFICE', sequenceCode: 'PRODUCT',        sequenceName: 'Product Code',         prefix: 'PRD', padLength: 6 },
  // HR
  { module: 'HR',         sequenceCode: 'STAFF',          sequenceName: 'Staff Code',           prefix: 'STF', padLength: 5 },
  { module: 'HR',         sequenceCode: 'EMPLOYEE',       sequenceName: 'Employee Code',        prefix: 'EMP', padLength: 5 },
  // CRM
  { module: 'CRM',        sequenceCode: 'LEAD',           sequenceName: 'Lead Code',            prefix: 'LD',  padLength: 5 },
  { module: 'CRM',        sequenceCode: 'OPPORTUNITY',    sequenceName: 'Opportunity Code',     prefix: 'OPP', padLength: 5 },
  // GARAGE — master codes
  { module: 'GARAGE',     sequenceCode: 'TECHNICIAN',      sequenceName: 'Technician Code',      prefix: 'TCH', padLength: 4 },
  // RESTAURANT
  { module: 'RESTAURANT', sequenceCode: 'KOT',            sequenceName: 'Kitchen Order Ticket', prefix: 'KOT', padLength: 4 },
  // COUNTER_POS
  { module: 'COUNTER_POS',sequenceCode: 'HOLD_BILL',      sequenceName: 'Hold Bill',            prefix: 'HLD', padLength: 4 },
];

const YEARLY = [
  // BACKOFFICE
  { module: 'BACKOFFICE', sequenceCode: 'SALES',           sequenceName: 'Sales Invoice',        prefix: 'INV', padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'SALES_RETURN',    sequenceName: 'Sales Return',         prefix: 'RTN', padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'PURCHASE',        sequenceName: 'Purchase Order',       prefix: 'PO',  padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'PURCHASE_RETURN', sequenceName: 'Purchase Return',      prefix: 'PRN', padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'GRN',             sequenceName: 'Goods Receipt Note',   prefix: 'GRN', padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'QUOTATION',       sequenceName: 'Quotation',            prefix: 'QT',  padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'LPO',             sequenceName: 'Local Purchase Order', prefix: 'LPO', padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'DELIVERY',        sequenceName: 'Delivery Order',       prefix: 'DO',  padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'TRANSFER',        sequenceName: 'Stock Transfer',       prefix: 'TRF', padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'STOCK_ADJ',       sequenceName: 'Stock Adjustment',     prefix: 'SA',  padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'STOCK_DMG',       sequenceName: 'Damage Entry',         prefix: 'DM',  padLength: 5 },
  { module: 'BACKOFFICE', sequenceCode: 'STOCK_ASE',       sequenceName: 'Stock Audit Entry',    prefix: 'AS',  padLength: 5 },
  { module: 'BACKOFFICE', sequenceCode: 'OPENING_STOCK',     sequenceName: 'Opening Stock Entry',  prefix: 'OS',  padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'MATERIAL_REQUEST',  sequenceName: 'Material Request',     prefix: 'MRQ', padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'ORDER_FORM',        sequenceName: 'LPO Order Form',       prefix: 'OF',  padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'VAN_SALES',          sequenceName: 'Van Sale Invoice',     prefix: 'VS',  padLength: 4 },
  { module: 'BACKOFFICE', sequenceCode: 'VAN_SETTLEMENT',     sequenceName: 'Van Sale Settlement',  prefix: 'VST', padLength: 4 },
  // ACCOUNTS
  { module: 'ACCOUNTS',   sequenceCode: 'RECEIPT',         sequenceName: 'Receipt Voucher',      prefix: 'RCP', padLength: 4 },
  { module: 'ACCOUNTS',   sequenceCode: 'PAYMENT',         sequenceName: 'Payment Voucher',      prefix: 'PV',  padLength: 4 },
  { module: 'ACCOUNTS',   sequenceCode: 'JOURNAL',         sequenceName: 'Journal Voucher',      prefix: 'JV',  padLength: 4 },
  { module: 'ACCOUNTS',   sequenceCode: 'CONTRA',          sequenceName: 'Contra Voucher',       prefix: 'CV',  padLength: 4 },
  { module: 'ACCOUNTS',   sequenceCode: 'DEBIT_NOTE',      sequenceName: 'Debit Note',           prefix: 'DN',  padLength: 4 },
  { module: 'ACCOUNTS',   sequenceCode: 'CREDIT_NOTE',     sequenceName: 'Credit Note',          prefix: 'CN',  padLength: 4 },
  { module: 'ACCOUNTS',   sequenceCode: 'EXPENSE',         sequenceName: 'Expense Voucher',      prefix: 'EXP', padLength: 4 },
  { module: 'ACCOUNTS',   sequenceCode: 'INCOME',          sequenceName: 'Income Voucher',       prefix: 'INC', padLength: 4 },
  { module: 'ACCOUNTS',   sequenceCode: 'VOUCHER',         sequenceName: 'General Voucher',      prefix: 'VCH', padLength: 4 },
  // GARAGE
  { module: 'GARAGE',     sequenceCode: 'JOB_CARD',        sequenceName: 'Job Card',             prefix: 'JC',  padLength: 5 },
  { module: 'GARAGE',     sequenceCode: 'PRE_JOB_CARD',    sequenceName: 'Pre Job Card',         prefix: 'PJC', padLength: 5 },
  { module: 'GARAGE',     sequenceCode: 'ESTIMATION',      sequenceName: 'Estimation',           prefix: 'EST', padLength: 5 },
  { module: 'GARAGE',     sequenceCode: 'GATE_PASS',       sequenceName: 'Gate Pass',            prefix: 'GP',  padLength: 5 },
  { module: 'GARAGE',     sequenceCode: 'GARAGE_INVOICE',  sequenceName: 'Garage Invoice',       prefix: 'GI',  padLength: 5 },
  { module: 'GARAGE',     sequenceCode: 'PART_REQUEST',    sequenceName: 'Part Request',         prefix: 'PR',  padLength: 5 },
  { module: 'GARAGE',     sequenceCode: 'SUBLET_LPO',      sequenceName: 'Sublet LPO',           prefix: 'SLO', padLength: 5 },
  { module: 'GARAGE',     sequenceCode: 'SUBLET_JOB',      sequenceName: 'Sublet Job',           prefix: 'SJ',  padLength: 5 },
  // RESTAURANT
  { module: 'RESTAURANT', sequenceCode: 'ADVANCE_PAYMENT', sequenceName: 'Advance Payment',          prefix: 'ADV', padLength: 4 },
  { module: 'RESTAURANT', sequenceCode: 'PARTY_ORDER',     sequenceName: 'Party Order',              prefix: 'POR', padLength: 4 },
  { module: 'RESTAURANT', sequenceCode: 'PRODUCTION',      sequenceName: 'Production Entry',            prefix: 'PRO', padLength: 4 },
  { module: 'RESTAURANT', sequenceCode: 'PRO_REQUEST',     sequenceName: 'Product Transfer Request',    prefix: 'PRQ', padLength: 4 },
  { module: 'RESTAURANT', sequenceCode: 'PRO_RECEIPT',     sequenceName: 'Product Transfer Receipt',    prefix: 'PRC', padLength: 4 },
  // COUNTER_POS
  { module: 'COUNTER_POS',sequenceCode: 'COUNTER_CLOSE',   sequenceName: 'Counter Close',        prefix: 'CCL', padLength: 4 },
];

async function fetchCompaniesAndBranches(client) {
  const { rows } = await client.query(`
    SELECT c.company_id, c.company_name, b.branch_id, b.branch_name
    FROM core.company_master c
    JOIN core.branch_master b ON b.company_id = c.company_id
    ORDER BY c.company_id, b.branch_id
  `);
  return rows;
}

async function upsertRow(client, params) {
  const { companyId, branchId, sequenceCode, sequenceName, prefix, padLength, resetRule, fiscalYear, module } = params;

  if (DRY_RUN) {
    console.log(
      `  [DRY] ${module.padEnd(11)} company=${companyId} branch=${branchId}` +
      ` code=${sequenceCode.padEnd(16)} prefix=${prefix.padEnd(4)} pad=${padLength} reset=${resetRule} year=${fiscalYear ?? 'NULL'}`,
    );
    return;
  }

  await client.query(
    `INSERT INTO core.document_sequence
       (company_id, branch_id, sequence_code, sequence_name,
        prefix, pad_length, reset_rule, fiscal_year, module,
        current_value, step_value, is_active,
        created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, 0, 1, true, 0, 0)
     ON CONFLICT (company_id, branch_id, sequence_code,
                  COALESCE(fiscal_year, 0), COALESCE(fiscal_month, 0))
     DO NOTHING`,
    [companyId, branchId, sequenceCode, sequenceName, prefix, padLength, resetRule, fiscalYear, module],
  );
}

async function run() {
  const client = await pool.connect();
  try {
    const branches = await fetchCompaniesAndBranches(client);

    if (!branches.length) {
      console.log('No companies/branches found. Nothing to seed.');
      return;
    }

    console.log(`Found ${branches.length} company+branch combinations.`);
    if (DRY_RUN) console.log('DRY RUN — no DB writes.\n');

    const fiscalYears = [...new Set([CURRENT_YEAR, ...EXTRA_YEARS])];
    let total = 0;

    for (const row of branches) {
      const { company_id: companyId, branch_id: branchId, company_name, branch_name } = row;
      console.log(`\n  Company ${companyId} (${company_name}) / Branch ${branchId} (${branch_name})`);

      for (const def of NEVER) {
        await upsertRow(client, { companyId, branchId, ...def, resetRule: 'NEVER', fiscalYear: null });
        total++;
      }

      for (const year of fiscalYears) {
        for (const def of YEARLY) {
          await upsertRow(client, { companyId, branchId, ...def, resetRule: 'YEARLY', fiscalYear: year });
          total++;
        }
      }
    }

    console.log(`\n${DRY_RUN ? '[DRY] Would insert' : 'Inserted/skipped'} ${total} sequence rows.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
