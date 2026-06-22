function str(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function parsePaymentMode(raw) {
  const s = (str(raw, 50) || 'CASH').toUpperCase().replace(/\s+/g, ' ').trim();
  if (s === 'CREDIT' || (s.includes('CREDIT') && !s.includes('CARD'))) return 'CREDIT';
  if (s.includes('CREDIT CARD') || s === 'CARD') return 'CARD';
  if (s.includes('TRANSFER')) return 'TRANSFER';
  return 'CASH';
}

export function canPaySupplierNow(paymentMode, paymentNow) {
  return Boolean(paymentNow) && parsePaymentMode(paymentMode) !== 'CREDIT';
}
