import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(__dirname, '../src/backoffice/services/customerReceipt.service.js');
const outPath = path.join(__dirname, '../src/backoffice/services/supplierPayment.service.js');
let s = fs.readFileSync(srcPath, 'utf8');

s = s.replace(
  "import * as customerRepo from '../../pos/counter-pos/repositories/customer.repository.js';",
  "import * as supplierPaymentRepo from '../repositories/supplierPayment.repository.js';",
);
s = s.replace(
  "import { ensureCustomerLedgerForId } from './partyLedger.service.js';",
  "import { ensureSupplierLedgerForId } from './partyLedger.service.js';",
);
s = s.replace(
  "import { getCustomerOutstandingBills } from '../../pos/counter-pos/services/settlement.service.js';\n",
  '',
);

s = s.replace(/mapReceiptStatusFields/g, 'mapPaymentStatusFields');
s = s.replace(/function mapPaymentStatusFields\(receipt\)/, 'function mapPaymentStatusFields(payment)');
s = s.replace(/receiptStatus/g, 'paymentStatus');
s = s.replace(/mapReceiptResponse/g, 'mapPaymentResponse');
s = s.replace(/loadReceiptAllocations/g, 'loadPaymentAllocations');
s = s.replace(/assertReceiptEditable/g, 'assertPaymentEditable');
s = s.replace(/persistReceiptChildren/g, 'persistPaymentChildren');
s = s.replace(/insertCustomerReceiptVoucher/g, 'insertSupplierPaymentVoucher');
s = s.replace(/customer_receipt_voucher/g, 'supplier_payment_voucher');

const voucherFn = `async function insertSupplierPaymentVoucher(client, args) {
  const {
    companyId, branchId, transactionId, supplierLedgerId, paymentLines,
    amount, staffId, supplierCode, paymentDate, remarks, referenceNo,
    postStatus = 'PENDING', voucherMasterId: existingVoucherMasterId,
  } = args;

  const voucherTypeId =
    (await voucherRepo.getVoucherTypeId(client, companyId, 'PaymentVoucherNameSupplier', branchId)) ?? 4;
  const voucherPrefix =
    (await voucherRepo.getVoucherPrefix(client, companyId, voucherTypeId)) || 'PAY';

  const voucherMasterId = existingVoucherMasterId
    ?? await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
  const auditBy = String(staffId ?? 'BACKOFFICE').slice(0, 50);
  const ref = referenceNo ? String(referenceNo).trim().slice(0, 100) : \`PMT-\${transactionId}\`;
  const detailPostStatus = postStatus;

  if (!existingVoucherMasterId) {
    await voucherRepo.insertVoucherMaster(client, {
      companyId,
      branchId,
      voucherMasterId,
      voucherTypeId,
      autoVoucherNo: transactionId,
      manualVoucherNo: ref,
      voucherPrefix,
      voucherDate: paymentDate || new Date(),
      referenceNo: ref,
      voucherAmount: amount,
      remarks: remarks || \`Supplier payment \${supplierCode} \${ref}\`,
      postStatus,
      creationMode: 'BACKOFFICE',
      voucherPostedId: transactionId,
      counterCloseNo: 0,
      recordStatus: 'ACTIVE',
      createdBy: auditBy,
    });
  } else {
    await voucherRepo.updateVoucherMaster(client, companyId, branchId, voucherMasterId, {
      voucherDate: paymentDate || new Date(),
      referenceNo: ref,
      voucherAmount: amount,
      remarks: remarks || \`Supplier payment \${supplierCode} \${ref}\`,
    });
    await voucherRepo.deleteVoucherDetails(client, companyId, branchId, voucherMasterId);
  }

  let detailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);

  await voucherRepo.insertVoucherDetail(client, {
    companyId,
    branchId,
    voucherDetailId: detailSeq++,
    voucherMasterId,
    accountId: supplierLedgerId,
    debitAmount: amount,
    creditAmount: 0,
    outstandingBalance: 0,
    narration: ref,
    postStatus: detailPostStatus,
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  for (const line of paymentLines) {
    await voucherRepo.insertVoucherDetail(client, {
      companyId,
      branchId,
      voucherDetailId: detailSeq++,
      voucherMasterId,
      accountId: line.ledgerId,
      debitAmount: 0,
      creditAmount: line.amount,
      outstandingBalance: 0,
      narration: line.narration || ref,
      postStatus: detailPostStatus,
      recordStatus: 'ACTIVE',
      createdBy: auditBy,
    });
  }

  return voucherMasterId;
}`;

