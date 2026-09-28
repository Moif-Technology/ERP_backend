import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/db.js';
import { verify } from '../src/pos/restaurant-pos/controllers/supervisor.controller.js';
import { getSummary, closeCounter } from '../src/pos/restaurant-pos/services/counter.service.js';
import { listSalesViewer, getSalesViewerBill } from '../src/pos/restaurant-pos/services/sales.service.js';
import { markSalesAsClosed, markSplitsAsClosed } from '../src/pos/restaurant-pos/repositories/counter.repository.js';

const staff = { id: 7, staff_id: 70, company_id: 3, branch_id: 2, station_id: 4 };
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

test('restaurant approvals preserve Quick roles and accept chief cashiers without crossing companies', async (t) => {
  let row = { id: 8, staff_id: 80, company_id: 3, record_status: 'ACTIVE',
    role_id: 5, role_name: 'Supervisor', designation: '', password_hash: 'hash' };
  t.mock.method(pool, 'query', async () => ({ rows: [row] }));
  t.mock.method(bcrypt, 'compare', async (password) => password === 'correct');
  for (const role of ['Supervisor', 'CHIEF CASHIER']) {
    row = { ...row, role_name: role, designation: role };
    const res = response();
    await verify({ authStaff: staff, body: { username: 'approver', password: 'correct' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.IsAdmin, 1);
    assert.equal(res.body.staffPk, 8);
  }
  for (const change of [{ password: 'wrong' }, { company_id: 99 }, { role_name: 'Cashier', designation: 'Cashier' }]) {
    const previous = row;
    row = { ...row, ...change };
    const res = response();
    await verify({ authStaff: staff, body: { username: 'approver', password: change.password ?? 'correct' } }, res);
    assert.ok(res.statusCode >= 400);
    assert.equal(res.body.IsAdmin, 0);
    row = previous;
  }
});

test('Quick supervisor PIN approval remains available', async (t) => {
  t.mock.method(pool, 'query', async () => ({ rows: [{ id: 8, staff_id: 80, role_id: 1, staff_pin: 'hash' }] }));
  t.mock.method(bcrypt, 'compare', async (pin) => pin === '1234');
  const res = response();
  await verify({ authStaff: staff, body: { pin: '1234' } }, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.IsAdmin, 1);
});

test('counter reading preserves cashier default, all-staff option, cash tips and read-only X reports', async () => {
  const contexts = [];
  const fake = { query: async (sql, params) => {
    assert.doesNotMatch(sql, /^\s*(INSERT|UPDATE|DELETE)/i);
    if (sql.includes('WITH sm AS')) {
      contexts.push(params);
      return { rows: [{ total_cash: 100, total_cash_tip: 5, bill_count: 1 }] };
    }
    if (sql.includes('SELECT id, transaction_type')) {
      return { rows: [{ id: 1, transaction_type: 'CASH_IN', amount: 10 }] };
    }
    return { rows: [] };
  } };
  const own = await getSummary(fake, staff, { counterNo: 1 });
  assert.equal(own.allStaff, false);
  assert.deepEqual(contexts[0], [3, 4, [7, 70]]);
  assert.equal(own.cashToBeCollected, 105);
  assert.equal(own.cashInOutList[0].amount, 10);
  const all = await getSummary(fake, staff, { counterNo: 1, allStaff: true });
  assert.equal(all.allStaff, true);
  assert.equal(contexts[1][2], null);
  const x = await closeCounter(fake, staff, { counterNo: 1, reportType: 'X', collectedCash: 105 });
  assert.equal(x.reportType, 'X');
  assert.equal(x.cashDifference, 0);
});

test('Z close stamps pending bills and restricts split updates to those closed bills', async () => {
  const queries = [];
  const client = { query: async (sql, params) => { queries.push({ sql, params }); return { rowCount: 2 }; } };
  const context = { companyId: 3, stationId: 4, staffIds: [7, 70], closeNo: 'S1-2' };
  assert.equal(await markSalesAsClosed(client, context), 2);
  await markSplitsAsClosed(client, context);
  assert.deepEqual(queries[0].params, ['S1-2', 3, 4, [7, 70]]);
  assert.match(queries[0].sql, /SET counter_close_status = \$1/);
  assert.match(queries[0].sql, /'PENDING'/);
  const split = queries.find(({ sql }) => sql.includes('UPDATE ops.sales_payment_split'));
  assert.match(split.sql, /sm.counter_close_status = \$1/);
});

test('sales viewer combines restaurant filters and Quick bill fields', async () => {
  const fake = { query: async (sql, params) => {
    assert.ok(params.includes(4));
    assert.ok(params.includes('CARD'));
    assert.equal(params.at(-1), 20);
    return { rows: [{ sales_id: 10, bill_no: 2, subtotal_amount: 100, amount: 105,
      customer_id: 5, customer_code: 'C5', customer_name: 'Customer', counter_close_status: 'S1-2' }] };
  } };
  const { bills } = await listSalesViewer(fake, { dateFrom: '2026-09-01', dateTo: '2026-09-30', paymentMode: 'CARD', limit: 20 }, staff);
  assert.equal(bills[0].amount, 105);
  assert.equal(bills[0].Amount, 100);
  assert.equal(bills[0].Total, 105);
  assert.equal(bills[0].customerCode, 'C5');
  assert.equal(bills[0].counterCloseNo, 'S1-2');
});

test('bill detail retains customer, receipt, split-payment and restaurant item data', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM ops.sales_master sm')) return { rows: [{
      sales_id: 10, bill_no: 2, customer_name: 'Customer', customer_id: 5,
      amount: 105, subtotal_amount: 100, tax_1_amount: 5, payment_mode: 'CASH', waiter_name: 'Waiter',
    }] };
    if (sql.includes('FROM ops.sales_child')) return { rows: [{
      sales_child_id: 1, product_id: 2, product_code: 'P2', short_description: 'Meal',
      modifier: 'No salt', qty: 1, unit_price: 100, tax_1_amount: 5, line_total: 105,
    }] };
    if (sql.includes('FROM ops.sales_payment_split')) return { rows: [{ pay_mode: 'CASH', bill_amount: 105 }] };
    return { rows: [] };
  });
  const bill = await getSalesViewerBill(pool, 10, {}, staff);
  assert.equal(bill.customer.customerName, 'Customer');
  assert.equal(bill.customerName, 'Customer');
  assert.equal(bill.taxAmt, 5);
  assert.equal(bill.tax1Amount, 5);
  assert.equal(bill.waiterName, 'Waiter');
  assert.equal(bill.paymentSplits[0].amount, 105);
  assert.equal(bill.items[0].BarCode, 'P2');
  assert.equal(bill.items[0].description, 'Meal');
  assert.equal(bill.items[0].ShortDescription, 'Meal');
  assert.equal(bill.items[0].modifier, 'No salt');
});
