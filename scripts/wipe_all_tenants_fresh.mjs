// Full fresh reset: delete EVERY company and all tenant-scoped data.
// Keeps only the platform/global catalog (plans, features, software types,
// permissions, limits, currencies, parameter definitions, platform users).
// After this, the database is exactly "post-seed" state — register from scratch.
// Usage: node scripts/wipe_all_tenants_fresh.mjs --execute   (without --execute = dry run)
import pg from 'pg';

const EXECUTE = process.argv.includes('--execute');

// Transactional tables: ALL rows deleted. Children listed before parents.
const TX_TABLES = [
  // ops
  'ops.sales_child', 'ops.sales_payment_split', 'ops.sales_master',
  'ops.purchase_child', 'ops.purchase_master',
  'ops.quotation_child', 'ops.quotation_master',
  'ops.lpo_child', 'ops.lpo_master',
  'ops.lpo_order_form_child', 'ops.lpo_order_form_master',
  'ops.material_request_child', 'ops.material_request_master',
  'ops.kot_child', 'ops.kot_child_temp', 'ops.kot_master', 'ops.kot_master_temp',
  'ops.delivery_order_child', 'ops.delivery_order_master',
  'ops.party_order_detail', 'ops.party_order_master',
  'ops.receipt_child', 'ops.receipt_master',
  'ops.recipe_transaction', 'ops.stock_adjustment', 'ops.stock_balance_entry',
  'ops.stock_entry_detail', 'ops.stock_entry_master',
  'ops.transfer_detail', 'ops.transfer_master',
  'ops.van_sale_settlement_master', 'ops.cash_in_out', 'ops.counter_close',
  'ops.daily_counter_transaction', 'ops.discount_entry', 'ops.gift_voucher',
  'ops.item_cancel', 'ops.item_clear', 'ops.product_log_entry', 'ops.product_movement_register',
  'ops.offer_packet_line', 'ops.offer_packet', 'ops.offer_packing_entry', 'ops.offer_unpacking_entry',
  // accounts
  'accounts.voucher_detail', 'accounts.voucher_master',
  'accounts.transaction_expense_detail',
  'accounts.cash_transaction_child', 'accounts.cash_transaction_master',
  // garage
  'garage.job_card_status_history', 'garage.job_code_punching', 'garage.job_card_follow_up',
  'garage.job_card_line', 'garage.job_card_child',
  'garage.part_request_line', 'garage.part_request',
  'garage.invoice_line', 'garage.invoice',
  'garage.gate_pass', 'garage.sublet_lpo', 'garage.sublet_job',
  'garage.estimation_line', 'garage.estimation_child', 'garage.estimation', 'garage.estimation_master',
  'garage.consumable_usage', 'garage.lubricant_usage',
  'garage.time_punching_detail', 'garage.time_punching_master',
  'garage.delivery_master',
  'garage.job_card', 'garage.job_card_master',
  'garage.pre_job_card', 'garage.pre_job_card_master',
  // biz (CRM records + stock receipts + loyalty movements)
  'biz.customer_followup', 'biz.customer_interaction_log', 'biz.customer_note',
  'biz.opportunity_master', 'biz.lead_master',
  'biz.grn_child', 'biz.grn_master',
  'biz.customer_advance_payment',
  'biz.loyalty_movement_register', 'biz.loyalty_details', 'biz.loyalty_voucher_master',
  'biz.fast_move_reg',
  // hr
  'hr.attendance_log', 'hr.attendance_pair', 'hr.attendance_daily', 'hr.attendance_monthly',
  'hr.leave_request', 'hr.payroll_detail', 'hr.payroll_master',
  'hr.loan_transaction', 'hr.loan_master', 'hr.shift_assignment', 'hr.attachment_master',
  // core logs/tokens
  'core.subscription_audit_log', 'core.password_reset_token',
];

