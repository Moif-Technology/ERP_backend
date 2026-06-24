/**
 * Sales return — negative entry amounts; accounts posted as positive inverse of purchase.
 */
import { withTransaction } from '../../config/db.js';
import * as accountHeadRepo from '../../accounts/repositories/accountHead.repository.js';
import * as accountsParameterRepo from '../../accounts/repositories/accountsParameter.repository.js';
import {
  resolveSalesReturnCrLedger,
  resolveOutputTaxLedger,
  resolveSalesReturnDiscountLedger,
  resolveSalesReturnRoundingLedger,
  splitTaxableSubtotals,
} from '../../accounts/lib/integrationPosting.js';
import * as voucherRepo from '../../accounts/repositories/voucher.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as stockRepo from '../../shared/repositories/stock.repository.js';
import * as customerRepo from '../repositories/customer.repository.js';
import * as returnRepo from '../repositories/salesReturnEntry.repository.js';
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

function againstBillNoFromRow(row) {
  const bno = row?.bill_no != null ? String(row.bill_no).trim() : '';
  if (!bno || bno === '0') return null;
  return bno;
}

function isPostedSourceStatus(postStatus) {
  return String(postStatus ?? '').trim().toUpperCase() === 'POSTED';
}

function assertPostedSourceForInvoiceReturn(sourceRow, docLabel) {
  if (!sourceRow) {
    const err = new Error(`${docLabel} not found for this branch`);
    err.status = 404;
    throw err;
  }
  if (!isPostedSourceStatus(sourceRow.post_status)) {
    const err = new Error(`Only posted ${docLabel.toLowerCase()}s can be used for return with invoice`);
    err.status = 422;
    throw err;
  }
}

async function validateSourceSaleForInvoiceReturn(pool, companyId, branchId, { sourceSalesId, sourceBillNo }) {
  let source = null;
  if (sourceSalesId) {
    source = await returnRepo.getSourceSaleByIdForReturn(pool, companyId, branchId, sourceSalesId);
  } else if (sourceBillNo) {
    source = await returnRepo.getSourceSaleForReturn(pool, companyId, branchId, sourceBillNo);
  }
  assertPostedSourceForInvoiceReturn(source, 'Sales bill');
  return source;
}

function resolveReturnMasterNumbers({ withInvoice, sourceBillNo, returnDocNo }) {
  const srcNo = withInvoice && sourceBillNo ? Number(sourceBillNo) : 0;
  return {
    billNo: Number.isFinite(srcNo) ? srcNo : 0,
    returnNo: returnDocNo,
  };
}

function returnDocNoFromRow(row) {
  return row?.return_no != null ? String(row.return_no) : '';
}

function mapReturnMaster(row) {
  if (!row) return null;
  const returnDocNo = returnDocNoFromRow(row);
  const againstBillNo = againstBillNoFromRow(row);
  return {
    salesId: Number(row.sales_id),
    returnNo: returnDocNo,
    billNo: againstBillNo ?? '0',
    branchId: Number(row.branch_id),
    customerId: row.customer_id != null ? Number(row.customer_id) : null,
    customerName: row.customer_name ?? null,
    sourceSalesId: row.return_sales_id != null ? Number(row.return_sales_id) : null,
    sourceBillNo: row.source_bill_no != null
      ? String(row.source_bill_no)
      : againstBillNo,
    invoiceNo: row.invoice_no ?? null,
    billDate: row.bill_date,
    invoiceAmount: row.amount != null ? String(row.amount) : '0',
    outstandingBalance: row.outstanding_balance != null ? String(row.outstanding_balance) : '0',
    paymentMode: row.payment_mode ?? null,
    postStatus: row.post_status ?? 'DRAFT',
    recordStatus: row.record_status ?? 'ACTIVE',
    remarks: row.remarks ?? null,
    discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
    roundOffAdjustment: row.round_off_adjustment != null ? String(row.round_off_adjustment) : '0',
    withInvoice: row.return_sales_id != null,
  };
}

