/**
 * Resolve branch integration ledgers for purchase / sales voucher posting.
 */
import * as accountsParameterRepo from '../repositories/accountsParameter.repository.js';

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export async function getIntegrationAccountId(client, companyId, branchId, paramName) {
  return accountsParameterRepo.getParameterAccountId(client, companyId, branchId, paramName);
}

export async function resolvePurchaseDrLedger(client, companyId, branchId, paymentMode, { taxable = true } = {}) {
  if (!taxable) {
    return getIntegrationAccountId(client, companyId, branchId, 'PurchaseEntryDRLedgerExempted');
  }
  const mode = String(paymentMode || 'CASH').toUpperCase();
  let param = 'PurchaseEntryDRLedgerCash';
  if (mode.includes('CREDIT') && !mode.includes('CARD')) param = 'PurchaseEntryDRLedgerCredit';
  else if (mode.includes('OVERSEAS')) param = 'PurchaseEntryDRLedgerOverseas';
  return getIntegrationAccountId(client, companyId, branchId, param);
}

export async function resolvePurchaseCrLedger(client, companyId, branchId, paymentMode, { taxable = true } = {}) {
  if (!taxable) {
    let exId = await getIntegrationAccountId(client, companyId, branchId, 'PurchaseReturnCRLedgerExempted');
    if (exId) return exId;
    return resolvePurchaseDrLedger(client, companyId, branchId, paymentMode, { taxable: false });
  }
  const mode = String(paymentMode || 'CASH').toUpperCase();
  let param = 'PurchaseReturnCRLedgerCash';
  if (mode.includes('CREDIT') && !mode.includes('CARD')) param = 'PurchaseReturnCRLedgerCredit';
  else if (mode.includes('OVERSEAS')) param = 'PurchaseReturnCRLedgerOverseas';
  const id = await getIntegrationAccountId(client, companyId, branchId, param);
  if (id) return id;
  return resolvePurchaseDrLedger(client, companyId, branchId, paymentMode, { taxable: true });
}

export async function resolvePurchaseReturnDiscountLedger(client, companyId, branchId) {
  const id = await getIntegrationAccountId(client, companyId, branchId, 'PurchaseReturnCRDiscountLedger');
  if (id) return id;
  return resolveDiscountLedger(client, companyId, branchId, 'purchase');
}

export async function resolvePurchaseReturnRoundingLedger(client, companyId, branchId) {
  const id = await getIntegrationAccountId(client, companyId, branchId, 'PurchaseReturnCRRoundingLedger');
  if (id) return id;
  return resolveRoundingLedger(client, companyId, branchId, 'purchase');
}

export async function resolveSalesReturnCrLedger(client, companyId, branchId, paymentMode, { taxable = true } = {}) {
  if (!taxable) {
    let exId = await getIntegrationAccountId(client, companyId, branchId, 'SalesReturnCRLedgerExempted');
    if (exId) return exId;
    return resolveBoSalesCrExemptLedger(client, companyId, branchId);
  }
  const mode = String(paymentMode || 'CASH').toUpperCase();
  let param = 'SalesReturnCRLedgerCash';
  if (mode.includes('CARD')) param = 'SalesReturnCRLedgerCreditCard';
  else if (mode.includes('CREDIT') && !mode.includes('CARD')) param = 'SalesReturnCRLedgerCredit';
  else if (mode.includes('OVERSEAS')) param = 'SalesReturnCRLedgerOverseas';
  const id = await getIntegrationAccountId(client, companyId, branchId, param);
  if (id) return id;
  return resolveBoSalesCrLedger(client, companyId, branchId, paymentMode);
}

export async function resolveSalesReturnDiscountLedger(client, companyId, branchId) {
  const id = await getIntegrationAccountId(client, companyId, branchId, 'SalesReturnCRDiscountLedger');
  if (id) return id;
  return resolveDiscountLedger(client, companyId, branchId, 'sales');
}

export async function resolveSalesReturnRoundingLedger(client, companyId, branchId) {
  const id = await getIntegrationAccountId(client, companyId, branchId, 'SalesReturnCRRoundingLedger');
  if (id) return id;
  return resolveRoundingLedger(client, companyId, branchId, 'sales');
}

export async function resolveBoSalesCrLedger(client, companyId, branchId, paymentMode) {
  const mode = String(paymentMode || 'CASH').toUpperCase();
  let param = 'BOSalesCRLedgerCash';
  if (mode.includes('CARD')) param = 'BOSalesCRLedgerCreditCard';
  else if (mode.includes('CREDIT')) param = 'BOSalesCRLedgerCredit';
  else if (mode.includes('OVERSEAS')) param = 'BOSalesCRLedgerOverseas';
  return getIntegrationAccountId(client, companyId, branchId, param);
}

export async function resolveBoSalesCrExemptLedger(client, companyId, branchId) {
  return getIntegrationAccountId(client, companyId, branchId, 'BOSalesCRCounterExempted');
}

export async function resolveInputTaxLedger(client, companyId, branchId) {
  return getIntegrationAccountId(client, companyId, branchId, 'InputTax5%');
}

export async function resolveOutputTaxLedger(client, companyId, branchId) {
  return getIntegrationAccountId(client, companyId, branchId, 'OutPutTax5%');
}

export async function resolveDiscountLedger(client, companyId, branchId, kind) {
  const map = {
    purchase: 'PurchaseEntryDRDiscountLedger',
    sales: 'BOSalesDRDiscountLedger',
  };
  return getIntegrationAccountId(client, companyId, branchId, map[kind] || map.purchase);
}

export async function resolveRoundingLedger(client, companyId, branchId, kind) {
  const map = {
    purchase: 'PurchaseEntryDRRoundingLedger',
    sales: 'BOSalesDRRoundingLedger',
  };
  return getIntegrationAccountId(client, companyId, branchId, map[kind] || map.purchase);
}

/** Split line subtotals into taxable vs exempt (supports negative return amounts). */
export function splitTaxableSubtotals(lines) {
  let taxable = 0;
  let exempt = 0;
  for (const L of lines) {
    const sub = round2(L.subtotalAmount ?? L.subtotal_amount ?? 0);
    if (Math.abs(sub) <= 0.0001) continue;
    const rate = Number(
      L.inputTax1Rate ?? L.input_tax_1_rate ?? L.tax1Rate ?? L.vatPct ?? L.taxPercent ?? 0,
    );
    const taxAmt = Number(
      L.inputTax1Amount ?? L.input_tax_1_amount ?? L.tax1Amount ?? L.vatAmt ?? L.taxAmt ?? 0,
    );
    const isTaxable = rate > 0.001 || Math.abs(taxAmt) > 0.001;
    if (isTaxable) taxable += sub;
    else exempt += sub;
  }
  return { taxable: round2(taxable), exempt: round2(exempt) };
}