// Global catalog — must never be touched.
const PROTECTED_TABLES = new Set([
  'core.feature_master', 'core.limit_master', 'core.permission_master',
  'core.plan_master', 'core.plan_feature', 'core.plan_limit',
  'core.software_type_master', 'core.software_type_feature',
  'core.platform_role', 'core.platform_role_capability',
  'core.platform_user', 'core.platform_user_role',
  'core.parameter_definition', 'core.currency_master',
  'core.country_master', 'core.app_parameter',
]);

async function main() {
  const client = new pg.Client(process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:5432/moifone_uae');
  await client.connect();

  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN (pass --execute to apply)'}`);
  console.log('Deleting ALL companies and tenant data; keeping global catalog only.\n');

  // Discover all tables that carry a company_id column (tenant-scoped).
  const { rows: scoped } = await client.query(`
    SELECT c.table_schema || '.' || c.table_name AS tbl
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.column_name = 'company_id'
      AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
      AND t.table_type = 'BASE TABLE'
    ORDER BY 1
  `);
  const tenantTables = scoped
    .map((r) => r.tbl)
    .filter((t) => !PROTECTED_TABLES.has(t) && t !== 'core.company_master');

  await client.query('BEGIN');
  try {
    let totalDeleted = 0;

    console.log('--- Phase 1: transactional data ---');
    let pending = [...TX_TABLES];
    for (let pass = 1; pending.length && pass <= 5; pass++) {
      const retry = [];
      for (const tbl of pending) {
        await client.query('SAVEPOINT sp');
        try {
          const res = await client.query(`DELETE FROM ${tbl}`);
          if (res.rowCount > 0) console.log(`  ${tbl}: deleted ${res.rowCount}`);
          totalDeleted += res.rowCount;
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT sp');
          retry.push(tbl);
          if (pass === 5) console.error(`  FAILED ${tbl}: ${err.message}`);
        }
      }
      pending = retry;
    }
    if (pending.length) throw new Error(`Could not clear: ${pending.join(', ')}`);

    console.log('\n--- Phase 2: all tenant-scoped rows ---');
    pending = [...tenantTables];
    for (let pass = 1; pending.length && pass <= 10; pass++) {
      const retry = [];
      for (const tbl of pending) {
        await client.query('SAVEPOINT sp');
        try {
          const res = await client.query(`DELETE FROM ${tbl}`);
          if (res.rowCount > 0) console.log(`  ${tbl}: deleted ${res.rowCount}`);
          totalDeleted += res.rowCount;
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT sp');
          retry.push(tbl);
          if (pass === 10) console.error(`  FAILED ${tbl}: ${err.message}`);
        }
      }
      pending = retry;
    }
    if (pending.length) throw new Error(`Could not clear: ${pending.join(', ')}`);

    const companies = await client.query('DELETE FROM core.company_master');
    console.log(`  core.company_master: deleted ${companies.rowCount}`);
    totalDeleted += companies.rowCount;

    if (EXECUTE) {
      await client.query('COMMIT');
      console.log(`\nCOMMITTED. Total rows deleted: ${totalDeleted}`);
    } else {
      await client.query('ROLLBACK');
      console.log(`\nDRY RUN rolled back. Would delete ${totalDeleted} rows. Re-run with --execute.`);
    }

    const left = (await client.query('SELECT COUNT(*)::int AS n FROM core.company_master')).rows[0];
    const seeds = (await client.query(`
      SELECT (SELECT COUNT(*)::int FROM core.plan_master) AS plans,
             (SELECT COUNT(*)::int FROM core.feature_master) AS features,
             (SELECT COUNT(*)::int FROM core.software_type_master) AS software_types,
             (SELECT COUNT(*)::int FROM core.software_type_feature) AS type_feature_map,
             (SELECT COUNT(*)::int FROM core.permission_master) AS permissions,
             (SELECT COUNT(*)::int FROM core.platform_user) AS platform_users
    `)).rows[0];
    console.log(`Companies remaining: ${left.n}`);
    console.log('Global seeds intact:', JSON.stringify(seeds));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nABORTED, nothing changed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
