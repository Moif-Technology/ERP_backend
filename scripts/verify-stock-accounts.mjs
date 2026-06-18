/**
 * One-shot verification of the new stock + accounting postings.
 * Runs real service code against the local dev DB, prints assertions,
 * then deletes everything it created and restores inventory.
 *
 *   node scripts/verify-stock-accounts.mjs
 */
import { pool } from '../src/config/db.js';
import { saveBill } from '../src/pos/counter-pos/services/sales.service.js';
import { createPurchase } from '../src/backoffice/services/purchaseEntry.service.js';

const COMPANY = 1;
const BRANCH = 1;
const PRODUCT = 1;
const CUSTOMER = 1;
const SUPPLIER = 2;
const authStaff = { company_id: COMPANY, branch_id: BRANCH, staff_id: 2, staff_name: 'verify-script' };

const q = (sql, params) => pool.query(sql, params).then(r => r.rows);

async function snapshot() {
  const [inv] = await q(
    `SELECT qty_on_hand, average_cost, last_purchase_cost FROM core.product_inventory
     WHERE company_id=$1 AND branch_id=$2 AND product_id=$3`, [COMPANY, BRANCH, PRODUCT]);
  const [log] = await q(
    `SELECT COUNT(*)::int AS n, COALESCE(MAX(product_log_id),0)::bigint AS maxid
     FROM ops.product_log_entry WHERE company_id=$1`, [COMPANY]);
  const [vm] = await q(
    `SELECT COALESCE(MAX(voucher_master_id),0)::bigint AS maxid FROM accounts.voucher_master
     WHERE company_id=$1 AND branch_id=$2`, [COMPANY, BRANCH]);
  const [sm] = await q(
    `SELECT COALESCE(MAX(sales_id),0)::bigint AS maxid FROM ops.sales_master WHERE company_id=$1`, [COMPANY]);
  const [pm] = await q(
    `SELECT COALESCE(MAX(purchase_id),0)::bigint AS maxid FROM ops.purchase_master WHERE company_id=$1`, [COMPANY]);
  return { inv, logMax: Number(log.maxid), vmMax: Number(vm.maxid), smMax: Number(sm.maxid), pmMax: Number(pm.maxid) };
}

function check(label, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
}

const before = await snapshot();
const qty0 = Number(before.inv.qty_on_hand);
console.log(`Start: product ${PRODUCT} qty_on_hand=${qty0} avg=${before.inv.average_cost} last=${before.inv.last_purchase_cost}\n`);

// ── 1. Counter POS CASH sale: 2 units ──────────────────────────────
const cashBill = await saveBill(authStaff, {
  cartItems: [{ productId: PRODUCT, description: 'verify cash', qty: 2, unitPrice: 10, vatPer: 0, vatAmt: 0, lineTotal: 20, discount: 0 }],
  paymentMode: 'CASH', counterNo: 1,
  subTotal: 20, discountAmt: 0, taxableAmt: 20, taxAmt: 0, roundOff: 0, netAmount: 20,
  paidAmount: 20, balanceAmount: 0, customerId: null,
});
console.log('CASH bill saved:', cashBill.billNoDisplay, cashBill.warnings ?? '');

let [inv] = await q(`SELECT qty_on_hand FROM core.product_inventory WHERE company_id=$1 AND branch_id=$2 AND product_id=$3`, [COMPANY, BRANCH, PRODUCT]);
check('CASH sale decrements qty_on_hand by 2', Number(inv.qty_on_hand) === qty0 - 2, `now ${inv.qty_on_hand}`);

let logs = await q(`SELECT transaction_type, qty, balance_qty FROM ops.product_log_entry WHERE company_id=$1 AND product_log_id > $2 ORDER BY product_log_id`, [COMPANY, before.logMax]);
check('CASH sale wrote product_log_entry (SALES, -2)', logs.length === 1 && logs[0].transaction_type === 'SALES' && Number(logs[0].qty) === -2, JSON.stringify(logs));

let vms = await q(`SELECT voucher_master_id FROM accounts.voucher_master WHERE company_id=$1 AND branch_id=$2 AND voucher_master_id > $3`, [COMPANY, BRANCH, before.vmMax]);
check('CASH sale posts NO voucher (cash handled at counter close)', vms.length === 0, `${vms.length} vouchers`);

// ── 2. Counter POS CREDIT sale: 3 units, customer ──────────────────
const credBill = await saveBill(authStaff, {
  cartItems: [{ productId: PRODUCT, description: 'verify credit', qty: 3, unitPrice: 10, vatPer: 0, vatAmt: 0, lineTotal: 30, discount: 0 }],
  paymentMode: 'CREDIT', counterNo: 1,
  subTotal: 30, discountAmt: 0, taxableAmt: 30, taxAmt: 0, roundOff: 0, netAmount: 30,
  paidAmount: 0, balanceAmount: -30, customerId: CUSTOMER,
});
console.log('CREDIT bill saved:', credBill.billNoDisplay, credBill.warnings ?? '');

[inv] = await q(`SELECT qty_on_hand FROM core.product_inventory WHERE company_id=$1 AND branch_id=$2 AND product_id=$3`, [COMPANY, BRANCH, PRODUCT]);
check('CREDIT sale decrements qty_on_hand by 3 more', Number(inv.qty_on_hand) === qty0 - 5, `now ${inv.qty_on_hand}`);

