/** Canonical bill payment_mode values for Counter POS. */
export const PM = {
  CASH: 'CASH',
  CREDITCARD: 'CREDITCARD',
  CREDIT: 'CREDIT',
  MULTIPAYMENT: 'MULTIPAYMENT',
};

export function up(v) {
  return String(v ?? '').trim().toUpperCase();
}

/** Normalize bill-level payment_mode for storage and API responses. */
export function normalizeBillPaymentMode(mode) {
  const m = up(mode).replace(/\s+/g, '');
  if (m === 'CARD' || m === 'CC' || m === 'CREDITCARD') return PM.CREDITCARD;
  if (m === 'MULTI' || m === 'MULTIPAYMENT' || m === 'MULTIPAY') return PM.MULTIPAYMENT;
  if (m === 'CREDIT') return PM.CREDIT;
  if (m === 'PENDING') return 'PENDING';
  return PM.CASH;
}

/** Normalize split row pay_mode for sales_payment_split. */
export function normalizeSplitPayMode(mode) {
  const m = up(mode).replace(/\s+/g, '');
  if (m === 'CARD' || m === 'CC' || m === 'CREDITCARD') return PM.CREDITCARD;
  if (m === 'ONLINE') return 'ONLINE';
  if (m === 'VOUCHER') return 'VOUCHER';
  if (m === 'CREDIT') return PM.CREDIT;
  return PM.CASH;
}

export const SPLIT_PAY_MODES = new Set(['CASH', 'CREDITCARD', 'ONLINE', 'VOUCHER']);

export function isCreditCardBillMode(mode) {
  return normalizeBillPaymentMode(mode) === PM.CREDITCARD;
}

export function isMultiPaymentBillMode(mode) {
  return normalizeBillPaymentMode(mode) === PM.MULTIPAYMENT;
}

export function isCashTenderBillMode(mode) {
  const m = normalizeBillPaymentMode(mode);
  return m === PM.CASH || m === PM.CREDITCARD;
}
