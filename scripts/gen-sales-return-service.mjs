/**
 * Generate salesReturnEntry.service.js from purchaseReturnEntry.service.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, '../src/backoffice/services/purchaseReturnEntry.service.js'), 'utf8');

let out = src
  .replace(/Purchase return/g, 'Sales return')
  .replace(/purchase return/g, 'sales return')
  .replace(/purchaseReturnEntry\.repository/g, 'salesReturnEntry.repository')
  .replace(/purchaseReturnEntry\.repository/g, 'salesReturnEntry.repository')
  .replace(/\*purchaseReturnEntry\.repository\.js/g, '*salesReturnEntry.repository.js')
  .replace(/from '\.\.\/repositories\/purchaseReturnEntry\.repository\.js'/g, "from '../repositories/salesReturnEntry.repository.js'")
  .replace(/from '\.\.\/repositories\/supplier\.repository\.js'/g, "from '../repositories/customer.repository.js'")
  .replace(/partyLedgerService\.ensureSupplierLedgerForId/g, 'partyLedgerService.ensureCustomerLedgerForId')
  .replace(/supplierRepo\.supplierExists/g, 'customerRepo.customerExists')
  .replace(/import \* as supplierRepo/g, 'import * as customerRepo')
  .replace(/resolvePurchaseCrLedger/g, 'RESOLVE_PURCHASE_CR_PLACEHOLDER')
  .replace(/resolveInputTaxLedger/g, 'resolveOutputTaxLedger')
  .replace(/resolvePurchaseReturnDiscountLedger/g, 'resolveSalesReturnDiscountLedger')
  .replace(/resolvePurchaseReturnRoundingLedger/g, 'resolveSalesReturnRoundingLedger')
  .replace(/RESOLVE_PURCHASE_CR_PLACEHOLDER/g, 'resolveSalesReturnCrLedger')
  .replace(/PurchaseReturnVoucherName/g, 'SalesReturnVoucherName')
  .replace(/'PRT'/g, "'SRT'")
  .replace(/PRT-/g, 'SRT-')
  .replace(/`PRT:/g, '`SRT:')
  .replace(/`PRT /g, '`SRT ')
  .replace(/purchaseId/g, 'salesId')
  .replace(/PurchaseId/g, 'SalesId')
  .replace(/purchaseNo/g, 'billNo')
  .replace(/PurchaseNo/g, 'BillNo')
  .replace(/sourcePurchaseId/g, 'sourceSalesId')
  .replace(/sourcePurchaseNo/g, 'sourceBillNo')
  .replace(/source_purchase_id/g, 'return_sales_id')
  .replace(/source_purchase_no/g, 'source_bill_no')
  .replace(/sourcePurchase/g, 'sourceSale')
  .replace(/loadSourcePurchase/g, 'loadSourceSale')
  .replace(/getSourcePurchaseForReturn/g, 'getSourceSaleForReturn')
  .replace(/listPurchaseLines/g, 'listSaleLines')
  .replace(/insertPurchaseChild/g, 'insertSaleChild')
  .replace(/nextPurchaseChildId/g, 'nextSalesChildId')
  .replace(/softDeletePurchaseChildren/g, 'softDeleteSaleChildren')
  .replace(/updatePurchasePostStatus/g, 'updateReturnPostStatus')
  .replace(/purchaseReturnEntry/g, 'salesReturnEntry')
  .replace(/PurchaseReturn/g, 'SalesReturn')
  .replace(/createPurchaseReturn/g, 'createSalesReturn')
  .replace(/updatePurchaseReturn/g, 'updateSalesReturn')
  .replace(/getPurchaseReturn/g, 'getSalesReturn')
  .replace(/listPurchaseReturns/g, 'listSalesReturns')
  .replace(/lookupPurchaseReturn/g, 'lookupSalesReturn')
  .replace(/postPurchaseReturn/g, 'postSalesReturn')
  .replace(/unpostPurchaseReturn/g, 'unpostSalesReturn')
  .replace(/getPurchaseReturnAccounts/g, 'getSalesReturnAccounts')
  .replace(/previewPurchaseReturnAccounts/g, 'previewSalesReturnAccounts')
  .replace(/previewDraftPurchaseReturnAccounts/g, 'previewDraftSalesReturnAccounts')
  .replace(/supplierId/g, 'customerId')
  .replace(/supplier_id/g, 'customer_id')
  .replace(/supplierId/g, 'customerId')
  .replace(/supplierName/g, 'customerName')
  .replace(/supplier_name/g, 'customer_name')
  .replace(/supplierInvoiceNo/g, 'invoiceNo')
  .replace(/supplier_invoice_no/g, 'invoice_no')
  .replace(/supplierDebit/g, 'customerCredit')
  .replace(/supplierOs/g, 'customerOs')
  .replace(/supplierReturnOutstandingFromVoucher/g, 'customerReturnOutstandingFromVoucher')
  .replace(/supplierLedgerId/g, 'customerLedgerId')
  .replace(/purchasedQty/g, 'soldQty')
  .replace(/unitCost/g, 'unitPrice')
  .replace(/inputTax1/g, 'tax1')
  .replace(/input_tax_1/g, 'tax_1')
  .replace(/PURCHASE_RETURN/g, 'SALES_RETURN')
  .replace(/purchase_date/g, 'bill_date')
  .replace(/purchaseDate/g, 'billDate')
  .replace(/invoice_amount/g, 'amount')
  .replace(/items_total_bc/g, 'amount')
  .replace(/againstPurchaseNoFromRow/g, 'againstBillNoFromRow')
  .replace(/resolveReturnSupplierDebit/g, 'resolveReturnCustomerCredit')
  .replace(/hasPurchaseCr/g, 'hasSalesCr')
  .replace(/purchaseCrTaxableId/g, 'salesCrTaxableId')
  .replace(/purchaseCrExemptId/g, 'salesCrExemptId')
  .replace(/purchasePosted/g, 'salesPosted')
  .replace(/purchaseVoucher/g, 'salesVoucher');

// Fix import line for customer repo path
out = out.replace(
  "from '../repositories/customer.repository.js'",
  "from '../repositories/customer.repository.js'",
);

// Invert voucher push directions for sales return (DR revenue/tax, CR customer/discount)
out = out.replace(
  `  const pushCr = (accountId, amount, narration) => {
    if (!accountId || amount <= 0) return;
    lines.push({ accountId, debitAmount: 0, creditAmount: round2(amount), outstandingBalance: 0, narration });
  };
  const pushDr = (accountId, amount, narration, outstanding = 0) => {
    if (!accountId || amount <= 0) return;
    lines.push({
      accountId,
      debitAmount: round2(amount),
      creditAmount: 0,
      outstandingBalance: round2(outstanding),
      narration,
    });
  };

  if (!customerLedgerId || !hasSalesCr) {
    warnings.push('Return not posted — configure customer ledger and sales return CR ledger in Account Integration');
    return { lines, warnings, customerLedgerId, hasLedgers: false, customerCredit: absAmt(invoiceAmount) };
  }

  if (Math.abs(amtTaxable) > 0.001) {
    pushCr(salesCrTaxableId, absAmt(amtTaxable), \`SRT taxable: \${returnNo}\`);
  }
  if (Math.abs(amtExempt) > 0.001) {
    const exId = await resolveReturnExemptCrLedger(salesCrTaxableId, salesCrExemptId, warnings);
    if (exId) pushCr(exId, absAmt(amtExempt), \`SRT exempt (0%): \${returnNo}\`);
  }
  if (Math.abs(amtTaxable) <= 0.001 && Math.abs(amtExempt) <= 0.001) {
    pushCr(salesCrTaxableId, absAmt(invoiceAmount) - absAmt(adjSumTax), \`SRT: \${returnNo}\`);
  }

  if (Math.abs(headerDisc) > 0.001 && discountLedgerId) {
    pushDr(discountLedgerId, absAmt(headerDisc), \`SRT discount: \${returnNo}\`);
  }
  if (roundOff > 0 && roundLedgerId) {
    pushCr(roundLedgerId, absAmt(roundOff), \`SRT round: \${returnNo}\`);
  } else if (roundOff < 0 && roundLedgerId) {
    pushDr(roundLedgerId, absAmt(roundOff), \`SRT round: \${returnNo}\`);
  }
  if (Math.abs(adjSumTax) > 0.001 && inputTaxLedgerId) {
    pushCr(inputTaxLedgerId, absAmt(adjSumTax), \`SRT input tax: \${returnNo}\`);
  } else if (Math.abs(adjSumTax) > 0.001) {
    warnings.push('Input tax ledger not configured — tax added to purchase CR');
    pushCr(salesCrTaxableId || salesCrExemptId, absAmt(adjSumTax), \`SRT tax: \${returnNo}\`);
  }

  const customerCredit = resolveReturnCustomerCredit(
    invoiceAmount, amtTaxable, amtExempt, adjSumTax, headerDisc, roundOff, warnings,
  );
  // Voucher detail O/S must be >= 0 (DB constraint); purchase_master stores negative payable reduction.
  pushDr(customerLedgerId, customerCredit, \`SRT: \${returnNo}\`, customerCredit);`,
  `  const pushDrLine = (accountId, amount, narration, outstanding = 0) => {
    if (!accountId || amount <= 0) return;
    lines.push({
      accountId,
      debitAmount: round2(amount),
      creditAmount: 0,
      outstandingBalance: round2(outstanding),
      narration,
    });
  };
  const pushCrLine = (accountId, amount, narration, outstanding = 0) => {
    if (!accountId || amount <= 0) return;
    lines.push({
      accountId,
      debitAmount: 0,
      creditAmount: round2(amount),
      outstandingBalance: round2(outstanding),
      narration,
    });
  };

  if (!customerLedgerId || !hasSalesCr) {
    warnings.push('Return not posted — configure customer ledger and sales return DR ledger in Account Integration');
    return { lines, warnings, customerLedgerId, hasLedgers: false, customerCredit: absAmt(invoiceAmount) };
  }

  if (Math.abs(amtTaxable) > 0.001) {
    pushDrLine(salesCrTaxableId, absAmt(amtTaxable), \`SRT taxable: \${returnNo}\`);
  }
  if (Math.abs(amtExempt) > 0.001) {
    const exId = await resolveReturnExemptCrLedger(salesCrTaxableId, salesCrExemptId, warnings);
    if (exId) pushDrLine(exId, absAmt(amtExempt), \`SRT exempt (0%): \${returnNo}\`);
  }
  if (Math.abs(amtTaxable) <= 0.001 && Math.abs(amtExempt) <= 0.001) {
    pushDrLine(salesCrTaxableId, absAmt(invoiceAmount) - absAmt(adjSumTax), \`SRT: \${returnNo}\`);
  }

  if (Math.abs(headerDisc) > 0.001 && discountLedgerId) {
    pushCrLine(discountLedgerId, absAmt(headerDisc), \`SRT discount: \${returnNo}\`);
  }
  if (roundOff > 0 && roundLedgerId) {
    pushCrLine(roundLedgerId, absAmt(roundOff), \`SRT round: \${returnNo}\`);
  } else if (roundOff < 0 && roundLedgerId) {
    pushDrLine(roundLedgerId, absAmt(roundOff), \`SRT round: \${returnNo}\`);
  }
  if (Math.abs(adjSumTax) > 0.001 && outputTaxLedgerId) {
    pushDrLine(outputTaxLedgerId, absAmt(adjSumTax), \`SRT output tax: \${returnNo}\`);
  } else if (Math.abs(adjSumTax) > 0.001) {
    warnings.push('Output tax ledger not configured — tax added to sales DR');
    pushDrLine(salesCrTaxableId || salesCrExemptId, absAmt(adjSumTax), \`SRT tax: \${returnNo}\`);
  }

  const customerCredit = resolveReturnCustomerCredit(
    invoiceAmount, amtTaxable, amtExempt, adjSumTax, headerDisc, roundOff, warnings,
  );
  pushCrLine(customerLedgerId, customerCredit, \`SRT: \${returnNo}\`, customerCredit);`,
);

// Rename inputTaxLedgerId to outputTaxLedgerId in resolveReturnVoucherLinePlan
out = out.replace(
  /const inputTaxLedgerId = Math\.abs\(adjSumTax\) > 0\.001 \? await resolveOutputTaxLedger/g,
  'const outputTaxLedgerId = Math.abs(adjSumTax) > 0.001 ? await resolveOutputTaxLedger',
);

// Stock: positive qty for sales return (stock in)
out = out.replace(
  `      const outQty = L.qty + L.focQty;
      if (outQty >= 0) continue;
      await stockRepo.applyStockMovement(client, {
        companyId, branchId,
        productId: L.productId,
        transactionType: 'SALES_RETURN',
        transactionId: salesId,
        qty: outQty,
        unitCost: L.unitPrice,
        unitPrice: 0,`,
  `      const returnQty = Math.abs(L.qty);
      if (returnQty <= 0) continue;
      await stockRepo.applyStockMovement(client, {
        companyId, branchId,
        productId: L.productId,
        transactionType: 'SALES_RETURN',
        transactionId: salesId,
        qty: returnQty,
        unitCost: L.unitCost ?? L.unitPrice ?? 0,
        unitPrice: L.unitPrice ?? 0,`,
);

const dest = path.join(__dirname, '../src/backoffice/services/salesReturnEntry.service.js');
fs.writeFileSync(dest, out);
console.log('Wrote', dest, 'length', out.length);
