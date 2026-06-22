/**
 * Purchase return — negative entry amounts; accounts posted as positive inverse of purchase.
 */
import { withTransaction } from '../../config/db.js';
import * as accountHeadRepo from '../../accounts/repositories/accountHead.repository.js';
import * as accountsParameterRepo from '../../accounts/repositories/accountsParameter.repository.js';
import {
  resolvePurchaseCrLedger,
  resolveInputTaxLedger,
  resolvePurchaseReturnDiscountLedger,
  resolvePurchaseReturnRoundingLedger,
  splitTaxableSubtotals,
} from '../../accounts/lib/integrationPosting.js';
import * as voucherRepo from '../../accounts/repositories/voucher.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as stockRepo from '../../shared/repositories/stock.repository.js';
import * as supplierRepo from '../repositories/supplier.repository.js';
import * as returnRepo from '../repositories/purchaseReturnEntry.repository.js';
import * as partyLedgerService from './partyLedger.service.js';
import { computePurchaseAmounts, resolveHeaderDiscountFromBody } from '../lib/purchaseAmounts.js';
import { auditStaffId } from '../../pos/restaurant-pos/lib/staffAudit.js';
import { auditUserName } from '../../shared/lib/auditUser.js';

function num(v, d = 0) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function str(v, max = 200) {
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}

