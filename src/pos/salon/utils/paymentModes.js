/** Canonical bill payment_mode values for Salon POS. */
export const PM = {
  CASH: 'CASH',
  CREDITCARD: 'CREDITCARD',
  CREDIT: 'CREDIT',
  MULTIPAYMENT: 'MULTIPAYMENT',
  ONLINE: 'ONLINE',
  COMPLIMENT: 'COMPLIMENT',
};

export function up(v) {
  return String(v ?? '').trim().toUpperCase();
}

/** Normalize bill-level payment_mode for storage and API responses. */
export function normalizeBillPaymentMode(mode) {
  const m = up(mode).replace(/\s+/g, '');
  if (m === 'CARD' || m === 'CC' || m === 'CREDITCARD') return PM.CREDITCARD;
  if (m === 'MULTI' || m === 'MULTIPAYMENT' || m === 'MULTIPAY' || m === 'MPAY') {
    return PM.MULTIPAYMENT;
  }
  if (m === 'CREDIT') return PM.CREDIT;
  if (m === 'ONLINE') return PM.ONLINE;
  if (m === 'COMPLIMENT' || m === 'COMPLIMENTARY' || m === 'COMP') return PM.COMPLIMENT;
  return PM.CASH;
}

/** Normalize split row pay_mode for sales_payment_split. */
export function normalizeSplitPayMode(mode) {
  const m = up(mode).replace(/\s+/g, '');
  if (m === 'CARD' || m === 'CC' || m === 'CREDITCARD') return PM.CREDITCARD;
  if (m === 'ONLINE') return PM.ONLINE;
  if (m === 'VOUCHER') return 'VOUCHER';
  if (m === 'CREDIT') return PM.CREDIT;
  if (m === 'COMPLIMENT' || m === 'COMPLIMENTARY') return PM.COMPLIMENT;
  return PM.CASH;
}

export const SPLIT_PAY_MODES = new Set([
  'CASH',
  'CREDITCARD',
  'ONLINE',
  'VOUCHER',
  'CREDIT',
  'COMPLIMENT',
]);

export function isMultiPaymentBillMode(mode) {
  return normalizeBillPaymentMode(mode) === PM.MULTIPAYMENT;
}

export function isCreditCardBillMode(mode) {
  return normalizeBillPaymentMode(mode) === PM.CREDITCARD;
}

export function isCreditBillMode(mode) {
  return normalizeBillPaymentMode(mode) === PM.CREDIT;
}

export function isComplimentBillMode(mode) {
  return normalizeBillPaymentMode(mode) === PM.COMPLIMENT;
}

export function isOnlineBillMode(mode) {
  return normalizeBillPaymentMode(mode) === PM.ONLINE;
}