s = s.replace(/async function insertSupplierPaymentVoucher\(client, args\) \{[\s\S]*?return voucherMasterId;\n\}/, voucherFn);

const applyFn = `async function applyBillAllocations(client, companyId, branchId, allocations, supplierLedgerId, postDatedCheque) {
  if (postDatedCheque) return;
  for (const a of allocations) {
    if (a.billId > 0) {
      await supplierPaymentRepo.updatePurchaseOutstanding(client, companyId, a.billId, branchId, a.balance);
      await supplierPaymentRepo.reducePurchaseBillOutstanding(
        client, companyId, branchId, a.billId, supplierLedgerId, a.paidAmount,
      );
    }
  }
}`;

const reverseFn = `async function reverseBillAllocations(client, companyId, branchId, allocations, supplierLedgerId, postDatedCheque) {
  if (postDatedCheque) return;
  for (const a of allocations) {
    if (a.billId > 0) {
      const currentOs = await supplierPaymentRepo.getPurchaseOutstandingBalance(client, companyId, a.billId, branchId);
      await supplierPaymentRepo.updatePurchaseOutstanding(
        client, companyId, a.billId, branchId, round3(currentOs + a.paidAmount),
      );
      await supplierPaymentRepo.restorePurchaseBillOutstanding(
        client, companyId, branchId, a.billId, supplierLedgerId, a.paidAmount,
      );
    }
  }
}`;

s = s.replace(/async function applyBillAllocations\(client, companyId, allocations, customerLedgerId, postDatedCheque\) \{[\s\S]*?\n\}/, applyFn);
s = s.replace(/async function reverseBillAllocations\(client, companyId, allocations, customerLedgerId, postDatedCheque\) \{[\s\S]*?\n\}/, reverseFn);

s = s.replace(/Receipt amount must be greater than zero/g, 'Payment amount must be greater than zero');

const exports = [
  ['listCustomerReceiptOutstanding', 'listSupplierPaymentOutstanding'],
  ['getCustomerReceiptByVoucher', 'getSupplierPaymentByVoucher'],
  ['getCustomerReceipt', 'getSupplierPayment'],
  ['saveCustomerReceipt', 'saveSupplierPayment'],
  ['updateCustomerReceipt', 'updateSupplierPayment'],
  ['postCustomerReceipt', 'postSupplierPayment'],
  ['unpostCustomerReceipt', 'unpostSupplierPayment'],
  ['clearPdcCustomerReceipt', 'clearPdcSupplierPayment'],
  ['reconcileBankCustomerReceipt', 'reconcileBankSupplierPayment'],
];
for (const [a, b] of exports) s = s.replaceAll(a, b);