function mapReturnLine(row) {
  if (!row) return null;
  const qty = num(row.qty, 0);
  return {
    salesChildId: Number(row.sales_child_id),
    productId: row.product_id != null ? Number(row.product_id) : null,
    productCode: row.product_code ?? null,
    shortDescription: row.short_description ?? row.short_name ?? row.product_name ?? null,
    soldQty: row.sold_qty != null ? String(row.sold_qty) : (row.soldQty != null ? String(row.soldQty) : null),
    qty: String(qty),
    returnQty: String(Math.abs(qty) || qty),
    focQty: row.foc_qty != null ? String(row.foc_qty) : '0',
    unitPrice: row.unit_price != null ? String(row.unit_price) : '0',
    unitCost: row.unit_cost != null ? String(row.unit_cost) : '0',
    packQty: row.pack_qty != null ? String(row.pack_qty) : '1',
    discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
    subtotalAmount: row.subtotal_amount != null ? String(row.subtotal_amount) : '0',
    tax1Amount: row.tax_1_amount != null ? String(row.tax_1_amount) : '0',
    tax1Rate: row.tax_1_rate != null ? String(row.tax_1_rate) : '0',
    lineTotal: row.line_total != null ? String(row.line_total) : '0',
    total: row.line_total != null ? String(row.line_total) : '0',
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
  const unitPrice = num(line.actualCost ?? line.unitPrice, 0);
  const discPct = num(line.discPct ?? line.discountPercentage, 0);
  const discAmt = num(line.discAmt ?? line.discountAmount, 0);
  const vatPct = num(line.vatPct ?? line.tax1Rate, 0);
  const gross = Math.abs(qty) * unitPrice;
  const pctDiscount = gross * (discPct / 100);
  const subtotal = round2(-Math.max(0, gross - pctDiscount - discAmt));
  const vatAmt = round2(subtotal * (vatPct / 100));
  const lineTotal = round2(subtotal + vatAmt);
  return {
    productId: Math.trunc(num(line.productId, 0)),
    qty,
    focQty: num(line.focQty, 0),
    unitPrice,
    unitName: str(line.unitName ?? line.packetDetails, 50) || 'Pcs',
    discountPercentage: discPct,
    discountAmount: discAmt,
    subtotalAmount: subtotal,
    tax1Amount: vatAmt,
    tax1Rate: vatPct,
    lineTotal,
    ownRefNo: str(line.ownRefNo, 50),
    supplierRefNo: str(line.supplierRefNo, 50),
    soldQty: num(line.soldQty, 0),
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
  const sumTax = round2(normalized.reduce((s, L) => s + round2(L.tax1Amount || 0), 0));
  const roundOff = round2(num(body.roundOffAdjustment ?? body.roundOff, 0));
  const { headerDiscAmt, headerDiscPct } = resolveHeaderDiscountFromBody(body, Math.abs(sumSub));
  const amounts = computePurchaseAmounts(
    normalized.map((L) => ({
      subtotalAmount: L.subtotalAmount,
      tax1Rate: L.tax1Rate,
      tax1Amount: L.tax1Amount,
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
    warnings.push('Sales return CR — Exempted uses same ledger as taxable.');
  }
  return taxableId;
}

function resolveReturnCustomerCredit(invoiceAmount, amtTaxable, amtExempt, sumTax, headerDisc, roundOff, warnings) {
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
  returnNo, customerId, normalized, body, invoiceAmount, paymentModeLabel,
}) {
  const warnings = [];
  await accountsParameterRepo.ensureBranchIntegrationDefaults(client, companyId, branchId);

  const customerLedgerId = await partyLedgerService.ensureCustomerLedgerForId(
    client, companyId, branchId, customerId,
  );
  const { taxable: amtTaxable, exempt: amtExempt } = splitTaxableSubtotals(normalized);
  const baseSub = round2(normalized.reduce((s, L) => s + round2(L.subtotalAmount || 0), 0));
  const { headerDiscAmt, headerDiscPct } = resolveHeaderDiscountFromBody(body, Math.abs(baseSub));
  const roundOff = round2(num(body.roundOffAdjustment, 0));
  const amounts = computePurchaseAmounts(normalized, { headerDiscAmt, headerDiscPct, roundOff });
  let headerDisc = amounts.headerDisc;
  if (baseSub < 0 && headerDisc > 0) headerDisc = -headerDisc;
  const adjSumTax = amounts.sumTax;

  const salesCrTaxableId = await resolveSalesReturnCrLedger(client, companyId, branchId, paymentModeLabel, { taxable: true });
  const salesCrExemptId = Math.abs(amtExempt) > 0.001
    ? await resolveSalesReturnCrLedger(client, companyId, branchId, paymentModeLabel, { taxable: false })
    : null;
  const outputTaxLedgerId = Math.abs(adjSumTax) > 0.001 ? await resolveOutputTaxLedger(client, companyId, branchId) : null;
  const discountLedgerId = Math.abs(headerDisc) > 0.001
    ? await resolveSalesReturnDiscountLedger(client, companyId, branchId)
    : null;
  const roundLedgerId = roundOff !== 0
    ? await resolveSalesReturnRoundingLedger(client, companyId, branchId)
    : null;

  const hasSalesCr = salesCrTaxableId != null || (Math.abs(amtExempt) > 0.001 && salesCrExemptId != null);
  const lines = [];
  const pushDrLine = (accountId, amount, narration, outstanding = 0) => {
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
    pushDrLine(salesCrTaxableId, absAmt(amtTaxable), `SRT taxable: ${returnNo}`);
  }
  if (Math.abs(amtExempt) > 0.001) {
    const exId = await resolveReturnExemptCrLedger(salesCrTaxableId, salesCrExemptId, warnings);
    if (exId) pushDrLine(exId, absAmt(amtExempt), `SRT exempt (0%): ${returnNo}`);
  }
  if (Math.abs(amtTaxable) <= 0.001 && Math.abs(amtExempt) <= 0.001) {
    pushDrLine(salesCrTaxableId, absAmt(invoiceAmount) - absAmt(adjSumTax), `SRT: ${returnNo}`);
  }

  if (Math.abs(headerDisc) > 0.001 && discountLedgerId) {
    pushCrLine(discountLedgerId, absAmt(headerDisc), `SRT discount: ${returnNo}`);
  }
  if (roundOff > 0 && roundLedgerId) {
    pushCrLine(roundLedgerId, absAmt(roundOff), `SRT round: ${returnNo}`);
  } else if (roundOff < 0 && roundLedgerId) {
    pushDrLine(roundLedgerId, absAmt(roundOff), `SRT round: ${returnNo}`);
  }
  if (Math.abs(adjSumTax) > 0.001 && outputTaxLedgerId) {
    pushDrLine(outputTaxLedgerId, absAmt(adjSumTax), `SRT output tax: ${returnNo}`);
  } else if (Math.abs(adjSumTax) > 0.001) {
    warnings.push('Output tax ledger not configured — tax added to sales DR');
    pushDrLine(salesCrTaxableId || salesCrExemptId, absAmt(adjSumTax), `SRT tax: ${returnNo}`);
  }

  const customerCredit = resolveReturnCustomerCredit(
    invoiceAmount, amtTaxable, amtExempt, adjSumTax, headerDisc, roundOff, warnings,
  );
  pushCrLine(customerLedgerId, customerCredit, `SRT: ${returnNo}`, 0);

  return {
    lines,
    warnings,
    customerLedgerId,
    hasLedgers: true,
    customerCredit,
  };
}

async function writeReturnAccounting(client, args) {
  const {
    companyId, branchId, salesId, returnNo, returnDate, customerId,
    normalized, body, invoiceAmount, auditBy,
    existingVoucherMasterId = null,
    existingVoucherPostStatus = null,
  } = args;

  const paymentModeLabel = str(body.paymentMode, 50) || 'CASH';
  const linePlan = await resolveReturnVoucherLinePlan(client, companyId, branchId, {
    returnNo, customerId, normalized, body, invoiceAmount, paymentModeLabel,
  });

  if (!linePlan.hasLedgers || !linePlan.lines.length) {
    return { voucherMasterId: null, outstandingBalance: -absAmt(invoiceAmount), warnings: linePlan.warnings };
  }

  const voucherTypeId =
    (await voucherRepo.getVoucherTypeId(client, companyId, 'SalesReturnVoucherName', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(client, companyId, 'SRT'))
    || 7;
  const voucherPrefix = await voucherRepo.getVoucherPrefix(client, companyId, voucherTypeId) || 'SRT-';

  let voucherMasterId = existingVoucherMasterId;
  const canReplace = voucherMasterId != null && String(existingVoucherPostStatus || '').toUpperCase() !== 'POSTED';

  if (canReplace) {
    await voucherRepo.updateVoucherMaster(client, companyId, branchId, voucherMasterId, {
      voucherDate: returnDate,
      referenceNo: String(returnNo),
      voucherAmount: absAmt(invoiceAmount),
      remarks: `SRT: ${returnNo}`,
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
      remarks: `SRT: ${returnNo}`,
      postStatus: 'PENDING',
      creationMode: 'INVENTORYACCOUNTS',
      voucherPostedId: salesId,
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
    outstandingBalance: -round2(linePlan.customerCredit ?? absAmt(invoiceAmount)),
    warnings: linePlan.warnings,
  };
}

async function insertReturnLines(client, { companyId, branchId, salesId, normalized, userLabel }) {
  for (const L of normalized) {
    const salesChildId = await returnRepo.nextSalesChildId(client, companyId);
    await returnRepo.insertSaleChild(client, {
      companyId,
      salesChildId,
      salesId,
      branchId,
      kotChildId: null,
      productId: L.productId,
      shortDescription: L.shortDescription ?? '',
      groupId: null,
      qty: L.qty,
      unitPrice: L.unitPrice,
      unitCost: L.unitCost ?? L.unitPrice,
      packQty: L.packQty ?? 1,
      discountAmount: L.discountAmount,
      lineTotal: L.lineTotal,
      tax1Amount: L.tax1Amount,
      tax2Amount: 0,
      tax3Amount: 0,
      tax1Rate: L.tax1Rate,
      tax2Rate: 0,
      tax3Rate: 0,
      subtotalAmount: L.subtotalAmount,
      modifier: null,
      createdBy: userLabel,
      modifiedBy: userLabel,
      quotationId: null,
      doId: null,
    });
  }
}

async function applyReturnStock(client, authStaff, companyId, branchId, salesId, normalized) {
  const warnings = [];
  try {
    await client.query('SAVEPOINT return_stock');
    for (const L of normalized) {
      const returnQty = Math.abs(L.qty);
      if (returnQty <= 0) continue;
      await stockRepo.applyStockMovement(client, {
        companyId, branchId,
        productId: L.productId,
        transactionType: 'SALES_RETURN',
        transactionId: salesId,
        qty: returnQty,
        unitCost: L.unitCost ?? L.unitPrice ?? 0,
        unitPrice: L.unitPrice ?? 0,
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

export async function loadSourceSale(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const billNo = str(query.billNo, 50);
  if (!billNo) {
    const err = new Error('billNo is required');
    err.status = 400;
    throw err;
  }

  const source = await returnRepo.getSourceSaleForReturn(pool, companyId, branchId, billNo);
  assertPostedSourceForInvoiceReturn(source, 'Sales bill');

  const lineRows = await returnRepo.listSaleLines(pool, companyId, Number(source.sales_id));
  return {
    sourceSalesId: Number(source.sales_id),
    sourceBillNo: source.bill_no != null ? String(source.bill_no) : billNo,
    customerId: source.customer_id != null ? Number(source.customer_id) : null,
    invoiceNo: source.invoice_no ?? null,
    paymentMode: source.payment_mode ?? 'CASH',
    billDate: source.bill_date,
    invoiceAmount: source.amount != null ? String(source.amount) : '0',
    lines: lineRows.map((row) => ({
      productId: row.product_id != null ? Number(row.product_id) : null,
      productCode: row.product_code ?? null,
      shortDescription: row.short_description ?? row.short_name ?? row.product_name ?? null,
      soldQty: row.qty != null ? String(row.qty) : '0',
      returnQty: '0',
      qty: '0',
      unitPrice: row.unit_price != null ? String(row.unit_price) : '0',
      unitCost: row.unit_cost != null ? String(row.unit_cost) : '0',
      discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
      subtotalAmount: '0',
      tax1Rate: row.tax_1_rate != null ? String(row.tax_1_rate) : '0',
      tax1Amount: '0',
      lineTotal: '0',
      total: '0',
      sourceSalesChildId: Number(row.sales_child_id),
    })),
  };
}

export async function listSalesReturns(pool, authStaff, query) {
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

export async function lookupSalesReturn(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const result = await returnRepo.findReturnByLookup(pool, companyId, branchId, {
    returnNo: query.returnNo ?? query.billNo,
    invoiceNo: query.invoiceNo,
  });
  if (result.kind === 'not_found') {
    const err = new Error('Sales return not found');
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

export async function getSalesReturn(pool, authStaff, salesIdParam, query) {
  const companyId = Number(authStaff.company_id);
  const salesId = Math.trunc(num(salesIdParam, 0));
  if (salesId < 1) {
    const err = new Error('Invalid salesId');
    err.status = 400;
    throw err;
  }
  const master = await returnRepo.getReturnMaster(pool, companyId, salesId);
  if (!master) {
    const err = new Error('Sales return not found');
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
  const lineRows = await returnRepo.listSaleLines(pool, companyId, salesId);
  const mappedLines = lineRows.map((row) => {
    const m = mapReturnLine(row);
    if (master.return_sales_id) {
      m.soldQty = m.soldQty ?? null;
    }
    return m;
  });
  const accountsFlags = await resolveReturnAccountsFlags(pool, companyId, branchId, salesId, master);
  return {
    ...mapReturnMaster(master),
    lines: mappedLines.filter(Boolean),
    salesPosted: accountsFlags.returnPosted,
    ...accountsFlags,
  };
}

export async function createSalesReturn(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(body.branchId);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const customerId = Math.trunc(num(body.customerId, 0));
  if (customerId < 1) {
    const err = new Error('customerId is required');
    err.status = 400;
    throw err;
  }
  const customerRow = await customerRepo.findCustomerById(pool, companyId, customerId);
  if (!customerRow) {
    const err = new Error('Customer not found');
    err.status = 400;
    throw err;
  }

  const paymentModeLabel = str(body.paymentMode, 50);
  if (!paymentModeLabel) {
    const err = new Error('paymentMode is required');
    err.status = 400;
    throw err;
  }

  const withInvoice = Boolean(body.withInvoice ?? body.againstInvoice);
  const sourceSalesId = withInvoice ? nullableLong(body.sourceSalesId) : null;
  const sourceBillNo = withInvoice ? str(body.sourceBillNo, 50) || null : null;

  if (withInvoice) {
    if (!sourceSalesId && !sourceBillNo) {
      const err = new Error('Source sales bill must be loaded when returning with invoice');
      err.status = 400;
      throw err;
    }
    await validateSourceSaleForInvoiceReturn(pool, companyId, branchId, { sourceSalesId, sourceBillNo });
  }

  const { normalized, sumSub, sumTax, netClient, invoiceAmount, headerDisc, roundOff } = normalizeReturnInput(body);
  const returnDate = body.billDate ? new Date(body.billDate) : new Date();
  const auditBy = auditStaffId(authStaff);
  const userLabel = auditUserName(authStaff);

  return withTransaction(async (client) => {
    const salesId = await returnRepo.nextReturnId(client, companyId);
    const returnDocNo = await returnRepo.nextReturnNo(client, companyId, branchId);
    const { billNo, returnNo } = resolveReturnMasterNumbers({
      withInvoice,
      sourceBillNo,
      returnDocNo,
    });

    const billNoNum = withInvoice && sourceBillNo ? Number(sourceBillNo) || 0 : 0;

    await returnRepo.insertReturnMaster(client, {
      companyId, salesId, branchId, customerId,
      billDate: returnDate,
      billNo: billNoNum,
      amount: netClient,
      paidAmount: absAmt(invoiceAmount),
      cashAmount: paymentModeLabel === 'CASH' ? absAmt(invoiceAmount) : 0,
      creditAmount: paymentModeLabel === 'CREDIT' ? netClient : 0,
      creditCardAmount: paymentModeLabel === 'CREDITCARD' ? absAmt(invoiceAmount) : 0,
      outstandingBalance: -absAmt(invoiceAmount),
      paymentMode: paymentModeLabel,
      postStatus: 'DRAFT',
      discountAmount: headerDisc,
      roundOffAdjustment: roundOff,
      remarks: str(body.remark ?? body.remarks, 200),
      subtotalAmount: sumSub,
      taxableAmount: sumSub,
      tax1Amount: sumTax,
      tax1Rate: sumSub !== 0 ? round2((sumTax / Math.abs(sumSub)) * 100) : 0,
      returnNo,
      returnSalesId: sourceSalesId,
      createdBy: userLabel,
      modifiedBy: userLabel,
    });

    await insertReturnLines(client, { companyId, branchId, salesId, normalized, userLabel });
    const stockWarnings = await applyReturnStock(client, authStaff, companyId, branchId, salesId, normalized);

    const acct = await writeReturnAccounting(client, {
      companyId, branchId, salesId, returnNo: returnDocNo, returnDate, customerId,
      normalized, body: { ...body, paymentMode: paymentModeLabel, roundOffAdjustment: roundOff, discountAmount: headerDisc },
      invoiceAmount: absAmt(invoiceAmount), auditBy,
    });

    await returnRepo.updateReturnMaster(client, companyId, salesId, branchId, {
      customerId,
      billDate: returnDate,
      billNo: billNoNum,
      paymentMode: paymentModeLabel,
      remarks: str(body.remark ?? body.remarks, 200),
      discountAmount: headerDisc,
      roundOffAdjustment: roundOff,
      subtotalAmount: sumSub,
      tax1Amount: sumTax,
      tax1Rate: sumSub !== 0 ? round2((sumTax / Math.abs(sumSub)) * 100) : 0,
      amount: netClient,
      outstandingBalance: acct.outstandingBalance ?? -absAmt(invoiceAmount),
      returnNo,
      returnSalesId: sourceSalesId,
      modifiedBy: userLabel,
    });

    return {
      salesId,
      returnNo: returnDocNo,
      billNo: String(billNoNum || '0'),
      sourceBillNo,
      sourceSalesId,
      branchId,
      postStatus: 'DRAFT',
      salesPosted: false,
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

export async function updateSalesReturn(pool, body, authStaff, salesIdParam) {
  const companyId = Number(authStaff.company_id);
  const salesId = Math.trunc(num(salesIdParam, 0));
  const branchId = parseBranchId(body.branchId);
  if (salesId < 1 || branchId == null) {
    const err = new Error('Invalid sales return');
    err.status = 400;
    throw err;
  }

  const existing = await returnRepo.getReturnMaster(pool, companyId, salesId);
  if (!existing) {
    const err = new Error('Sales return not found');
    err.status = 404;
    throw err;
  }
  if (String(existing.post_status || '').toUpperCase() === 'POSTED') {
    const err = new Error('Posted return cannot be edited — unpost first');
    err.status = 409;
    throw err;
  }

  const customerId = Math.trunc(num(body.customerId, existing.customer_id));
  const withInvoice = Boolean(body.withInvoice ?? body.againstInvoice ?? existing.return_sales_id);
  const sourceSalesId = withInvoice
    ? nullableLong(body.sourceSalesId) ?? (existing.return_sales_id != null ? Number(existing.return_sales_id) : null)
    : null;
  const sourceBillNo = withInvoice
    ? str(body.sourceBillNo, 50) || againstBillNoFromRow(existing)
    : null;

  if (withInvoice) {
    if (!sourceSalesId && !sourceBillNo) {
      const err = new Error('Source sales bill must be loaded when returning with invoice');
      err.status = 400;
      throw err;
    }
    await validateSourceSaleForInvoiceReturn(pool, companyId, branchId, { sourceSalesId, sourceBillNo });
  }

  const { normalized, sumSub, sumTax, netClient, invoiceAmount, headerDisc, roundOff } = normalizeReturnInput(body);
  const returnDate = body.billDate ? new Date(body.billDate) : new Date(existing.bill_date);
  const paymentModeLabel = str(body.paymentMode ?? existing.payment_mode, 50);
  if (!paymentModeLabel) {
    const err = new Error('paymentMode is required');
    err.status = 400;
    throw err;
  }
  const returnDocNo = returnDocNoFromRow(existing);
  const { billNo, returnNo } = resolveReturnMasterNumbers({
    withInvoice,
    sourceBillNo,
    returnDocNo,
  });
  const auditBy = auditStaffId(authStaff);
  const userLabel = auditUserName(authStaff);

  return withTransaction(async (client) => {
    await returnRepo.softDeleteSaleChildren(client, companyId, salesId);
    await insertReturnLines(client, { companyId, branchId, salesId, normalized, userLabel });
    await applyReturnStock(client, authStaff, companyId, branchId, salesId, normalized);

    const vouchers = await voucherRepo.listVouchersByPostedId(client, companyId, branchId, salesId, 'INVENTORYACCOUNTS');
    const existingVm = vouchers[0]?.master;

    const acct = await writeReturnAccounting(client, {
      companyId, branchId, salesId, returnNo: returnDocNo, returnDate, customerId,
      normalized, body: { ...body, paymentMode: paymentModeLabel, roundOffAdjustment: roundOff, discountAmount: headerDisc },
      invoiceAmount: absAmt(invoiceAmount), auditBy,
      existingVoucherMasterId: existingVm?.voucher_master_id != null ? Number(existingVm.voucher_master_id) : null,
      existingVoucherPostStatus: existingVm?.post_status ?? null,
    });

    await returnRepo.updateReturnMaster(client, companyId, salesId, branchId, {
      customerId,
      billDate: returnDate,
      billNo,
      invoiceNo: str(body.invoiceNo, 50) || existing.invoice_no,
      invoiceAmount,
      outstandingBalance: acct.outstandingBalance ?? -absAmt(invoiceAmount),
      paymentMode: paymentModeLabel,
      remarks: str(body.remark ?? body.remarks, 200),
      discountAmount: headerDisc,
      roundOffAdjustment: roundOff,
      subtotalAmount: sumSub,
      tax1Amount: sumTax,
      tax1Rate: sumSub !== 0 ? round2((sumTax / Math.abs(sumSub)) * 100) : 0,
      netVat: sumTax,
      itemsTotalBc: netClient,
      returnNo,
      sourceSalesId,
      modifiedBy: userLabel,
    });

    return {
      salesId,
      returnNo: returnDocNo,
      billNo,
      sourceBillNo,
      sourceSalesId,
      updated: true,
      postStatus: String(existing.post_status || 'DRAFT'),
      salesPosted: String(existing.post_status || '').toUpperCase() === 'POSTED',
      netAmount: netClient.toFixed(2),
      outstandingBalance: round2(acct.outstandingBalance ?? -absAmt(netClient)).toFixed(2),
    };
  });
}

export async function postSalesReturn(pool, authStaff, salesIdParam, query) {
  const companyId = Number(authStaff.company_id);
  const salesId = Math.trunc(num(salesIdParam, 0));
  let branchId = parseBranchId(query?.branchId);
  const existing = await returnRepo.getReturnMaster(pool, companyId, salesId);
  if (!existing) {
    const err = new Error('Sales return not found');
    err.status = 404;
    throw err;
  }
  if (branchId == null) branchId = Number(existing.branch_id);

  return withTransaction(async (client) => {
    const vouchers = await voucherRepo.listVouchersByPostedId(client, companyId, branchId, salesId, 'INVENTORYACCOUNTS');
    const vm = vouchers[0]?.master;
    if (vm?.voucher_master_id) {
      await voucherRepo.updateVoucherPostStatus(client, companyId, branchId, Number(vm.voucher_master_id), 'POSTED');
    }
    await returnRepo.updateReturnPostStatus(client, companyId, salesId, branchId, 'POSTED');
    return {
      salesId,
      returnNo: returnDocNoFromRow(existing),
      postStatus: 'POSTED',
      salesPosted: true,
    };
  });
}

export async function unpostSalesReturn(pool, authStaff, salesIdParam, query) {
  const companyId = Number(authStaff.company_id);
  const salesId = Math.trunc(num(salesIdParam, 0));
  let branchId = parseBranchId(query?.branchId);
  const existing = await returnRepo.getReturnMaster(pool, companyId, salesId);
  if (!existing) {
    const err = new Error('Sales return not found');
    err.status = 404;
    throw err;
  }
  if (branchId == null) branchId = Number(existing.branch_id);

  const { returnVoucher, receiptVoucher } = await findReturnDocumentVouchers(pool, companyId, branchId, salesId);
  const returnPosted = String(existing.post_status || '').toUpperCase() === 'POSTED'
    || returnVoucher?.master?.post_status === 'POSTED';
  if (!returnPosted) {
    const err = new Error('Sales return is not posted');
    err.status = 409;
    throw err;
  }

  if (receiptVoucher?.master?.post_status === 'POSTED') {
    const err = new Error('Receipt already done.');
    err.status = 409;
    throw err;
  }

  return withTransaction(async (client) => {
    const vm = returnVoucher?.master;
    if (vm?.voucher_master_id && vm.post_status === 'POSTED') {
      await voucherRepo.updateVoucherPostStatus(client, companyId, branchId, Number(vm.voucher_master_id), 'PENDING');
    }
    await returnRepo.updateReturnPostStatus(client, companyId, salesId, branchId, 'DRAFT');
    const flags = await resolveReturnAccountsFlags(client, companyId, branchId, salesId, existing);
    return {
      salesId,
      returnNo: returnDocNoFromRow(existing),
      unposted: true,
      ...flags,
    };
  });
}

async function loadReturnLinesForAccounting(client, companyId, salesId) {
  const { rows } = await client.query(
    `SELECT product_id, qty, unit_price, unit_cost, discount_amount,
            subtotal_amount, tax_1_amount, tax_1_rate
     FROM ops.sales_child
     WHERE company_id = $1 AND sales_id = $2`,
    [companyId, salesId],
  );
  return rows.map((r) => ({
    productId: Math.trunc(num(r.product_id, 0)),
    qty: num(r.qty, 0),
    unitPrice: num(r.unit_price, 0),
    unitCost: num(r.unit_cost, 0),
    discountAmount: num(r.discount_amount, 0),
    subtotalAmount: num(r.subtotal_amount, 0),
    tax1Amount: num(r.tax_1_amount, 0),
    tax1Rate: num(r.tax_1_rate, 0),
  }));
}

async function syncReturnAccountsVoucher(client, companyId, branchId, salesId, auditBy) {
  const existing = await returnRepo.getReturnMaster(client, companyId, salesId);
  if (!existing) return null;
  if (String(existing.post_status || '').toUpperCase() === 'POSTED') return null;

  const vouchers = await voucherRepo.listVouchersByPostedId(client, companyId, branchId, salesId, 'INVENTORYACCOUNTS');
  const existingVm = vouchers[0]?.master;

  const normalized = await loadReturnLinesForAccounting(client, companyId, salesId);
  if (!normalized.length) return null;

  const body = {
    paymentMode: str(existing.payment_mode, 50) || 'CASH',
    discountAmount: num(existing.discount_amount, 0),
    roundOffAdjustment: num(existing.round_off_adjustment, 0),
    netAmount: num(existing.amount, num(existing.amount, 0)),
  };

  return writeReturnAccounting(client, {
    companyId,
    branchId,
    salesId,
    returnNo: returnDocNoFromRow(existing),
    returnDate: existing.bill_date ? new Date(existing.bill_date) : new Date(),
    customerId: Math.trunc(num(existing.customer_id, 0)),
    normalized,
    body,
    invoiceAmount: absAmt(num(existing.amount, 0)),
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

function customerReturnOutstandingFromVoucher(mappedVoucher, fallback = null) {
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

async function findReturnDocumentVouchers(db, companyId, branchId, salesId) {
  const returnVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(db, companyId, 'SalesReturnVoucherName', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(db, companyId, 'SRT'))
    || 7;
  const receiptVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(db, companyId, 'ReceiptVoucherNameCustomer', branchId))
    || (await voucherRepo.getVoucherTypeId(db, companyId, 'ReceiptVoucherName', branchId))
    || 2;

  const vouchers = await voucherRepo.listVouchersByPostedId(db, companyId, branchId, salesId, 'INVENTORYACCOUNTS');
  let returnVoucher = null;
  let receiptVoucher = null;
  for (const v of vouchers) {
    const typeId = Number(v.master.voucher_type_id);
    if (typeId === returnVoucherTypeId) returnVoucher = v;
    else if (typeId === receiptVoucherTypeId) receiptVoucher = v;
    else if (!returnVoucher) returnVoucher = v;
    else if (!receiptVoucher) receiptVoucher = v;
  }
  return { returnVoucher, receiptVoucher };
}

async function resolveReturnAccountsFlags(pool, companyId, branchId, salesId, masterRow) {
  const { returnVoucher, receiptVoucher } = await findReturnDocumentVouchers(pool, companyId, branchId, salesId);
  const mappedReturn = returnVoucher ? mapReturnVoucherForApi(returnVoucher) : null;
  const mappedReceipt = receiptVoucher ? mapReturnVoucherForApi(receiptVoucher) : null;
  const returnPosted = String(masterRow.post_status || '').toUpperCase() === 'POSTED'
    || mappedReturn?.postStatus === 'POSTED';
  const receiptPosted = mappedReceipt?.postStatus === 'POSTED';
  const outstandingBalance = customerReturnOutstandingFromVoucher(
    mappedReturn,
    num(masterRow.outstanding_balance, num(masterRow.amount, 0)),
  );
  return {
    outstandingBalance: outstandingBalance.toFixed(2),
    accountsPosted: mappedReturn != null,
    returnPosted,
    salesPosted: returnPosted,
    receiptPosted,
    paymentPosted: receiptPosted,
    canUnpost: returnPosted && !receiptPosted,
  };
}

export async function getSalesReturnAccounts(pool, authStaff, salesId, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query?.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const pid = Math.trunc(num(salesId, 0));
  if (pid < 1) {
    const err = new Error('Invalid salesId');
    err.status = 400;
    throw err;
  }
  const master = await returnRepo.getReturnMaster(pool, companyId, pid);
  if (!master) {
    const err = new Error('Sales return not found');
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

  const { returnVoucher: returnVoucherRaw, receiptVoucher: receiptVoucherRaw } =
    await findReturnDocumentVouchers(pool, companyId, branchId, pid);
  const returnVoucher = returnVoucherRaw ? mapReturnVoucherForApi(returnVoucherRaw) : null;
  const receiptVoucher = receiptVoucherRaw ? mapReturnVoucherForApi(receiptVoucherRaw) : null;
  const outstandingBalance = customerReturnOutstandingFromVoucher(
    returnVoucher,
    num(masterRow.outstanding_balance, num(masterRow.amount, 0)),
  );
  const returnPosted = String(masterRow.post_status || '').toUpperCase() === 'POSTED'
    || returnVoucher?.postStatus === 'POSTED';
  const receiptPosted = receiptVoucher?.postStatus === 'POSTED';
  return {
    salesId: pid,
    branchId,
    returnNo: returnDocNoFromRow(masterRow),
    billNo: againstBillNoFromRow(masterRow) ?? '0',
    sourceBillNo: masterRow.source_bill_no ?? againstBillNoFromRow(masterRow),
    invoiceNo: masterRow.invoice_no ?? null,
    invoiceAmount: masterRow.amount != null ? String(Math.abs(num(masterRow.amount, 0))) : '0',
    paymentMode: masterRow.payment_mode ?? null,
    outstandingBalance: outstandingBalance.toFixed(2),
    paymentDone: receiptPosted,
    receiptPosted,
    paymentPosted: receiptPosted,
    salesPosted: returnPosted,
    returnPosted,
    salesVoucher: returnVoucher,
    returnVoucher,
    receiptVoucher,
    paymentVoucher: receiptVoucher,
    accountsPosted: returnVoucher != null,
    canUnpost: returnPosted && !receiptPosted,
  };
}

export async function previewSalesReturnAccounts(pool, authStaff, salesIdParam, body, query) {
  const companyId = Number(authStaff.company_id);
  const salesId = Math.trunc(num(salesIdParam, 0));
  if (salesId < 1) {
    const err = new Error('Invalid salesId');
    err.status = 400;
    throw err;
  }
  const existing = await returnRepo.getReturnMaster(pool, companyId, salesId);
  if (!existing) {
    const err = new Error('Sales return not found');
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
    return getSalesReturnAccounts(pool, authStaff, salesId, query);
  }
  const { normalized, invoiceAmount } = normalizeReturnInput(body);
  const paymentModeLabel = str(body.paymentMode ?? existing.payment_mode, 50) || 'CASH';
  const returnDocNo = returnDocNoFromRow(existing);
  const customerId = Math.trunc(num(body.customerId, existing.customer_id));
  const linePlan = await resolveReturnVoucherLinePlan(pool, companyId, branchId, {
    returnNo: returnDocNo,
    customerId,
    normalized,
    body,
    invoiceAmount: absAmt(invoiceAmount),
    paymentModeLabel,
  });
  const enrichedLines = await enrichVoucherLinesWithAccountHeads(pool, companyId, linePlan.lines);
  const customerOs = round2(-(linePlan.customerCredit ?? absAmt(invoiceAmount)));
  return {
    salesId,
    branchId,
    returnNo: returnDocNo,
    billNo: againstBillNoFromRow(existing) ?? '0',
    preview: true,
    invoiceAmount: absAmt(invoiceAmount).toFixed(2),
    outstandingBalance: customerOs.toFixed(2),
    paymentDone: false,
    salesPosted: false,
    returnPosted: false,
    accountsPosted: enrichedLines.length > 0,
    salesVoucher: enrichedLines.length
      ? { voucherNo: 'Preview', postStatus: 'PREVIEW', lines: enrichedLines }
      : null,
    returnVoucher: enrichedLines.length
      ? { voucherNo: 'Preview', postStatus: 'PREVIEW', lines: enrichedLines }
      : null,
    paymentVoucher: null,
    warnings: linePlan.warnings?.length ? linePlan.warnings : undefined,
    message: enrichedLines.length
      ? 'Preview from current entry — save to persist voucher lines.'
      : 'Configure sales return CR and supplier ledgers in Branch Account Integration.',
  };
}

export async function previewDraftSalesReturnAccounts(pool, authStaff, body, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query?.branchId);
  if (branchId == null) branchId = parseBranchId(body?.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const customerId = Math.trunc(num(body?.customerId, 0));
  if (customerId < 1) {
    const err = new Error('customerId is required');
    err.status = 400;
    throw err;
  }
  const { normalized, invoiceAmount } = normalizeReturnInput(body);
  const paymentModeLabel = str(body.paymentMode, 50) || 'CASH';
  const linePlan = await resolveReturnVoucherLinePlan(pool, companyId, branchId, {
    returnNo: 'Preview',
    customerId,
    normalized,
    body,
    invoiceAmount: absAmt(invoiceAmount),
    paymentModeLabel,
  });
  const enrichedLines = await enrichVoucherLinesWithAccountHeads(pool, companyId, linePlan.lines);
  const customerOs = round2(-(linePlan.customerCredit ?? absAmt(invoiceAmount)));
  return {
    salesId: null,
    branchId,
    returnNo: 'Preview',
    billNo: 'Preview',
    preview: true,
    invoiceAmount: absAmt(invoiceAmount).toFixed(2),
    outstandingBalance: customerOs.toFixed(2),
    paymentDone: false,
    salesPosted: false,
    returnPosted: false,
    accountsPosted: enrichedLines.length > 0,
    salesVoucher: enrichedLines.length
      ? { voucherNo: 'Preview', postStatus: 'PREVIEW', lines: enrichedLines }
      : null,
    returnVoucher: enrichedLines.length
      ? { voucherNo: 'Preview', postStatus: 'PREVIEW', lines: enrichedLines }
      : null,
    paymentVoucher: null,
    warnings: linePlan.warnings?.length ? linePlan.warnings : undefined,
    message: enrichedLines.length
      ? 'Preview from current entry — save to persist voucher lines.'
      : 'Configure sales return CR and supplier ledgers in Branch Account Integration.',
  };
}
