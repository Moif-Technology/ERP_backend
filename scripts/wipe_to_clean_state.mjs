// One-off cleanup: wipe all transactional data, delete all tenants except company_id=1,
// keep platform seeds (plans, features, permissions, software types) and company 1 masters.
// Usage: node scripts/wipe_to_clean_state.mjs --execute   (without --execute = dry run)
import pg from 'pg';

const KEEP_COMPANY_ID = 1;
const EXECUTE = process.argv.includes('--execute');

// Transactional tables: ALL rows deleted (every company). Children listed before parents.
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

// Platform tables that have company_id semantics but must never be touched.
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

  const countRow = async (sql, params = []) => (await client.query(sql, params)).rows[0];

  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN (pass --execute to apply)'}`);
  console.log(`Keeping company_id = ${KEEP_COMPANY_ID}\n`);

  // Discover all tables that carry a company_id column (tenant-scoped).
  const { rows: scoped } = await client.query(`
    SELECT table_schema || '.' || table_name AS tbl
    FROM information_schema.columns
    WHERE column_name = 'company_id'
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY 1
  `);
  const tenantTables = scoped
    .map((r) => r.tbl)
    .filter((t) => !PROTECTED_TABLES.has(t) && t !== 'core.company_master');

  await client.query('BEGIN');
  try {
    let totalDeleted = 0;

    // Phase 1: wipe transactional tables completely (multi-pass for FK ordering).
    console.log('--- Phase 1: transactional data (all companies) ---');
    let pending = [...TX_TABLES];
    for (let pass = 1; pending.length && pass <= 5; pass++) {
      const retry = [];
      for (const tbl of pending) {
        await client.query(`SAVEPOINT sp`);
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

    // Phase 2: delete every tenant-scoped row belonging to companies other than KEEP_COMPANY_ID.
    console.log('\n--- Phase 2: tenant data for companies <> ' + KEEP_COMPANY_ID + ' ---');
    pending = [...tenantTables];
    for (let pass = 1; pending.length && pass <= 10; pass++) {
      const retry = [];
      for (const tbl of pending) {
        await client.query('SAVEPOINT sp');
        try {
          const res = await client.query(`DELETE FROM ${tbl} WHERE company_id <> $1`, [KEEP_COMPANY_ID]);
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
    if (pending.length) throw new Error(`Could not clear tenants from: ${pending.join(', ')}`);

    const companies = await client.query('DELETE FROM core.company_master WHERE id <> $1', [KEEP_COMPANY_ID]);
    console.log(`  core.company_master: deleted ${companies.rowCount}`);
    totalDeleted += companies.rowCount;

    // Phase 3: reset stock + document numbering for the kept company.
    console.log('\n--- Phase 3: resets for company ' + KEEP_COMPANY_ID + ' ---');
    const inv = await client.query(
      'UPDATE core.product_inventory SET qty_on_hand = 0 WHERE company_id = $1 AND qty_on_hand <> 0',
      [KEEP_COMPANY_ID],
    );
    console.log(`  product_inventory qty_on_hand reset: ${inv.rowCount} rows`);
    const seq = await client.query(
      'UPDATE core.document_sequence SET current_value = 0 WHERE company_id = $1',
      [KEEP_COMPANY_ID],
    );
    console.log(`  document_sequence reset: ${seq.rowCount} rows`);

    if (EXECUTE) {
      await client.query('COMMIT');
      console.log(`\nCOMMITTED. Total rows deleted: ${totalDeleted}`);
    } else {
      await client.query('ROLLBACK');
      console.log(`\nDRY RUN rolled back. Would delete ${totalDeleted} rows. Re-run with --execute.`);
    }

    const left = await countRow('SELECT COUNT(*)::int AS n FROM core.company_master');
    console.log(`Companies remaining (post-${EXECUTE ? 'commit' : 'rollback'}): ${left.n}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nABORTED, nothing changed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
