/**
 * Voucher line outstanding helpers.
 * outstanding_balance = 0 means fully settled; only NULL falls back to debit/credit.
 */

/** Customer receivable line (typically DR). */
export const VD_RECEIVABLE_OS_EXPR =
  'GREATEST(COALESCE(vd.outstanding_balance, vd.debit_amount - vd.credit_amount), 0)';

/** Supplier payable line (typically CR). */
export const VD_PAYABLE_OS_EXPR =
  'GREATEST(COALESCE(vd.outstanding_balance, vd.credit_amount - vd.debit_amount), 0)';

/** Single-sided debit line O/S (sales bill customer line). */
export const VD_DEBIT_LINE_OS_EXPR =
  'GREATEST(COALESCE(vd.outstanding_balance, vd.debit_amount), 0)';

/** Single-sided credit line O/S (purchase bill supplier line). */
export const VD_CREDIT_LINE_OS_EXPR =
  'GREATEST(COALESCE(vd.outstanding_balance, vd.credit_amount), 0)';

/**
 * Bill O/S when receipts may only exist in cash_transaction_child (legacy rows).
 * When outstanding_balance is set (incl. 0), use it; else debit − cleared payments.
 */
export function debitBillOsExpr(clearedPaidSubquery) {
  return `GREATEST(
    CASE
      WHEN vd.outstanding_balance IS NOT NULL THEN vd.outstanding_balance::numeric
      ELSE GREATEST(vd.debit_amount::numeric - ${clearedPaidSubquery}, 0)
    END,
    0
  )`;
}

export function creditBillOsExpr(clearedPaidSubquery) {
  return `GREATEST(
    CASE
      WHEN vd.outstanding_balance IS NOT NULL THEN vd.outstanding_balance::numeric
      ELSE GREATEST(vd.credit_amount::numeric - ${clearedPaidSubquery}, 0)
    END,
    0
  )`;
}
