/**
 * Legacy AccountsInventParameterTable mapping — per branch (station).
 * parameter_name matches the original VB ACCIntegrationUtility form.
 */

export const INTEGRATION_TABS = [
  { id: 'purchase', label: 'Purchase' },
  { id: 'purchaseReturn', label: 'Purchase Return' },
  { id: 'salesBo', label: 'Sales (Back Office)' },
  { id: 'salesCounter', label: 'Sales (Counter POS)' },
  { id: 'paymentReceipt', label: 'Payment / Receipt' },
];

/** @typedef {'ledger'|'voucher'} IntegrationFieldType */

/**
 * @type {Array<{
 *   key: string,
 *   param: string,
 *   tab: string,
 *   label: string,
 *   type: IntegrationFieldType,
 *   required?: boolean,
 *   filterPrefix?: string,
 *   hint?: string,
 *   aliases?: string[],
 * }>}
 */
export const INTEGRATION_PARAMETER_DEFS = [
  // ── Purchase ──
  { key: 'purchaseDrLedgerCash', param: 'PurchaseEntryDRLedgerCash', tab: 'purchase', label: 'Purchase DR — Cash', type: 'ledger', filterPrefix: '12' },
  { key: 'purchaseDrLedgerCredit', param: 'PurchaseEntryDRLedgerCredit', tab: 'purchase', label: 'Purchase DR — Credit', type: 'ledger', filterPrefix: '12' },
  { key: 'purchaseDrLedgerOverseas', param: 'PurchaseEntryDRLedgerOverseas', tab: 'purchase', label: 'Purchase DR — Overseas', type: 'ledger', filterPrefix: '12' },
  { key: 'purchaseDrLedgerExempted', param: 'PurchaseEntryDRLedgerExempted', tab: 'purchase', label: 'Purchase DR — Exempted / Zero-rated (0%)', type: 'ledger', filterPrefix: '12' },
  { key: 'purchaseDrDiscountLedger', param: 'PurchaseEntryDRDiscountLedger', tab: 'purchase', label: 'Purchase DR — Discount', type: 'ledger' },
  { key: 'purchaseDrRoundingLedger', param: 'PurchaseEntryDRRoundingLedger', tab: 'purchase', label: 'Purchase DR — Rounding', type: 'ledger' },
  { key: 'inputTax5', param: 'InputTax5%', tab: 'purchase', label: 'Input tax (5%)', type: 'ledger', filterPrefix: '04-02' },
  { key: 'purchaseEntryVoucher', param: 'PurchaseEntryVoucherName', tab: 'purchase', label: 'Purchase voucher type', type: 'voucher', hint: 'Voucher used when posting purchase entries.' },

  // ── Purchase return ──
  { key: 'purchaseReturnCrLedgerCash', param: 'PurchaseReturnCRLedgerCash', tab: 'purchaseReturn', label: 'Purchase return CR — Cash', type: 'ledger', filterPrefix: '12' },
  { key: 'purchaseReturnCrLedgerCredit', param: 'PurchaseReturnCRLedgerCredit', tab: 'purchaseReturn', label: 'Purchase return CR — Credit', type: 'ledger', filterPrefix: '12' },
  { key: 'purchaseReturnCrLedgerOverseas', param: 'PurchaseReturnCRLedgerOverseas', tab: 'purchaseReturn', label: 'Purchase return CR — Overseas', type: 'ledger', filterPrefix: '12' },
  { key: 'purchaseReturnCrDiscountLedger', param: 'PurchaseReturnCRDiscountLedger', tab: 'purchaseReturn', label: 'Purchase return CR — Discount', type: 'ledger' },
  { key: 'purchaseReturnCrRoundingLedger', param: 'PurchaseReturnCRRoundingLedger', tab: 'purchaseReturn', label: 'Purchase return CR — Rounding', type: 'ledger' },
  { key: 'purchaseReturnCrLedgerExempted', param: 'PurchaseReturnCRLedgerExempted', tab: 'purchaseReturn', label: 'Purchase return CR — Exempted', type: 'ledger', filterPrefix: '12' },
  { key: 'purchaseReturnVoucher', param: 'PurchaseReturnVoucherName', tab: 'purchaseReturn', label: 'Purchase return voucher type', type: 'voucher' },

  // ── Sales back office ──
  { key: 'boSalesCrLedgerCash', param: 'BOSalesCRLedgerCash', tab: 'salesBo', label: 'Sales CR — Cash', type: 'ledger', filterPrefix: '13' },
  { key: 'boSalesCrLedgerCredit', param: 'BOSalesCRLedgerCredit', tab: 'salesBo', label: 'Sales CR — Credit', type: 'ledger', filterPrefix: '13' },
  { key: 'boSalesCrLedgerCreditCard', param: 'BOSalesCRLedgerCreditCard', tab: 'salesBo', label: 'Sales CR — Credit card', type: 'ledger', filterPrefix: '13' },
  { key: 'boSalesCrLedgerOverseas', param: 'BOSalesCRLedgerOverseas', tab: 'salesBo', label: 'Sales CR — Overseas', type: 'ledger', filterPrefix: '13' },
  { key: 'boSalesDrDiscountLedger', param: 'BOSalesDRDiscountLedger', tab: 'salesBo', label: 'Sales DR — Discount', type: 'ledger' },
  { key: 'outputTax5', param: 'OutPutTax5%', tab: 'salesBo', label: 'Output tax (5%)', type: 'ledger', filterPrefix: '04-02' },
  { key: 'boSalesDrRoundingLedger', param: 'BOSalesDRRoundingLedger', tab: 'salesBo', label: 'Sales DR — Rounding', type: 'ledger' },
  { key: 'boSalesCrCounterExempted', param: 'BOSalesCRCounterExempted', tab: 'salesBo', label: 'Sales CR — Counter exempted', type: 'ledger', filterPrefix: '13' },
  { key: 'salesEntryVoucher', param: 'SalesEntryVoucherName', tab: 'salesBo', label: 'Sales voucher type', type: 'voucher' },

  // ── Sales counter POS ──
  { key: 'coSalesCrLedgerCash', param: 'COSalesCRLedgerCash', tab: 'salesCounter', label: 'Counter sales CR — Cash', type: 'ledger', filterPrefix: '13' },
  { key: 'coSalesCrLedgerCredit', param: 'COSalesCRLedgerCredit', tab: 'salesCounter', label: 'Counter sales CR — Credit', type: 'ledger', filterPrefix: '13' },
  { key: 'coSalesCrLedgerCreditCard', param: 'COSalesCRLedgerCreditCard', tab: 'salesCounter', label: 'Counter sales CR — Card', type: 'ledger', filterPrefix: '13' },
  { key: 'coSalesCrLedgerOverseas', param: 'COSalesCRLedgerOverseas', tab: 'salesCounter', label: 'Counter sales CR — Overseas', type: 'ledger', filterPrefix: '13' },
  { key: 'coSalesDrLedgerCash', param: 'COSalesDRLedgerCash', tab: 'salesCounter', label: 'Counter sales DR — Cash', type: 'ledger', filterPrefix: '03-02' },
  { key: 'coSalesDrLedgerCredit', param: 'COSalesDRLedgerCredit', tab: 'salesCounter', label: 'Counter sales DR — Credit', type: 'ledger', filterPrefix: '03-04' },
  { key: 'coSalesDrLedgerCreditCard', param: 'COSalesDRLedgerCreditCard', tab: 'salesCounter', label: 'Counter sales DR — Card', type: 'ledger', filterPrefix: '03-01' },
  { key: 'coSalesDrLedgerOverseas', param: 'COSalesDRLedgerOverseas', tab: 'salesCounter', label: 'Counter sales DR — Overseas', type: 'ledger' },
  { key: 'coSalesDrLedgerVoucher', param: 'COSalesDRLedgerVoucher', tab: 'salesCounter', label: 'Counter sales DR — Voucher', type: 'ledger' },
  { key: 'coSalesDrDiscountLedger', param: 'COSalesDRDiscountLedger', tab: 'salesCounter', label: 'Counter sales DR — Discount', type: 'ledger' },
  { key: 'coOutputTax5', param: 'COOutPutTax5%', tab: 'salesCounter', label: 'Counter output tax (5%)', type: 'ledger', filterPrefix: '04-02' },
  { key: 'coSalesDrRoundingLedger', param: 'COSalesDRRoundingLedger', tab: 'salesCounter', label: 'Counter sales DR — Rounding', type: 'ledger' },
  { key: 'coSalesDrCashierExcess', param: 'COSalesDRCashierShtExcessLedger', tab: 'salesCounter', label: 'Cashier sheet excess', type: 'ledger' },
  { key: 'coSalesCrCounterExempted', param: 'COSalesCRCounterExempted', tab: 'salesCounter', label: 'Counter sales CR — Exempted', type: 'ledger', filterPrefix: '13' },
  { key: 'coSalesEntryVoucher', param: 'COSalesEntryVoucherName', tab: 'salesCounter', label: 'Counter sales voucher type', type: 'voucher' },
  { key: 'salesCostVoucher', param: 'SalesCostVoucherName', tab: 'salesCounter', label: 'Sales cost voucher type', type: 'voucher' },
  { key: 'salesCostCounterDrLedger', param: 'SalesCostCounterDRLedger', tab: 'salesCounter', label: 'Sales cost DR (counter)', type: 'ledger', filterPrefix: '05' },
  { key: 'salesCostInventoryCrLedger', param: 'SalesCostInventoryCRLedgerName', tab: 'salesCounter', label: 'Sales cost CR — Inventory', type: 'ledger', filterPrefix: '03-03' },
  {
    key: 'codrCashReceiptLedger',
    param: 'CODRCashReceiptLedger',
    tab: 'salesCounter',
    label: 'Credit settlement — Cash receipt',
    type: 'ledger',
    required: true,
    filterPrefix: '03-02',
    hint: 'Used when customers pay outstanding bills with cash (Counter POS).',
    aliases: ['DEFAULT_CASH_LEDGER'],
  },
  {
    key: 'codrCardReceiptLedger',
    param: 'CODRCreditCardReceiptLedger',
    tab: 'salesCounter',
    label: 'Credit settlement — Card receipt',
    type: 'ledger',
    required: true,
    filterPrefix: '03-01',
    hint: 'Used when customers pay outstanding bills by card.',
    aliases: ['DEFAULT_CARD_LEDGER'],
  },
  { key: 'codrChequeReceiptLedger', param: 'CODRChequeReceiptLedger', tab: 'salesCounter', label: 'Credit settlement — Cheque receipt', type: 'ledger', filterPrefix: '03-01' },

  // ── Payment / receipt vouchers ──
  { key: 'paymentVoucherSupplier', param: 'PaymentVoucherNameSupplier', tab: 'paymentReceipt', label: 'Payment voucher (supplier)', type: 'voucher' },
  { key: 'paymentVoucher', param: 'PaymentVoucherName', tab: 'paymentReceipt', label: 'Payment voucher', type: 'voucher' },
  { key: 'receiptVoucherCustomer', param: 'ReceiptVoucherNameCustomer', tab: 'paymentReceipt', label: 'Receipt voucher (customer)', type: 'voucher' },
  { key: 'receiptVoucher', param: 'ReceiptVoucherName', tab: 'paymentReceipt', label: 'Receipt voucher', type: 'voucher' },

  // ── Payment / receipt — cash & card (same ledgers as counter settlement) ──
  {
    key: 'paymentReceiptCashLedger',
    param: 'DEFAULT_CASH_LEDGER',
    tab: 'paymentReceipt',
    label: 'Cash ledger (receipts & payments)',
    type: 'ledger',
    filterPrefix: '03-02',
    hint: 'Cash-in-hand posting account — e.g. 03-02-001.',
    aliases: ['CODRCashReceiptLedger'],
  },
  {
    key: 'paymentReceiptCardLedger',
    param: 'DEFAULT_CARD_LEDGER',
    tab: 'paymentReceipt',
    label: 'Card / bank ledger (receipts & payments)',
    type: 'ledger',
    filterPrefix: '03-01',
    hint: 'Bank posting account — e.g. 03-01-001.',
    aliases: ['CODRCreditCardReceiptLedger'],
  },

  // ── Party parents (used across modules) ──
  { key: 'customerParentAccountId', param: 'CUSTOMER_PARENT_LEDGER', tab: 'paymentReceipt', label: 'Customer receivables group', type: 'ledger', filterPrefix: '03-04', postingOnly: false, hint: 'Parent for customer sub-ledgers.' },
  { key: 'supplierParentAccountId', param: 'SUPPLIER_PARENT_LEDGER', tab: 'paymentReceipt', label: 'Supplier payables group', type: 'ledger', filterPrefix: '04-01', postingOnly: false, hint: 'Parent for supplier sub-ledgers.' },
];

