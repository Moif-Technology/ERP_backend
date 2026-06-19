import assert from 'node:assert/strict';
import { reconcileBillsWithLedger } from '../src/pos/counter-pos/repositories/settlement.repository.js';
import { resolveSalesOutstandingBalance } from '../src/pos/counter-pos/repositories/sales.repository.js';

// Ledger > bills → Opening / Other
{
  const bills = [
    { billId: 1, currentAmount: 12.15, invoiceNo: '1' },
    { billId: 2, currentAmount: 10, invoiceNo: '2' },
  ];
  const out = reconcileBillsWithLedger(bills, 50, 3);
  const sum = out.reduce((s, b) => s + b.currentAmount, 0);
  assert.equal(out[0].invoiceNo, 'Opening / Other');
  assert.ok(Math.abs(sum - 50) < 0.01);
}

// Ledger < bills → trim newest
{
  const bills = [
    { billId: 1, currentAmount: 12.15, invoiceNo: '1' },
    { billId: 2, currentAmount: 10, invoiceNo: '2' },
    { billId: 3, currentAmount: 10, invoiceNo: '3' },
    { billId: 4, currentAmount: 10, invoiceNo: '4' },
    { billId: 5, currentAmount: 20, invoiceNo: '5' },
  ];
  const out = reconcileBillsWithLedger(bills, 50, 3);
  const sum = out.reduce((s, b) => s + b.currentAmount, 0);
  assert.ok(Math.abs(sum - 50) < 0.01);
  const b5 = out.find(b => b.billId === 5);
  assert.ok(!b5 || b5.currentAmount < 20, 'newest bill reduced when bills exceed ledger');
}

// Ledger 0 → no bills
{
  const out = reconcileBillsWithLedger([{ billId: 1, currentAmount: 10 }], 0, 1);
  assert.equal(out.length, 0);
}

// Cash / card O/S = 0
assert.equal(resolveSalesOutstandingBalance({ paymentMode: 'CASH', netAmount: 100 }), 0);
assert.equal(resolveSalesOutstandingBalance({ paymentMode: 'CREDITCARD', netAmount: 100 }), 0);
assert.equal(resolveSalesOutstandingBalance({ paymentMode: 'CREDIT', netAmount: 100 }), 100);
assert.equal(resolveSalesOutstandingBalance({
  paymentMode: 'MULTIPAYMENT', netAmount: 100, creditAmount: 30,
}), 30);

console.log('settlement.reconcile.test.mjs — all passed');
