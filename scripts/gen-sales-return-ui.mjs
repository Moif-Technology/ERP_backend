/**
 * Generate SalesReturn.jsx from PurchaseReturn.jsx
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../../ERP_frontend/src/modules/backoffice/pages');
const src = fs.readFileSync(path.join(root, 'PurchaseReturn.jsx'), 'utf8');

let out = src
  .replace(/purchaseReturnEntryApi/g, 'salesReturnEntryApi')
  .replace(/supplierEntryApi/g, 'customerEntryApi')
  .replace(/Purchase Return/g, 'Sales Return')
  .replace(/PURCHASE RETURN/g, 'SALES RETURN')
  .replace(/purchase return/g, 'sales return')
  .replace(/PurchaseReturn/g, 'SalesReturn')
  .replace(/purchase-return-list/g, 'sales-return-list')
  .replace(/purchase-return/g, 'sales-return')
  .replace(/loadSourcePurchaseForReturn/g, 'loadSourceSaleForReturn')
  .replace(/handleLoadSourcePurchase/g, 'handleLoadSourceSale')
  .replace(/loadSourcePurchase/g, 'loadSourceSale')
  .replace(/sourcePurchaseId/g, 'sourceSalesId')
  .replace(/sourcePurchaseNo/g, 'sourceBillNo')
  .replace(/savedReturnId/g, 'SAVED_RETURN_ID_PLACEHOLDER')
  .replace(/purchaseId/g, 'salesId')
  .replace(/SAVED_RETURN_ID_PLACEHOLDER/g, 'savedReturnId')
  .replace(/lookupPurchaseReturn/g, 'lookupSalesReturn')
  .replace(/getPurchaseReturn/g, 'getSalesReturn')
  .replace(/createPurchaseReturn/g, 'createSalesReturn')
  .replace(/updatePurchaseReturn/g, 'updateSalesReturn')
  .replace(/postPurchaseReturn/g, 'postSalesReturn')
  .replace(/unpostPurchaseReturn/g, 'unpostSalesReturn')
  .replace(/fetchPurchaseReturnAccounts/g, 'fetchSalesReturnAccounts')
  .replace(/previewDraftPurchaseReturnAccounts/g, 'previewDraftSalesReturnAccounts')
  .replace(/previewPurchaseReturnAccounts/g, 'previewSalesReturnAccounts')
  .replace(/purchasedQty/g, 'soldQty')
  .replace(/supplierId/g, 'customerId')
  .replace(/supplierName/g, 'customerName')
  .replace(/Supplier/g, 'Customer')
  .replace(/supplier/g, 'customer')
  .replace(/purchaseNo/g, 'billNo')
  .replace(/Purchase #/g, 'Bill #')
  .replace(/Sup Inv#/g, 'Invoice #')
  .replace(/supplierInvNo/g, 'invoiceNo')
  .replace(/actualCost/g, 'unitPrice')
  .replace(/unitCost/g, 'unitPrice')
  .replace(/inputTax1Rate/g, 'tax1Rate')
  .replace(/inputTax1Amount/g, 'tax1Amount')
  .replace(/vatPct/g, 'taxPercent')
  .replace(/isPurchasePosted/g, 'isSalePosted')
  .replace(/isReturnPosted/g, 'isReturnPosted')
  .replace(/NewPurchaseIcon/g, 'NewSaleIcon')
  .replace(/from '\.\.\/\.\.\/\.\.\/services\/purchaseReturnEntry\.api\.js'/g, "from '../../../services/salesReturnEntry.api.js'")
  .replace(/from '\.\.\/\.\.\/\.\.\/services\/customerEntry\.api\.js'/g, "from '../../../services/customerEntry.api.js'");

// Fix import line
out = out.replace(
  "import * as salesReturnEntryApi from '../../../services/salesReturnEntry.api.js';",
  "import * as salesReturnEntryApi from '../../../services/salesReturnEntry.api.js';",
);

out = out.replace(
  /import \* as salesReturnEntryApi from '\.\.\/\.\.\/\.\.\/services\/salesReturnEntry\.api\.js';\nimport \* as productEntryApi from '\.\.\/\.\.\/\.\.\/services\/productEntry\.api\.js';/,
  "import * as salesReturnEntryApi from '../../../services/salesReturnEntry.api.js';\nimport * as productEntryApi from '../../../services/productEntry.api.js';",
);

// Sales Return has no LPO/GRN — strip purchase-only API calls after generation if present.

out = out.replace(/export default function SalesReturn\(\)/, 'export default function SalesReturn()');

fs.writeFileSync(path.join(root, 'SalesReturn.jsx'), out);
console.log('Wrote SalesReturn.jsx', out.length, 'chars');

// List page
const listSrc = fs.readFileSync(path.join(root, 'PurchaseReturnList.jsx'), 'utf8');
let listOut = listSrc
  .replace(/purchaseReturnEntryApi/g, 'salesReturnEntryApi')
  .replace(/supplierEntryApi/g, 'customerEntryApi')
  .replace(/Purchase Return/g, 'Sales Return')
  .replace(/PurchaseReturnList/g, 'SalesReturnList')
  .replace(/purchase-return/g, 'sales-return')
  .replace(/purchaseNo/g, 'billNo')
  .replace(/returnNo/g, 'returnNo')
  .replace(/supplierId/g, 'customerId')
  .replace(/supplierName/g, 'customerName')
  .replace(/Supplier/g, 'Customer')
  .replace(/supplier/g, 'customer')
  .replace(/listPurchaseReturns/g, 'listSalesReturns')
  .replace(/purchaseId/g, 'salesId');

fs.writeFileSync(path.join(root, 'SalesReturnList.jsx'), listOut);
console.log('Wrote SalesReturnList.jsx');