function parseBranchId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function parseOptionalISODate(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseLimitOffset(query) {
  const lim = Math.min(Math.max(Number(query?.limit) || 50, 1), 200);
  const off = Math.max(Number(query?.offset) || 0, 0);
  return { lim, off };
}

function absAmt(n) {
  return round2(Math.abs(num(n, 0)));
}

function againstPurchaseNoFromRow(row) {
  const pno = row?.purchase_no != null ? String(row.purchase_no).trim() : '';
  if (!pno || pno === '0') return null;
  return pno;
}

function resolveReturnMasterNumbers({ withInvoice, sourcePurchaseNo, returnDocNo }) {
  return {
    purchaseNo: withInvoice && sourcePurchaseNo ? sourcePurchaseNo : '0',
    returnNo: returnDocNo,
  };
}

function returnDocNoFromRow(row) {
  return row?.return_no != null ? String(row.return_no) : '';
}

function mapReturnMaster(row) {
  if (!row) return null;
  const returnDocNo = returnDocNoFromRow(row);
  const againstPurchaseNo = againstPurchaseNoFromRow(row);
  return {
    purchaseId: Number(row.purchase_id),
    returnNo: returnDocNo,
    purchaseNo: againstPurchaseNo ?? '0',
    branchId: Number(row.branch_id),
    supplierId: row.supplier_id != null ? Number(row.supplier_id) : null,
    supplierName: row.supplier_name ?? null,
    sourcePurchaseId: row.source_purchase_id != null ? Number(row.source_purchase_id) : null,
    sourcePurchaseNo: row.source_purchase_no != null
      ? String(row.source_purchase_no)
      : againstPurchaseNo,
    supplierInvoiceNo: row.supplier_invoice_no ?? null,
    purchaseDate: row.purchase_date,
    invoiceAmount: row.invoice_amount != null ? String(row.invoice_amount) : '0',
    outstandingBalance: row.outstanding_balance != null ? String(row.outstanding_balance) : '0',
    paymentMode: row.payment_mode ?? null,
    postStatus: row.post_status ?? 'DRAFT',
    recordStatus: row.record_status ?? 'ACTIVE',
    remarks: row.remarks ?? null,
    discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
    roundOffAdjustment: row.round_off_adjustment != null ? String(row.round_off_adjustment) : '0',
    withInvoice: row.source_purchase_id != null,
  };
}

function mapReturnLine(row) {
  if (!row) return null;
  const qty = num(row.qty, 0);
  return {
    purchaseChildId: Number(row.purchase_child_id),
    productId: row.product_id != null ? Number(row.product_id) : null,
    productCode: row.product_code ?? null,
    shortDescription: row.short_name ?? row.product_name ?? null,
    purchasedQty: row.purchased_qty != null ? String(row.purchased_qty) : null,
    qty: String(qty),
    returnQty: String(qty),
    focQty: row.foc_qty != null ? String(row.foc_qty) : '0',
    unitCost: row.unit_cost != null ? String(row.unit_cost) : '0',
    unitName: row.unit_name ?? 'Pcs',
    discountPercentage: row.discount_percentage != null ? String(row.discount_percentage) : '0',
    discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
    subtotalAmount: row.subtotal_amount != null ? String(row.subtotal_amount) : '0',
    inputTax1Amount: row.input_tax_1_amount != null ? String(row.input_tax_1_amount) : '0',
    inputTax1Rate: row.input_tax_1_rate != null ? String(row.input_tax_1_rate) : '0',
    lineAmount: row.line_amount != null ? String(row.line_amount) : '0',
    total: row.line_amount != null ? String(row.line_amount) : '0',
  };
}

function computeLineFromReturnQty(line) {
  const returnQty = num(line.returnQty ?? line.qty, 0);
  const qty = returnQty > 0 ? -returnQty : returnQty;
  if (qty >= 0) {
    const err = new Error('Return quantity must be negative');
    err.status = 400;
    throw err;
  }
  const unitCost = num(line.actualCost ?? line.unitCost, 0);
  const discPct = num(line.discPct ?? line.discountPercentage, 0);
  const discAmt = num(line.discAmt ?? line.discountAmount, 0);
  const vatPct = num(line.vatPct ?? line.inputTax1Rate, 0);
  const gross = Math.abs(qty) * unitCost;
  const pctDiscount = gross * (discPct / 100);
  const subtotal = round2(-Math.max(0, gross - pctDiscount - discAmt));
  const vatAmt = round2(subtotal * (vatPct / 100));
  const lineTotal = round2(subtotal + vatAmt);
  return {
    productId: Math.trunc(num(line.productId, 0)),
    qty,
    focQty: num(line.focQty, 0),
    unitCost,
    unitName: str(line.unitName ?? line.packetDetails, 50) || 'Pcs',
    discountPercentage: discPct,
    discountAmount: discAmt,
    subtotalAmount: subtotal,
    inputTax1Amount: vatAmt,
    inputTax1Rate: vatPct,
    lineTotal,
    ownRefNo: str(line.ownRefNo, 50),
    supplierRefNo: str(line.supplierRefNo, 50),
    purchasedQty: num(line.purchasedQty, 0),
  };
}

function normalizeReturnInput(body) {
  const lines = (Array.isArray(body.lines) ? body.lines : []).filter((line) => {
    const rq = num(line.returnQty ?? line.qty, 0);
    return rq !== 0;
  });
  if (!lines.length) {
    const err = new Error('At least one return line is required');
    err.status = 400;
    throw err;
  }
  const normalized = lines.map((line, i) => {
    const L = computeLineFromReturnQty(line);
    if (L.qty >= 0) {
      const err = new Error(`Line ${i + 1}: return quantity must be > 0 (stored as negative)`);
      err.status = 400;
      throw err;
    }
    if (!L.productId) {
      const err = new Error(`Line ${i + 1}: product is required`);
      err.status = 400;
      throw err;
    }
    return L;
  });

  const sumSub = round2(normalized.reduce((s, L) => s + round2(L.subtotalAmount || 0), 0));
  const sumTax = round2(normalized.reduce((s, L) => s + round2(L.inputTax1Amount || 0), 0));
  const roundOff = round2(num(body.roundOffAdjustment ?? body.roundOff, 0));
  const { headerDiscAmt, headerDiscPct } = resolveHeaderDiscountFromBody(body, Math.abs(sumSub));
  const amounts = computePurchaseAmounts(
    normalized.map((L) => ({
      subtotalAmount: L.subtotalAmount,
      inputTax1Rate: L.inputTax1Rate,
      inputTax1Amount: L.inputTax1Amount,
    })),
    { headerDiscAmt, headerDiscPct, roundOff: -Math.abs(roundOff) === roundOff ? roundOff : -Math.abs(roundOff) },
  );
  let headerDisc = amounts.headerDisc;
  if (sumSub < 0 && headerDisc > 0) headerDisc = -headerDisc;

  const netExpected = round2(amounts.net);
  const netClient = round2(num(body.netAmount, netExpected));
  const invoiceAmount = round2(num(body.invoiceAmount, Math.abs(netClient)));

  return {
    normalized,
    sumSub,
    sumTax: amounts.sumTax,
    netClient,
    invoiceAmount,
    headerDisc: sumSub < 0 ? -absAmt(headerDisc) : headerDisc,
    roundOff: amounts.net - amounts.subAfterDisc - amounts.sumTax + (sumSub < 0 ? -absAmt(headerDisc) : amounts.headerDisc),
  };
}

async function resolveReturnExemptCrLedger(taxableId, exemptId, warnings) {
  if (exemptId && exemptId !== taxableId) return exemptId;
  if (exemptId === taxableId) {
    warnings.push('Purchase return CR — Exempted uses same ledger as taxable.');
  }
  return taxableId;
}

function resolveReturnSupplierDebit(invoiceAmount, amtTaxable, amtExempt, sumTax, headerDisc, roundOff, warnings) {
  const computed = round2(amtTaxable + amtExempt + sumTax - headerDisc + roundOff);
  const debit = absAmt(computed);
  if (Math.abs(absAmt(invoiceAmount) - debit) > 0.05) {
    warnings.push(
      `Invoice amount ${absAmt(invoiceAmount).toFixed(2)} differs from line totals ${debit.toFixed(2)} — supplier debit uses ${debit.toFixed(2)}.`,
    );
    return debit;
  }
  return absAmt(invoiceAmount);
}

async function resolveReturnVoucherLinePlan(client, companyId, branchId, {
  returnNo, supplierId, normalized, body, invoiceAmount, paymentModeLabel,
}) {
  const warnings = [];
  await accountsParameterRepo.ensureBranchIntegrationDefaults(client, companyId, branchId);

  const supplierLedgerId = await partyLedgerService.ensureSupplierLedgerForId(
    client, companyId, branchId, supplierId,
  );
  const { taxable: amtTaxable, exempt: amtExempt } = splitTaxableSubtotals(normalized);
  const baseSub = round2(normalized.reduce((s, L) => s + round2(L.subtotalAmount || 0), 0));
  const { headerDiscAmt, headerDiscPct } = resolveHeaderDiscountFromBody(body, Math.abs(baseSub));
  const roundOff = round2(num(body.roundOffAdjustment, 0));
  const amounts = computePurchaseAmounts(normalized, { headerDiscAmt, headerDiscPct, roundOff });
  let headerDisc = amounts.headerDisc;
  if (baseSub < 0 && headerDisc > 0) headerDisc = -headerDisc;
  const adjSumTax = amounts.sumTax;

  const purchaseCrTaxableId = await resolvePurchaseCrLedger(client, companyId, branchId, paymentModeLabel, { taxable: true });
  const purchaseCrExemptId = Math.abs(amtExempt) > 0.001
    ? await resolvePurchaseCrLedger(client, companyId, branchId, paymentModeLabel, { taxable: false })
    : null;
  const inputTaxLedgerId = Math.abs(adjSumTax) > 0.001 ? await resolveInputTaxLedger(client, companyId, branchId) : null;
  const discountLedgerId = Math.abs(headerDisc) > 0.001
    ? await resolvePurchaseReturnDiscountLedger(client, companyId, branchId)
    : null;
  const roundLedgerId = roundOff !== 0
    ? await resolvePurchaseReturnRoundingLedger(client, companyId, branchId)
    : null;

  const hasPurchaseCr = purchaseCrTaxableId != null || (Math.abs(amtExempt) > 0.001 && purchaseCrExemptId != null);
  const lines = [];
  const pushCr = (accountId, amount, narration) => {
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

  if (!supplierLedgerId || !hasPurchaseCr) {
    warnings.push('Return not posted — configure supplier ledger and purchase return CR ledger in Account Integration');
    return { lines, warnings, supplierLedgerId, hasLedgers: false, supplierDebit: absAmt(invoiceAmount) };
  }

  if (Math.abs(amtTaxable) > 0.001) {
    pushCr(purchaseCrTaxableId, absAmt(amtTaxable), `PRT taxable: ${returnNo}`);
  }
  if (Math.abs(amtExempt) > 0.001) {
    const exId = await resolveReturnExemptCrLedger(purchaseCrTaxableId, purchaseCrExemptId, warnings);
    if (exId) pushCr(exId, absAmt(amtExempt), `PRT exempt (0%): ${returnNo}`);
  }
  if (Math.abs(amtTaxable) <= 0.001 && Math.abs(amtExempt) <= 0.001) {
    pushCr(purchaseCrTaxableId, absAmt(invoiceAmount) - absAmt(adjSumTax), `PRT: ${returnNo}`);
  }

  if (Math.abs(headerDisc) > 0.001 && discountLedgerId) {
    pushDr(discountLedgerId, absAmt(headerDisc), `PRT discount: ${returnNo}`);
  }
  if (roundOff > 0 && roundLedgerId) {
    pushCr(roundLedgerId, absAmt(roundOff), `PRT round: ${returnNo}`);
  } else if (roundOff < 0 && roundLedgerId) {
    pushDr(roundLedgerId, absAmt(roundOff), `PRT round: ${returnNo}`);
  }
  if (Math.abs(adjSumTax) > 0.001 && inputTaxLedgerId) {
    pushCr(inputTaxLedgerId, absAmt(adjSumTax), `PRT input tax: ${returnNo}`);
  } else if (Math.abs(adjSumTax) > 0.001) {
    warnings.push('Input tax ledger not configured — tax added to purchase CR');
    pushCr(purchaseCrTaxableId || purchaseCrExemptId, absAmt(adjSumTax), `PRT tax: ${returnNo}`);
  }

  const supplierDebit = resolveReturnSupplierDebit(
    invoiceAmount, amtTaxable, amtExempt, adjSumTax, headerDisc, roundOff, warnings,
  );
  // Voucher detail O/S must be >= 0 (DB constraint); purchase_master stores negative payable reduction.
  pushDr(supplierLedgerId, supplierDebit, `PRT: ${returnNo}`, supplierDebit);

  return {
    lines,
    warnings,
    supplierLedgerId,
    hasLedgers: true,
    supplierDebit,
  };
}

async function writeReturnAccounting(client, args) {
  const {
    companyId, branchId, purchaseId, returnNo, returnDate, supplierId,
    normalized, body, invoiceAmount, auditBy,
    existingVoucherMasterId = null,
    existingVoucherPostStatus = null,
  } = args;

  const paymentModeLabel = str(body.paymentMode, 50) || 'CASH';
  const linePlan = await resolveReturnVoucherLinePlan(client, companyId, branchId, {
    returnNo, supplierId, normalized, body, invoiceAmount, paymentModeLabel,
  });

  if (!linePlan.hasLedgers || !linePlan.lines.length) {
    return { voucherMasterId: null, outstandingBalance: -absAmt(invoiceAmount), warnings: linePlan.warnings };
  }

  const voucherTypeId =
    (await voucherRepo.getVoucherTypeId(client, companyId, 'PurchaseReturnVoucherName', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(client, companyId, 'PRT'))
    || 7;
  const voucherPrefix = await voucherRepo.getVoucherPrefix(client, companyId, voucherTypeId) || 'PRT-';

  let voucherMasterId = existingVoucherMasterId;
  const canReplace = voucherMasterId != null && String(existingVoucherPostStatus || '').toUpperCase() !== 'POSTED';

  if (canReplace) {
    await voucherRepo.updateVoucherMaster(client, companyId, branchId, voucherMasterId, {
      voucherDate: returnDate,
      referenceNo: String(returnNo),
      voucherAmount: absAmt(invoiceAmount),
      remarks: `PRT: ${returnNo}`,
    });
    await voucherRepo.deleteVoucherDetails(client, companyId, branchId, voucherMasterId);
  } else if (!voucherMasterId) {
    voucherMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
    const autoNo = await voucherRepo.nextAutoVoucherNo(client, companyId, branchId, voucherTypeId);
    await voucherRepo.insertVoucherMaster(client, {
      companyId, branchId,
      voucherMasterId,
      voucherTypeId,
      autoVoucherNo: autoNo,
      voucherPrefix,
      voucherDate: returnDate,
      referenceNo: String(returnNo),
      voucherAmount: absAmt(invoiceAmount),
      remarks: `PRT: ${returnNo}`,
      postStatus: 'PENDING',
      creationMode: 'INVENTORYACCOUNTS',
      voucherPostedId: purchaseId,
      counterCloseNo: 'PENDING',
      recordStatus: 'ACTIVE',
      createdBy: auditBy,
    });
  }

  let detailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);
  for (const line of linePlan.lines) {
    await voucherRepo.insertVoucherDetail(client, {
      companyId, branchId,
      voucherDetailId: detailSeq++,
      voucherMasterId,
      accountId: line.accountId,
      creditAmount: line.creditAmount,
      debitAmount: line.debitAmount,
      outstandingBalance: line.outstandingBalance,
      narration: line.narration,
      postStatus: existingVoucherPostStatus === 'POSTED' ? 'POSTED' : 'PENDING',
      recordStatus: 'ACTIVE',
      createdBy: auditBy,
    });
  }

  return {
    voucherMasterId,
    outstandingBalance: -round2(linePlan.supplierDebit ?? absAmt(invoiceAmount)),
    warnings: linePlan.warnings,
  };
}

async function insertReturnLines(client, { companyId, branchId, purchaseId, normalized, userLabel }) {
  for (const L of normalized) {
    const purchaseChildId = await returnRepo.nextPurchaseChildId(client, companyId);
    await returnRepo.insertPurchaseChild(client, {
      companyId,
      purchaseChildId,
      purchaseId,
      branchId,
      productId: L.productId,
      ownRefNo: L.ownRefNo,
      supplierRefNo: L.supplierRefNo,
      packQty: 1,
      qty: L.qty,
      unitCost: L.unitCost,
      unitName: L.unitName,
      focQty: L.focQty,
      focAmount: 0,
      discountPercentage: L.discountPercentage,
      discountAmount: L.discountAmount,
      lineAmount: L.lineTotal,
      subtotalAmount: L.subtotalAmount,
      inputTax1Amount: L.inputTax1Amount,
      inputTax1Rate: L.inputTax1Rate,
      inputTax2Amount: 0,
      inputTax3Amount: 0,
      inputTax2Rate: 0,
      inputTax3Rate: 0,
      currencyRate: 1,
      unitCostBc: L.unitCost,
      recordStatus: 'ACTIVE',
      createdBy: userLabel,
      modifiedBy: userLabel,
    });
  }
}

async function applyReturnStock(client, authStaff, companyId, branchId, purchaseId, normalized) {
  const warnings = [];
  try {
    await client.query('SAVEPOINT return_stock');
    for (const L of normalized) {
      const outQty = L.qty + L.focQty;
      if (outQty >= 0) continue;
      await stockRepo.applyStockMovement(client, {
        companyId, branchId,
        productId: L.productId,
        transactionType: 'PURCHASE_RETURN',
        transactionId: purchaseId,
        qty: outQty,
        unitCost: L.unitCost,
        unitPrice: 0,
        createdBy: auditStaffId(authStaff),
      });
    }
    await client.query('RELEASE SAVEPOINT return_stock');
  } catch (stockErr) {
    await client.query('ROLLBACK TO SAVEPOINT return_stock');
    warnings.push(`Stock update skipped: ${stockErr.message}`);
  }
  return warnings;
}

export async function loadSourcePurchase(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const purchaseNo = str(query.purchaseNo, 50);
  if (!purchaseNo) {
    const err = new Error('purchaseNo is required');
    err.status = 400;
    throw err;
  }

  const source = await returnRepo.getSourcePurchaseForReturn(pool, companyId, branchId, purchaseNo);
  if (!source) {
    const err = new Error('Purchase bill not found for this branch');
    err.status = 404;
    throw err;
  }

  const lineRows = await returnRepo.listPurchaseLines(pool, companyId, Number(source.purchase_id));
  return {
    sourcePurchaseId: Number(source.purchase_id),
    sourcePurchaseNo: source.purchase_no != null ? String(source.purchase_no) : purchaseNo,
    supplierId: source.supplier_id != null ? Number(source.supplier_id) : null,
    supplierInvoiceNo: source.supplier_invoice_no ?? null,
    paymentMode: source.payment_mode ?? 'CASH',
    purchaseDate: source.purchase_date,
    invoiceAmount: source.invoice_amount != null ? String(source.invoice_amount) : '0',
    lines: lineRows.map((row) => ({
      productId: row.product_id != null ? Number(row.product_id) : null,
      productCode: row.product_code ?? null,
      shortDescription: row.short_name ?? row.product_name ?? null,
      purchasedQty: row.qty != null ? String(row.qty) : '0',
      returnQty: '0',
      qty: '0',
      unitCost: row.unit_cost != null ? String(row.unit_cost) : '0',
      unitName: row.unit_name ?? 'Pcs',
      discountPercentage: row.discount_percentage != null ? String(row.discount_percentage) : '0',
      discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
      subtotalAmount: '0',
      inputTax1Rate: row.input_tax_1_rate != null ? String(row.input_tax_1_rate) : '0',
      inputTax1Amount: '0',
      lineAmount: '0',
      total: '0',
      sourcePurchaseChildId: Number(row.purchase_child_id),
    })),
  };
}

export async function listPurchaseReturns(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const { lim, off } = parseLimitOffset(query);
  const rows = await returnRepo.listReturnsByBranch(pool, companyId, branchId, lim, off, {
    dateFrom: parseOptionalISODate(query.dateFrom),
    dateTo: parseOptionalISODate(query.dateTo),
  });
  return rows.map(mapReturnMaster);
}

export async function lookupPurchaseReturn(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const result = await returnRepo.findReturnByLookup(pool, companyId, branchId, {
    returnNo: query.returnNo ?? query.purchaseNo,
    supplierInvoiceNo: query.supplierInvoiceNo,
  });
  if (result.kind === 'not_found') {
    const err = new Error('Purchase return not found');
    err.status = 404;
    throw err;
  }
  if (result.kind === 'ambiguous') {
    const err = new Error(`Multiple returns match — enter Return # (${result.count} found)`);
    err.status = 409;
    throw err;
  }
  return result;
}

export async function getPurchaseReturn(pool, authStaff, purchaseIdParam, query) {
  const companyId = Number(authStaff.company_id);
  const purchaseId = Math.trunc(num(purchaseIdParam, 0));
  if (purchaseId < 1) {
    const err = new Error('Invalid purchaseId');
    err.status = 400;
    throw err;
  }
  const master = await returnRepo.getReturnMaster(pool, companyId, purchaseId);
  if (!master) {
    const err = new Error('Purchase return not found');
    err.status = 404;
    throw err;
  }
  let branchId = parseBranchId(query?.branchId);
  if (branchId == null) branchId = Number(master.branch_id);
  if (Number(master.branch_id) !== branchId) {
    const err = new Error('Return belongs to a different branch');
    err.status = 400;
    throw err;
  }
  const lineRows = await returnRepo.listPurchaseLines(pool, companyId, purchaseId);
  const mappedLines = lineRows.map((row) => {
    const m = mapReturnLine(row);
    if (master.source_purchase_id) {
      m.purchasedQty = m.purchasedQty ?? null;
    }
    return m;
  });
  return {
    ...mapReturnMaster(master),
    lines: mappedLines.filter(Boolean),
    purchasePosted: String(master.post_status || '').toUpperCase() === 'POSTED',
  };
}

export async function createPurchaseReturn(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(body.branchId);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const supplierId = Math.trunc(num(body.supplierId, 0));
  if (supplierId < 1) {
    const err = new Error('supplierId is required');
    err.status = 400;
    throw err;
  }
  const okSup = await supplierRepo.supplierExists(pool, companyId, supplierId);
  if (!okSup) {
    const err = new Error('Supplier not found');
    err.status = 400;
    throw err;
  }

  const withInvoice = Boolean(body.withInvoice ?? body.againstInvoice);
  const sourcePurchaseId = withInvoice ? nullableLong(body.sourcePurchaseId) : null;
  const sourcePurchaseNo = withInvoice ? str(body.sourcePurchaseNo, 50) || null : null;

  const { normalized, sumSub, sumTax, netClient, invoiceAmount, headerDisc, roundOff } = normalizeReturnInput(body);
  const returnDate = body.purchaseDate ? new Date(body.purchaseDate) : new Date();
  const paymentModeLabel = str(body.paymentMode, 50) || 'CASH';
  const auditBy = auditStaffId(authStaff);
  const userLabel = auditUserName(authStaff);

  return withTransaction(async (client) => {
    const purchaseId = await returnRepo.nextReturnId(client, companyId);
    const returnDocNo = await returnRepo.nextReturnNo(client, companyId, branchId);
    const { purchaseNo, returnNo } = resolveReturnMasterNumbers({
      withInvoice,
      sourcePurchaseNo,
      returnDocNo,
    });

    await returnRepo.insertReturnMaster(client, {
      companyId, purchaseId, branchId, supplierId,
      purchaseDate: returnDate,
      purchaseNo,
      supplierInvoiceNo: str(body.supplierInvoiceNo, 50) || null,
      invoiceAmount,
      outstandingBalance: -absAmt(invoiceAmount),
      paymentMode: paymentModeLabel,
      postStatus: 'DRAFT',
      discountAmount: headerDisc,
      roundOffAdjustment: roundOff,
      remarks: str(body.remark ?? body.remarks, 200),
      subtotalAmount: sumSub,
      inputTax1Amount: sumTax,
      inputTax1Rate: sumSub !== 0 ? round2((sumTax / Math.abs(sumSub)) * 100) : 0,
      netVat: sumTax,
      itemsTotalBc: netClient,
      returnNo,
      sourcePurchaseId,
      createdBy: userLabel,
      modifiedBy: userLabel,
    });

    await insertReturnLines(client, { companyId, branchId, purchaseId, normalized, userLabel });
    const stockWarnings = await applyReturnStock(client, authStaff, companyId, branchId, purchaseId, normalized);

    const acct = await writeReturnAccounting(client, {
      companyId, branchId, purchaseId, returnNo: returnDocNo, returnDate, supplierId,
      normalized, body: { ...body, paymentMode: paymentModeLabel, roundOffAdjustment: roundOff, discountAmount: headerDisc },
      invoiceAmount: absAmt(invoiceAmount), auditBy,
    });

    await returnRepo.updateReturnMaster(client, companyId, purchaseId, branchId, {
      supplierId,
      purchaseDate: returnDate,
      purchaseNo,
      supplierInvoiceNo: str(body.supplierInvoiceNo, 50) || null,
      invoiceAmount,
      outstandingBalance: acct.outstandingBalance ?? -absAmt(invoiceAmount),
      paymentMode: paymentModeLabel,
      remarks: str(body.remark ?? body.remarks, 200),
      discountAmount: headerDisc,
      roundOffAdjustment: roundOff,
      subtotalAmount: sumSub,
      inputTax1Amount: sumTax,
      inputTax1Rate: sumSub !== 0 ? round2((sumTax / Math.abs(sumSub)) * 100) : 0,
      netVat: sumTax,
      itemsTotalBc: netClient,
      returnNo,
      sourcePurchaseId,
      modifiedBy: userLabel,
    });

    return {
      purchaseId,
      returnNo: returnDocNo,
      purchaseNo,
      sourcePurchaseNo,
      sourcePurchaseId,
      branchId,
      netAmount: netClient.toFixed(2),
      invoiceAmount: invoiceAmount.toFixed(2),
      outstandingBalance: round2(acct.outstandingBalance ?? -absAmt(netClient)).toFixed(2),
      accountsPosted: acct.voucherMasterId != null,
      warnings: [...stockWarnings, ...(acct.warnings || [])].filter(Boolean),
    };
  });
}

function nullableLong(v) {
  const n = num(v, 0);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

export async function updatePurchaseReturn(pool, body, authStaff, purchaseIdParam) {
  const companyId = Number(authStaff.company_id);
  const purchaseId = Math.trunc(num(purchaseIdParam, 0));
  const branchId = parseBranchId(body.branchId);
  if (purchaseId < 1 || branchId == null) {
    const err = new Error('Invalid purchase return');
    err.status = 400;
    throw err;
  }

  const existing = await returnRepo.getReturnMaster(pool, companyId, purchaseId);
  if (!existing) {
    const err = new Error('Purchase return not found');
    err.status = 404;
    throw err;
  }
  if (String(existing.post_status || '').toUpperCase() === 'POSTED') {
    const err = new Error('Posted return cannot be edited — unpost first');
    err.status = 409;
    throw err;
  }

  const supplierId = Math.trunc(num(body.supplierId, existing.supplier_id));
  const withInvoice = Boolean(body.withInvoice ?? body.againstInvoice ?? existing.source_purchase_id);
  const sourcePurchaseId = withInvoice
    ? nullableLong(body.sourcePurchaseId) ?? (existing.source_purchase_id != null ? Number(existing.source_purchase_id) : null)
    : null;
  const sourcePurchaseNo = withInvoice
    ? str(body.sourcePurchaseNo, 50) || againstPurchaseNoFromRow(existing)
    : null;
  const { normalized, sumSub, sumTax, netClient, invoiceAmount, headerDisc, roundOff } = normalizeReturnInput(body);
  const returnDate = body.purchaseDate ? new Date(body.purchaseDate) : new Date(existing.purchase_date);
  const paymentModeLabel = str(body.paymentMode ?? existing.payment_mode, 50) || 'CASH';
  const returnDocNo = returnDocNoFromRow(existing);
  const { purchaseNo, returnNo } = resolveReturnMasterNumbers({
    withInvoice,
    sourcePurchaseNo,
    returnDocNo,
  });
  const auditBy = auditStaffId(authStaff);
  const userLabel = auditUserName(authStaff);

  return withTransaction(async (client) => {
    await returnRepo.softDeletePurchaseChildren(client, companyId, purchaseId);
    await insertReturnLines(client, { companyId, branchId, purchaseId, normalized, userLabel });
    await applyReturnStock(client, authStaff, companyId, branchId, purchaseId, normalized);

    const vouchers = await voucherRepo.listVouchersByPostedId(client, companyId, branchId, purchaseId, 'INVENTORYACCOUNTS');
    const existingVm = vouchers[0]?.master;

    const acct = await writeReturnAccounting(client, {
      companyId, branchId, purchaseId, returnNo: returnDocNo, returnDate, supplierId,
      normalized, body: { ...body, paymentMode: paymentModeLabel, roundOffAdjustment: roundOff, discountAmount: headerDisc },
      invoiceAmount: absAmt(invoiceAmount), auditBy,
      existingVoucherMasterId: existingVm?.voucher_master_id != null ? Number(existingVm.voucher_master_id) : null,
      existingVoucherPostStatus: existingVm?.post_status ?? null,
    });

    await returnRepo.updateReturnMaster(client, companyId, purchaseId, branchId, {
      supplierId,
      purchaseDate: returnDate,
      purchaseNo,
      supplierInvoiceNo: str(body.supplierInvoiceNo, 50) || existing.supplier_invoice_no,
      invoiceAmount,
      outstandingBalance: acct.outstandingBalance ?? -absAmt(invoiceAmount),
      paymentMode: paymentModeLabel,
      remarks: str(body.remark ?? body.remarks, 200),
      discountAmount: headerDisc,
      roundOffAdjustment: roundOff,
      subtotalAmount: sumSub,
      inputTax1Amount: sumTax,
      inputTax1Rate: sumSub !== 0 ? round2((sumTax / Math.abs(sumSub)) * 100) : 0,
      netVat: sumTax,
      itemsTotalBc: netClient,
      returnNo,
      sourcePurchaseId,
      modifiedBy: userLabel,
    });

    return {
      purchaseId,
      returnNo: returnDocNo,
      purchaseNo,
      sourcePurchaseNo,
      sourcePurchaseId,
      updated: true,
      netAmount: netClient.toFixed(2),
      outstandingBalance: round2(acct.outstandingBalance ?? -absAmt(netClient)).toFixed(2),
    };
  });
}

export async function postPurchaseReturn(pool, authStaff, purchaseIdParam, query) {
  const companyId = Number(authStaff.company_id);
  const purchaseId = Math.trunc(num(purchaseIdParam, 0));
  let branchId = parseBranchId(query?.branchId);
  const existing = await returnRepo.getReturnMaster(pool, companyId, purchaseId);
  if (!existing) {
    const err = new Error('Purchase return not found');
    err.status = 404;
    throw err;
  }
  if (branchId == null) branchId = Number(existing.branch_id);

  return withTransaction(async (client) => {
    const vouchers = await voucherRepo.listVouchersByPostedId(client, companyId, branchId, purchaseId, 'INVENTORYACCOUNTS');
    const vm = vouchers[0]?.master;
    if (vm?.voucher_master_id) {
      await voucherRepo.updateVoucherPostStatus(client, companyId, branchId, Number(vm.voucher_master_id), 'POSTED');
    }
    await returnRepo.updatePurchasePostStatus(client, companyId, purchaseId, branchId, 'POSTED');
    return {
      purchaseId,
      returnNo: returnDocNoFromRow(existing),
      purchasePosted: true,
    };
  });
}

export async function unpostPurchaseReturn(pool, authStaff, purchaseIdParam, query) {
  const companyId = Number(authStaff.company_id);
  const purchaseId = Math.trunc(num(purchaseIdParam, 0));
  let branchId = parseBranchId(query?.branchId);
  const existing = await returnRepo.getReturnMaster(pool, companyId, purchaseId);
  if (!existing) {
    const err = new Error('Purchase return not found');
    err.status = 404;
    throw err;
  }
  if (branchId == null) branchId = Number(existing.branch_id);

  return withTransaction(async (client) => {
    const vouchers = await voucherRepo.listVouchersByPostedId(client, companyId, branchId, purchaseId, 'INVENTORYACCOUNTS');
    const vm = vouchers[0]?.master;
    if (vm?.voucher_master_id) {
      await voucherRepo.updateVoucherPostStatus(client, companyId, branchId, Number(vm.voucher_master_id), 'PENDING');
    }
    await returnRepo.updatePurchasePostStatus(client, companyId, purchaseId, branchId, 'DRAFT');
    return { purchaseId, returnNo: returnDocNoFromRow(existing), unposted: true };
  });
}

async function loadReturnLinesForAccounting(client, companyId, purchaseId) {
  const { rows } = await client.query(
    `SELECT product_id, qty, foc_qty, unit_cost, discount_percentage, discount_amount,
            subtotal_amount, input_tax_1_amount, input_tax_1_rate
     FROM ops.purchase_child
     WHERE company_id = $1 AND purchase_id = $2
       AND (record_status IS NULL OR record_status = 'ACTIVE')`,
    [companyId, purchaseId],
  );
  return rows.map((r) => ({
    productId: Math.trunc(num(r.product_id, 0)),
    qty: num(r.qty, 0),
    focQty: num(r.foc_qty, 0),
    unitCost: num(r.unit_cost, 0),
    discountPercentage: num(r.discount_percentage, 0),
    discountAmount: num(r.discount_amount, 0),
    subtotalAmount: num(r.subtotal_amount, 0),
    inputTax1Amount: num(r.input_tax_1_amount, 0),
    inputTax1Rate: num(r.input_tax_1_rate, 0),
  }));
}

async function syncReturnAccountsVoucher(client, companyId, branchId, purchaseId, auditBy) {
  const existing = await returnRepo.getReturnMaster(client, companyId, purchaseId);
  if (!existing) return null;
  if (String(existing.post_status || '').toUpperCase() === 'POSTED') return null;

  const vouchers = await voucherRepo.listVouchersByPostedId(client, companyId, branchId, purchaseId, 'INVENTORYACCOUNTS');
  const existingVm = vouchers[0]?.master;

  const normalized = await loadReturnLinesForAccounting(client, companyId, purchaseId);
  if (!normalized.length) return null;

  const body = {
    paymentMode: str(existing.payment_mode, 50) || 'CASH',
    discountAmount: num(existing.discount_amount, 0),
    roundOffAdjustment: num(existing.round_off_adjustment, 0),
    netAmount: num(existing.items_total_bc, num(existing.invoice_amount, 0)),
  };

  return writeReturnAccounting(client, {
    companyId,
    branchId,
    purchaseId,
    returnNo: returnDocNoFromRow(existing),
    returnDate: existing.purchase_date ? new Date(existing.purchase_date) : new Date(),
    supplierId: Math.trunc(num(existing.supplier_id, 0)),
    normalized,
    body,
    invoiceAmount: absAmt(num(existing.invoice_amount, 0)),
    auditBy,
    existingVoucherMasterId: existingVm?.voucher_master_id != null ? Number(existingVm.voucher_master_id) : null,
    existingVoucherPostStatus: existingVm?.post_status ?? null,
  });
}

async function enrichVoucherLinesWithAccountHeads(db, companyId, lines) {
  const out = [];
  for (const line of lines) {
    const head = line.accountId ? await accountHeadRepo.findAccountHead(db, companyId, line.accountId) : null;
    out.push({
      accountId: line.accountId,
      accountNo: head?.account_no ?? head?.accountNo ?? '',
      accountHead: head?.account_head ?? head?.accountHead ?? '',
      debitAmount: num(line.debitAmount, 0),
      creditAmount: num(line.creditAmount, 0),
      outstandingBalance: num(line.outstandingBalance, 0),
      narration: line.narration || '',
    });
  }
  return out;
}

function supplierReturnOutstandingFromVoucher(mappedVoucher, fallback = null) {
  if (!mappedVoucher?.lines?.length) {
    return fallback != null ? -absAmt(fallback) : 0;
  }
  const supplierLines = mappedVoucher.lines.filter(
    (l) => num(l.debitAmount, 0) > 0.001 && Math.abs(num(l.outstandingBalance, 0)) > 0.001,
  );
  if (supplierLines.length) {
    const sum = supplierLines.reduce((s, l) => s + num(l.outstandingBalance, 0), 0);
    return sum > 0 ? -round2(sum) : round2(sum);
  }
  return fallback != null ? -absAmt(fallback) : 0;
}

function mapReturnVoucherForApi(voucher) {
  const mapped = mapVoucherToApi(voucher);
  if (!mapped?.lines?.length) return mapped;
  mapped.lines = mapped.lines.map((line) => {
    if (num(line.debitAmount, 0) > 0.001 && num(line.outstandingBalance, 0) > 0.001) {
      return { ...line, outstandingBalance: -Math.abs(num(line.outstandingBalance, 0)) };
    }
    return line;
  });
  return mapped;
}

function mapVoucherToApi(voucher) {
  if (!voucher?.master) return null;
  const m = voucher.master;
  return {
    voucherMasterId: Number(m.voucher_master_id),
    voucherNo: `${m.voucher_prefix || ''}${m.auto_voucher_no || ''}`,
    voucherTypeCode: m.voucher_type_code || '',
    voucherName: m.voucher_name || '',
    postStatus: m.post_status || 'PENDING',
    voucherDate: m.voucher_date,
    referenceNo: m.reference_no,
    voucherAmount: m.voucher_amount != null ? String(m.voucher_amount) : '0',
    remarks: m.remarks || '',
    lines: (voucher.details || []).map((d) => ({
      accountId: Number(d.account_id),
      accountNo: d.account_no || '',
      accountHead: d.account_head || '',
      debitAmount: num(d.debit_amount, 0),
      creditAmount: num(d.credit_amount, 0),
      outstandingBalance: num(d.outstanding_balance, 0),
      narration: d.narration || '',
    })),
  };
}

async function findReturnVoucher(db, companyId, branchId, purchaseId) {
  const vouchers = await voucherRepo.listVouchersByPostedId(db, companyId, branchId, purchaseId, 'INVENTORYACCOUNTS');
  return vouchers[0] || null;
}

export async function getPurchaseReturnAccounts(pool, authStaff, purchaseId, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query?.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const pid = Math.trunc(num(purchaseId, 0));
  if (pid < 1) {
    const err = new Error('Invalid purchaseId');
    err.status = 400;
    throw err;
  }
  const master = await returnRepo.getReturnMaster(pool, companyId, pid);
  if (!master) {
    const err = new Error('Purchase return not found');
    err.status = 404;
    throw err;
  }
  if (Number(master.branch_id) !== branchId) {
    const err = new Error('Return belongs to a different branch');
    err.status = 400;
    throw err;
  }

  let masterRow = master;
  if (String(masterRow.post_status || '').toUpperCase() !== 'POSTED' && String(query?.sync ?? '1') !== '0') {
    try {
      await withTransaction(async (client) => {
        await syncReturnAccountsVoucher(client, companyId, branchId, pid, auditStaffId(authStaff));
      });
      masterRow = await returnRepo.getReturnMaster(pool, companyId, pid);
    } catch (syncErr) {
      console.warn('Return accounts sync skipped:', syncErr.message);
    }
  }

  const returnVoucherRaw = await findReturnVoucher(pool, companyId, branchId, pid);
  const returnVoucher = returnVoucherRaw ? mapReturnVoucherForApi(returnVoucherRaw) : null;
  const outstandingBalance = supplierReturnOutstandingFromVoucher(
    returnVoucher,
    num(masterRow.outstanding_balance, num(masterRow.invoice_amount, 0)),
  );
  return {
    purchaseId: pid,
    branchId,
    returnNo: returnDocNoFromRow(masterRow),
    purchaseNo: againstPurchaseNoFromRow(masterRow) ?? '0',
    sourcePurchaseNo: masterRow.source_purchase_no ?? againstPurchaseNoFromRow(masterRow),
    supplierInvoiceNo: masterRow.supplier_invoice_no ?? null,
    invoiceAmount: masterRow.invoice_amount != null ? String(Math.abs(num(masterRow.invoice_amount, 0))) : '0',
    paymentMode: masterRow.payment_mode ?? null,
    outstandingBalance: outstandingBalance.toFixed(2),
    paymentDone: false,
    purchasePosted: returnVoucher != null && returnVoucher.postStatus === 'POSTED',
    returnPosted: returnVoucher != null && returnVoucher.postStatus === 'POSTED',
    purchaseVoucher: returnVoucher,
    returnVoucher,
    paymentVoucher: null,
    accountsPosted: returnVoucher != null,
  };
}

export async function previewPurchaseReturnAccounts(pool, authStaff, purchaseIdParam, body, query) {
  const companyId = Number(authStaff.company_id);
  const purchaseId = Math.trunc(num(purchaseIdParam, 0));
  if (purchaseId < 1) {
    const err = new Error('Invalid purchaseId');
    err.status = 400;
    throw err;
  }
  const existing = await returnRepo.getReturnMaster(pool, companyId, purchaseId);
  if (!existing) {
    const err = new Error('Purchase return not found');
    err.status = 404;
    throw err;
  }
  let branchId = parseBranchId(query?.branchId);
  if (branchId == null) branchId = Number(existing.branch_id);
  if (Number(existing.branch_id) !== branchId) {
    const err = new Error('Return belongs to a different branch');
    err.status = 400;
    throw err;
  }
  if (String(existing.post_status || '').toUpperCase() === 'POSTED') {
    return getPurchaseReturnAccounts(pool, authStaff, purchaseId, query);
  }
  const { normalized, invoiceAmount } = normalizeReturnInput(body);
  const paymentModeLabel = str(body.paymentMode ?? existing.payment_mode, 50) || 'CASH';
  const returnDocNo = returnDocNoFromRow(existing);
  const supplierId = Math.trunc(num(body.supplierId, existing.supplier_id));
  const linePlan = await resolveReturnVoucherLinePlan(pool, companyId, branchId, {
    returnNo: returnDocNo,
    supplierId,
    normalized,
    body,
    invoiceAmount: absAmt(invoiceAmount),
    paymentModeLabel,
  });
  const enrichedLines = await enrichVoucherLinesWithAccountHeads(pool, companyId, linePlan.lines);
  const supplierOs = round2(-(linePlan.supplierDebit ?? absAmt(invoiceAmount)));
  return {
    purchaseId,
    branchId,
    returnNo: returnDocNo,
    purchaseNo: againstPurchaseNoFromRow(existing) ?? '0',
    preview: true,
    invoiceAmount: absAmt(invoiceAmount).toFixed(2),
    outstandingBalance: supplierOs.toFixed(2),
    paymentDone: false,
    purchasePosted: false,
    returnPosted: false,
    accountsPosted: enrichedLines.length > 0,
    purchaseVoucher: enrichedLines.length
      ? { voucherNo: 'Preview', postStatus: 'PREVIEW', lines: enrichedLines }
      : null,
    returnVoucher: enrichedLines.length
      ? { voucherNo: 'Preview', postStatus: 'PREVIEW', lines: enrichedLines }
      : null,
    paymentVoucher: null,
    warnings: linePlan.warnings?.length ? linePlan.warnings : undefined,
    message: enrichedLines.length
      ? 'Preview from current entry — save to persist voucher lines.'
      : 'Configure purchase return CR and supplier ledgers in Branch Account Integration.',
  };
}

export async function previewDraftPurchaseReturnAccounts(pool, authStaff, body, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query?.branchId);
  if (branchId == null) branchId = parseBranchId(body?.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const supplierId = Math.trunc(num(body?.supplierId, 0));
  if (supplierId < 1) {
    const err = new Error('supplierId is required');
    err.status = 400;
    throw err;
  }
  const { normalized, invoiceAmount } = normalizeReturnInput(body);
  const paymentModeLabel = str(body.paymentMode, 50) || 'CASH';
  const linePlan = await resolveReturnVoucherLinePlan(pool, companyId, branchId, {
    returnNo: 'Preview',
    supplierId,
    normalized,
    body,
    invoiceAmount: absAmt(invoiceAmount),
    paymentModeLabel,
  });
  const enrichedLines = await enrichVoucherLinesWithAccountHeads(pool, companyId, linePlan.lines);
  const supplierOs = round2(-(linePlan.supplierDebit ?? absAmt(invoiceAmount)));
  return {
    purchaseId: null,
    branchId,
    returnNo: 'Preview',
    purchaseNo: 'Preview',
    preview: true,
    invoiceAmount: absAmt(invoiceAmount).toFixed(2),
    outstandingBalance: supplierOs.toFixed(2),
    paymentDone: false,
    purchasePosted: false,
    returnPosted: false,
    accountsPosted: enrichedLines.length > 0,
    purchaseVoucher: enrichedLines.length
      ? { voucherNo: 'Preview', postStatus: 'PREVIEW', lines: enrichedLines }
      : null,
    returnVoucher: enrichedLines.length
      ? { voucherNo: 'Preview', postStatus: 'PREVIEW', lines: enrichedLines }
      : null,
    paymentVoucher: null,
    warnings: linePlan.warnings?.length ? linePlan.warnings : undefined,
    message: enrichedLines.length
      ? 'Preview from current entry — save to persist voucher lines.'
      : 'Configure purchase return CR and supplier ledgers in Branch Account Integration.',
  };
}
