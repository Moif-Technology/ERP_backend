import * as voucherRepo from '../../accounts/repositories/voucher.repository.js';

function num(v, d = 0) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export async function resolvePurchasePaymentVoucherTypeIds(clientOrPool, companyId, branchId) {
  const purchaseVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(clientOrPool, companyId, 'PurchaseEntryVoucherName', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(clientOrPool, companyId, 'PUR'))
    || 6;
  const paymentVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(clientOrPool, companyId, 'PaymentVoucherNameSupplier', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(clientOrPool, companyId, 'PAY'))
    || 4;
  return { purchaseVoucherTypeId, paymentVoucherTypeId };
}

export function isInventoryPurchasePaymentVoucher(voucherMaster, paymentVoucherTypeId) {
  if (!voucherMaster) return false;
  if (String(voucherMaster.creation_mode || '') !== 'INVENTORYACCOUNTS') return false;
  if (Number(voucherMaster.voucher_type_id) !== Number(paymentVoucherTypeId)) return false;
  const purchaseId = Number(voucherMaster.voucher_posted_id);
  return Number.isFinite(purchaseId) && purchaseId >= 1;
}

export async function increasePurchaseSupplierOutstanding(client, companyId, purchaseId, supplierLedgerId, increaseBy, purchaseVoucherTypeId) {
  await client.query(
    `UPDATE accounts.voucher_detail vd
     SET outstanding_balance = LEAST(
           COALESCE(vd.credit_amount, 0),
           COALESCE(vd.outstanding_balance, 0) + $4
         ),
         modified_at = NOW()
     FROM accounts.voucher_master vm
     WHERE vd.company_id = $1
       AND vd.voucher_master_id = vm.voucher_master_id
       AND vm.company_id = $1
       AND vm.voucher_posted_id = $2
       AND vm.voucher_type_id = $5
       AND vm.creation_mode = 'INVENTORYACCOUNTS'
       AND vm.record_status = 'ACTIVE'
       AND vd.account_id = $3
       AND vd.credit_amount > 0`,
    [companyId, purchaseId, supplierLedgerId, increaseBy, purchaseVoucherTypeId],
  );
}

/**
 * When a supplier payment voucher (from purchase Pay now) is removed or unposted,
 * restore outstanding on the purchase invoice and purchase voucher supplier line.
 */
export async function restorePurchaseOutstandingFromPaymentRemoval(client, companyId, branchId, voucherMaster, voucherDetails) {
  const purchaseId = Math.trunc(num(voucherMaster.voucher_posted_id, 0));
  if (purchaseId < 1) return { restored: false };

  const payAmount = round2(num(voucherMaster.voucher_amount, 0));
  if (payAmount <= 0) return { restored: false };

  const supplierLine = (voucherDetails || []).find((d) => num(d.debit_amount, 0) > 0);
  if (!supplierLine) return { restored: false };

  const supplierLedgerId = Number(supplierLine.account_id);
  const { purchaseVoucherTypeId } = await resolvePurchasePaymentVoucherTypeIds(client, companyId, branchId);

  const { rows } = await client.query(
    `SELECT invoice_amount, outstanding_balance
     FROM ops.purchase_master
     WHERE company_id = $1 AND purchase_id = $2 AND branch_id = $3
     LIMIT 1`,
    [companyId, purchaseId, branchId],
  );
  const pur = rows[0];
  if (!pur) return { restored: false };

  const invoiceAmount = round2(num(pur.invoice_amount, 0));
  const currentOs = round2(num(pur.outstanding_balance, 0));
  if (currentOs >= invoiceAmount - 0.005) {
    return { restored: false, reason: 'already_outstanding' };
  }

  const newOs = round2(Math.min(invoiceAmount, currentOs + payAmount));
  await client.query(
    `UPDATE ops.purchase_master
     SET outstanding_balance = $4, modified_at = NOW()
     WHERE company_id = $1 AND purchase_id = $2 AND branch_id = $3`,
    [companyId, purchaseId, branchId, newOs],
  );

  await increasePurchaseSupplierOutstanding(
    client, companyId, purchaseId, supplierLedgerId, payAmount, purchaseVoucherTypeId,
  );

  return { restored: true, purchaseId, outstandingBalance: newOs };
}

export async function tryRestorePurchaseOutstandingForVoucher(client, companyId, branchId, voucherMaster, voucherDetails) {
  const { paymentVoucherTypeId } = await resolvePurchasePaymentVoucherTypeIds(client, companyId, branchId);
  if (!isInventoryPurchasePaymentVoucher(voucherMaster, paymentVoucherTypeId)) {
    return { restored: false };
  }
  if (String(voucherMaster.post_status || '') !== 'POSTED') {
    return { restored: false };
  }
  return restorePurchaseOutstandingFromPaymentRemoval(
    client, companyId, branchId, voucherMaster, voucherDetails,
  );
}