export const INTEGRATION_PARAM_BY_KEY = Object.fromEntries(
  INTEGRATION_PARAMETER_DEFS.map((d) => [d.key, d]),
);

export const REQUIRED_INTEGRATION_KEYS = INTEGRATION_PARAMETER_DEFS
  .filter((d) => d.required)
  .map((d) => d.key);

/** When saving these legacy keys, also mirror to modern parameter names. */
export const PARAMETER_ALIASES_ON_SAVE = {
  CODRCashReceiptLedger: ['DEFAULT_CASH_LEDGER'],
  CODRCreditCardReceiptLedger: ['DEFAULT_CARD_LEDGER'],
  DEFAULT_CASH_LEDGER: ['CODRCashReceiptLedger'],
  DEFAULT_CARD_LEDGER: ['CODRCreditCardReceiptLedger'],
};

/** Read fallbacks: if primary param empty, use these parameter_name values. */
export const PARAMETER_READ_FALLBACKS = {
  codrCashReceiptLedger: ['CODRCashReceiptLedger', 'DEFAULT_CASH_LEDGER'],
  codrCardReceiptLedger: ['CODRCreditCardReceiptLedger', 'DEFAULT_CARD_LEDGER'],
  paymentReceiptCashLedger: ['DEFAULT_CASH_LEDGER', 'CODRCashReceiptLedger'],
  paymentReceiptCardLedger: ['DEFAULT_CARD_LEDGER', 'CODRCreditCardReceiptLedger'],
};