s = s.replace(/getSettlementReceipt/g, 'supplierPaymentRepo.getSettlementPayment');
s = s.replace(/getCustomerById/g, 'supplierPaymentRepo.getSupplierById');
s = s.replace(/customerRepo\.getCustomerOsBalance/g, 'supplierPaymentRepo.getSupplierOsBalance');
s = s.replace(/ensureCustomerLedgerForId/g, 'ensureSupplierLedgerForId');
s = s.replace(/syncCustomerCreditState/g, 'supplierPaymentRepo.syncSupplierPayableState');
s = s.replace(/settlementRepo\.getOutstandingBills/g, 'supplierPaymentRepo.getOutstandingPurchaseBills');
s = s.replace(/settlementRepo\.assertPostedBillAllocations/g, 'supplierPaymentRepo.assertPostedPurchaseAllocations');
s = s.replace(/settlementRepo\.reconcilePostedBills/g, 'supplierPaymentRepo.reconcilePostedBills');
s = s.replace(/settlementRepo\.insertCashTransactionMaster/g, 'supplierPaymentRepo.insertSupplierPaymentMaster');

s = s.replace(/body\.customerId/g, 'body.supplierId');
s = s.replace(/Number\(customerId\)/g, 'Number(supplierId)');
s = s.replace(/const customerId =/g, 'const supplierId =');
s = s.replace(/customerId,/g, 'supplierId,');
s = s.replace(/customerId\)/g, 'supplierId)');
s = s.replace(/customerId;/g, 'supplierId;');
s = s.replace(/customerId =/g, 'supplierId =');
s = s.replace(/customerLedgerId/g, 'supplierLedgerId');
s = s.replace(/const customer =/g, 'const supplier =');
s = s.replace(/customer\./g, 'supplier.');
s = s.replace(/customer,/g, 'supplier,');
s = s.replace(/customer\)/g, 'supplier)');
s = s.replace(/Customer is required/g, 'Supplier is required');
s = s.replace(/Customer not found/g, 'Supplier not found');
s = s.replace(/Customer receipt/g, 'Supplier payment');
s = s.replace(/customer receipt/g, 'supplier payment');
s = s.replace(/Receipt not found/g, 'Payment not found');
s = s.replace(/Receipt is posted/g, 'Payment is posted');
s = s.replace(/Receipt is already posted/g, 'Payment is already posted');
s = s.replace(/Receipt is not posted/g, 'Payment is not posted');
s = s.replace(/Receipt must be posted/g, 'Payment must be posted');
s = s.replace(/Receipt is not pending PDC clearance/g, 'Payment is not pending PDC clearance');
s = s.replace(/Receipt is already bank-reconciled/g, 'Payment is already bank-reconciled');
s = s.replace(/Bank-reconciled receipt/g, 'Bank-reconciled payment');
s = s.replace(/PDC receipt posted/g, 'PDC payment posted');
s = s.replace(/Bank reconciliation applies to PDC receipts only/g, 'Bank reconciliation applies to PDC payments only');
s = s.replace(/receiptStatus/g, 'paymentStatus');
s = s.replace(/receiptDate/g, 'paymentDate');
s = s.replace(/receiptNo/g, 'paymentNo');
s = s.replace(/'RCV'/g, "'PAY'");
s = s.replace(/ReceiptVoucherNameCustomer/g, 'PaymentVoucherNameSupplier');
s = s.replace(/\?\? 9/g, '?? 4');
s = s.replace(/CUSTOMER RECEIPT/g, 'SUPPLIER PAYMENT');
s = s.replace(/receivable ledger/g, 'payable ledger');
s = s.replace(/post the sale first/g, 'post the purchase first');
s = s.replace(/customer outstanding/g, 'supplier outstanding');
s = s.replace(/for this customer/g, 'for this supplier');
s = s.replace(/RCT-/g, 'PMT-');
s = s.replace(/customerCode:/g, 'supplierCode:');
s = s.replace(/customerName:/g, 'supplierName:');
s = s.replace(/customerCode,/g, 'supplierCode,');
s = s.replace(/this customer/g, 'this supplier');

// get payment lines from credit side (bank)
s = s.replace(
  `.filter((d) => num(d.debit_amount) > 0)
      .map((d) => ({
        ledgerId: Number(d.account_id),
        amount: num(d.debit_amount),`,
  `.filter((d) => num(d.credit_amount) > 0)
      .map((d) => ({
        ledgerId: Number(d.account_id),
        amount: num(d.credit_amount),`,
);

