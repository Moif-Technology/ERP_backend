import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, '../../ERP_frontend/src/modules/backoffice/pages/PaymentVoucherSupplierEntry.jsx');
let s = fs.readFileSync(file, 'utf8');

const pairs = [
  ['ReceiptVoucherCustomerEntry', 'PaymentVoucherSupplierEntry'],
  ['customerReceiptApi', 'supplierPaymentApi'],
  ["import * as customerReceiptApi from '../../../services/customerReceipt.api.js';", "import * as supplierPaymentApi from '../../../services/supplierPayment.api.js';"],
  ['customerEntryApi', 'supplierEntryApi'],
  ["import * as customerEntryApi from '../../../services/customerEntry.api.js';", "import * as supplierEntryApi from '../../../services/supplierEntry.api.js';"],
  ['printCustomerReceipt', 'printCustomerReceipt'],
  ["import { printCustomerReceipt } from '../../../shared/utils/printCustomerReceipt.js';", "import { printCustomerReceipt } from '../../../shared/utils/printCustomerReceipt.js';"],
  ['getCustomerOutstandingBills', 'getSupplierOutstandingBills'],
  ['getCustomerReceiptByVoucher', 'getSupplierPaymentByVoucher'],
  ['getCustomerReceipt', 'getSupplierPayment'],
  ['saveCustomerReceipt', 'saveSupplierPayment'],
  ['updateCustomerReceipt', 'updateSupplierPayment'],
  ['postCustomerReceipt', 'postSupplierPayment'],
  ['unpostCustomerReceipt', 'unpostSupplierPayment'],
  ['clearPdcCustomerReceipt', 'clearPdcSupplierPayment'],
  ['reconcileBankCustomerReceipt', 'reconcileBankSupplierPayment'],
  ['selectedCustomerId', 'selectedSupplierId'],
  ['setSelectedCustomerId', 'setSelectedSupplierId'],
  ['customersLoading', 'suppliersLoading'],
  ['setCustomersLoading', 'setSuppliersLoading'],
  ['customers,', 'suppliers,'],
  ['setCustomers', 'setSuppliers'],
  ['customerOs', 'supplierOs'],
  ['setCustomerOs', 'setSupplierOs'],
  ['loadCustomerBills', 'loadSupplierBills'],
  ['handleSelectCustomer', 'handleSelectSupplier'],
  ['handleClearCustomer', 'handleClearSupplier'],
  ['filterCustomer', 'filterSupplier'],
  ['loadReceiptFromVoucher', 'loadPaymentFromVoucher'],
  ['applyReceiptToForm', 'applyPaymentToForm'],
  ['loadingReceipt', 'loadingPayment'],
  ['setLoadingReceipt', 'setLoadingPayment'],
  ['receiptDate', 'paymentDate'],
  ['setReceiptDate', 'setPaymentDate'],
  ['receiptStatus', 'paymentStatus'],
  ['setReceiptStatus', 'setPaymentStatus'],
  ['receiptBills', 'paymentBills'],
  ['Customer Receipt', 'Supplier Payment'],
  ['customer receipt', 'supplier payment'],
  ['Receipt is posted', 'Payment is posted'],
  ['Save the receipt', 'Save the payment'],
  ['Failed to save receipt', 'Failed to save payment'],
  ['Failed to post receipt', 'Failed to post payment'],
  ['Failed to unpost receipt', 'Failed to unpost payment'],
  ['Could not load receipt', 'Could not load payment'],
  ['Select a customer', 'Select a supplier'],
  ['customer O/S', 'supplier O/S'],
  ['customerId', 'supplierId'],
  ['customerName', 'supplierName'],
  ['customerCode', 'supplierCode'],
  ['customerId:', 'supplierId:'],
  ['Customer', 'Supplier'],
  ['`RCV-', '`PAY-'],
  ["data.receiptStatus", 'data.paymentStatus'],
  ['Receipt Voucher – Customer', 'Payment Voucher – Supplier'],
  ['Receipt voucher', 'Payment voucher'],
  ['receipt voucher', 'payment voucher'],
  [' Sale', ' Purchase'],
  [": 'Sale'", ": 'Purchase'"],
];

for (const [from, to] of pairs) {
  s = s.split(from).join(to);
}

// SearchableEntitySelect labelKey/valueKey for suppliers
s = s.replace(/entityLabel="Customer"/g, 'entityLabel="Supplier"');
s = s.replace(/placeholder="Search customer\.\.\."/g, 'placeholder="Search supplier..."');
s = s.replace(/listCustomers/g, 'listSuppliers');
s = s.replace(/c\.customerName/g, 'c.supplierName');
s = s.replace(/c\.customerCode/g, 'c.supplierCode');
s = s.replace(/c\.customerId/g, 'c.supplierId');

fs.writeFileSync(file, s);
console.log('Updated', file);