vms = await q(
  `SELECT vm.voucher_master_id, vm.voucher_amount, vm.remarks,
          (SELECT json_agg(json_build_object('acc', vd.account_id, 'dr', vd.debit_amount, 'cr', vd.credit_amount, 'os', vd.outstanding_balance))
           FROM accounts.voucher_detail vd
           WHERE vd.company_id = vm.company_id AND vd.branch_id = vm.branch_id AND vd.voucher_master_id = vm.voucher_master_id) AS details
   FROM accounts.voucher_master vm
   WHERE vm.company_id=$1 AND vm.branch_id=$2 AND vm.voucher_master_id > $3`, [COMPANY, BRANCH, before.vmMax]);
check('CREDIT sale posts exactly one voucher', vms.length === 1, JSON.stringify(vms.map(v => v.remarks)));
if (vms.length === 1) {
  const d = vms[0].details || [];
  const dr = d.reduce((s, x) => s + Number(x.dr), 0);
  const cr = d.reduce((s, x) => s + Number(x.cr), 0);
  check('Voucher balanced DR=CR=30', dr === 30 && cr === 30, JSON.stringify(d));
}

// ── 3. Purchase: 5 units @ 7.00, CREDIT ─────────────────────────────
const vmMax2 = (await q(`SELECT COALESCE(MAX(voucher_master_id),0)::bigint AS m FROM accounts.voucher_master WHERE company_id=$1 AND branch_id=$2`, [COMPANY, BRANCH]))[0].m;
const purchase = await createPurchase(pool, {
  branchId: BRANCH, supplierId: SUPPLIER, paymentMode: 'CREDIT',
  netAmount: 35,
  invoiceAmount: 35,
  lines: [{ productId: PRODUCT, qty: 5, unitCost: 7, subTotal: 35, vatAmt: 0, vatPct: 0, total: 35 }],
}, authStaff);
console.log('Purchase saved:', purchase.purchaseNo, purchase.warnings ?? '');

[inv] = await q(`SELECT qty_on_hand, average_cost, last_purchase_cost FROM core.product_inventory WHERE company_id=$1 AND branch_id=$2 AND product_id=$3`, [COMPANY, BRANCH, PRODUCT]);
check('Purchase increments qty_on_hand by 5', Number(inv.qty_on_hand) === qty0 - 5 + 5, `now ${inv.qty_on_hand}`);
check('last_purchase_cost updated to 7', Number(inv.last_purchase_cost) === 7, `now ${inv.last_purchase_cost}`);
console.log(`average_cost now ${inv.average_cost} (was ${before.inv.average_cost})`);

const pvms = await q(
  `SELECT vm.voucher_master_id, vm.remarks,
          (SELECT json_agg(json_build_object('acc', vd.account_id, 'dr', vd.debit_amount, 'cr', vd.credit_amount, 'os', vd.outstanding_balance))
           FROM accounts.voucher_detail vd
           WHERE vd.company_id = vm.company_id AND vd.branch_id = vm.branch_id AND vd.voucher_master_id = vm.voucher_master_id) AS details
   FROM accounts.voucher_master vm
   WHERE vm.company_id=$1 AND vm.branch_id=$2 AND vm.voucher_master_id > $3`, [COMPANY, BRANCH, vmMax2]);
check('Purchase posts one voucher', pvms.length === 1, JSON.stringify(pvms.map(v => v.remarks)));
if (pvms.length === 1) {
  const d = pvms[0].details || [];
  const dr = d.reduce((s, x) => s + Number(x.dr), 0);
  const cr = d.reduce((s, x) => s + Number(x.cr), 0);
  check('Purchase voucher balanced DR=CR=35', dr === 35 && cr === 35, JSON.stringify(d));
}

// ── Cleanup ─────────────────────────────────────────────────────────
console.log('\nCleaning up test rows…');
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`DELETE FROM ops.sales_payment_split WHERE company_id=$1 AND sales_id > $2`, [COMPANY, before.smMax]);
  await client.query(`DELETE FROM ops.sales_child WHERE company_id=$1 AND sales_id > $2`, [COMPANY, before.smMax]);
  await client.query(`DELETE FROM ops.sales_master WHERE company_id=$1 AND sales_id > $2`, [COMPANY, before.smMax]);
  await client.query(`DELETE FROM ops.purchase_child WHERE company_id=$1 AND purchase_id > $2`, [COMPANY, before.pmMax]);
  await client.query(`DELETE FROM ops.purchase_master WHERE company_id=$1 AND purchase_id > $2`, [COMPANY, before.pmMax]);
  await client.query(`DELETE FROM ops.product_log_entry WHERE company_id=$1 AND product_log_id > $2`, [COMPANY, before.logMax]);
  await client.query(
    `DELETE FROM accounts.voucher_detail WHERE company_id=$1 AND branch_id=$2 AND voucher_master_id > $3`,
    [COMPANY, BRANCH, before.vmMax]);
  await client.query(
    `DELETE FROM accounts.voucher_master WHERE company_id=$1 AND branch_id=$2 AND voucher_master_id > $3`,
    [COMPANY, BRANCH, before.vmMax]);
  await client.query(
    `UPDATE core.product_inventory SET qty_on_hand=$4, average_cost=$5, last_purchase_cost=$6
     WHERE company_id=$1 AND branch_id=$2 AND product_id=$3`,
    [COMPANY, BRANCH, PRODUCT, before.inv.qty_on_hand, before.inv.average_cost, before.inv.last_purchase_cost]);
  await client.query('COMMIT');
  console.log('Cleanup done — DB restored.');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('CLEANUP FAILED:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
}

await pool.end();