// list outstanding wrapper
s = s.replace(
  /export async function listSupplierPaymentOutstanding\(authStaff, customerId, query = \{\}\) \{[\s\S]*?\n\}/,
  `export async function listSupplierPaymentOutstanding(authStaff, supplierId, query = {}) {
  const companyId = Number(authStaff.company_id);
  const sid = Number(supplierId);
  if (!Number.isFinite(sid) || sid < 1) {
    const err = new Error('Invalid supplier');
    err.status = 400;
    throw err;
  }

  const supplier = await supplierPaymentRepo.getSupplierById(pool, companyId, sid);
  if (!supplier) {
    const err = new Error('Supplier not found');
    err.status = 404;
    throw err;
  }

  const ledgerOs = await supplierPaymentRepo.getSupplierOsBalance(pool, companyId, sid, { postedOnly: true });
  const rawBills = await supplierPaymentRepo.getOutstandingPurchaseBills(pool, companyId, sid);
  const bills = supplierPaymentRepo.reconcilePostedBills(rawBills);
  const billsSum = bills.reduce((sum, b) => sum + num(b.currentAmount), 0);

  return {
    supplierId: sid,
    supplierCode: supplier.supplier_code,
    supplierName: supplier.supplier_name,
    ledgerOs,
    billsTotal: billsSum,
    billsSum,
    osAmount: billsSum > 0.005 ? billsSum : Math.max(ledgerOs, 0),
    bills,
  };
}`,
);

// get by voucher - filter supplier payments
s = s.replace(
  /const row = await settlementRepo\.getCashTransactionByVoucherMasterId\(pool, companyId, voucherMasterId\);/,
  `const row = await settlementRepo.getCashTransactionByVoucherMasterId(pool, companyId, voucherMasterId);
  if (row && row.supplier_id == null && row.customer_id != null) {
    const err = new Error('Supplier payment not found for this voucher');
    err.status = 404;
    throw err;
  }`,
);

// applyBillAllocations calls need branchId
s = s.replace(
  /await applyBillAllocations\(client, companyId, allocations, supplierLedgerId,/g,
  'await applyBillAllocations(client, companyId, branchId, allocations, supplierLedgerId,',
);
s = s.replace(
  /await reverseBillAllocations\(client, companyId, allocations, supplierLedgerId,/g,
  'await reverseBillAllocations(client, companyId, branchId, allocations, supplierLedgerId,',
);

// persistPaymentChildren arg rename
s = s.replace(/allocations, supplierLedgerId, postDatedCheque/g, 'allocations, supplierLedgerId, postDatedCheque');

// insert master row uses supplierId not customerId
s = s.replace(/supplierId,\n      amount:/g, 'supplierId,\n      amount:');

// fix mapPaymentStatusFields parameter references
s = s.replace(/String\(payment\.status/g, 'String(payment.status');
s = s.replace(/Boolean\(payment\.postDatedCheque\)/g, 'Boolean(payment.postDatedCheque)');
s = s.replace(/payment\.paymentMode/g, 'payment.paymentMode');
s = s.replace(/isPdcPendingStatus\(paymentStatus\)/g, 'isPdcPendingStatus(paymentStatus)');
s = s.replace(/parseBankReconFromRemarks\(payment\.remarks\)/g, 'parseBankReconFromRemarks(payment.remarks)');

// getSupplierPayment response fields
s = s.replace(/payment\.supplierId/g, 'payment.supplierId');
s = s.replace(/payment\.supplierCode/g, 'payment.supplierCode');
s = s.replace(/payment\.supplierName/g, 'payment.supplierName');

s = s.replace(/supplierPaymentRepo\.supplierPaymentRepo\./g, 'supplierPaymentRepo.');

fs.writeFileSync(outPath, s);
console.log('Wrote', outPath);
