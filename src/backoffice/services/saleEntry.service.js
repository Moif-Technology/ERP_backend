import { withTransaction } from '../../config/db.js';
import * as salesRepo from '../../pos/restaurant-pos/repositories/sales.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as saleEntryRepo from '../repositories/saleEntry.repository.js';
import * as returnRepo from '../repositories/salesReturnEntry.repository.js';
import * as accountHeadRepo from '../../accounts/repositories/accountHead.repository.js';
import * as accountsParameterRepo from '../../accounts/repositories/accountsParameter.repository.js';
import {
  resolveBoSalesCrLedger,
  resolveBoSalesCrExemptLedger,
  resolveOutputTaxLedger,
  resolveDiscountLedger,
  resolveRoundingLedger,
  splitTaxableSubtotals,
} from '../../accounts/lib/integrationPosting.js';
import * as voucherRepo from '../../accounts/repositories/voucher.repository.js';
import * as docRefRepo from '../../shared/repositories/documentReference.repository.js';
import * as stockRepo from '../../shared/repositories/stock.repository.js';
import * as txnExpenseRepo from '../../shared/repositories/transactionExpense.repository.js';
import * as deliveryOrderRepo from '../repositories/deliveryOrder.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';
import * as productRepo from '../repositories/product.repository.js';
import * as customerRepo from '../repositories/customer.repository.js';
import { auditStaffId } from '../../pos/restaurant-pos/lib/staffAudit.js';

function staffIdForStockLog(authStaff) {
  const n = Number(authStaff?.staff_id ?? authStaff?.id);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}
import { computePurchaseAmounts, resolveHeaderDiscountFromBody } from '../lib/purchaseAmounts.js';
import { ensureCustomerLedgerForId } from './partyLedger.service.js';

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Header discount on line subtotals; tax on discounted taxable amount (same as Purchase). */
function computeSaleDocumentAmounts(normalized, body) {
  const baseSub = round2(normalized.reduce((s, L) => s + round2(L.subtotalAmount || 0), 0));
  const roundOff = round2(num(body.roundOffAdjustment ?? body.roundOff, 0));
  const { headerDiscAmt, headerDiscPct, headerDisc } = resolveHeaderDiscountFromBody(body, baseSub);
  const amounts = computePurchaseAmounts(
    normalized.map((L) => ({ subtotalAmount: L.subtotalAmount, vatPct: L.tax1Rate })),
    { headerDiscAmt, headerDiscPct, roundOff },
  );
  return {
    baseSub,
    subAfterDisc: amounts.subAfterDisc,
    headerDisc: amounts.headerDisc,
    headerDiscAmt,
    headerDiscPct,
    sumTax: amounts.sumTax,
    roundOff,
    net: amounts.net,
    effTaxRate: amounts.subAfterDisc > 0.0001 ? round2((amounts.sumTax / amounts.subAfterDisc) * 100) : 0,
  };
}

/** Resolve customer_master.customer_id → receivable ledger account_id (by customer_code). */
async function resolveCustomerLedgerId(db, companyId, branchId, customerId) {
  if (customerId == null) return null;
  try {
    return await ensureCustomerLedgerForId(db, companyId, branchId, customerId);
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return null;
    throw err;
  }
}

function num(v, d = 0) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function nullableLong(v) {
  const n = num(v, 0);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function str(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function resolveSaleListPostStatus(row) {
  const salePost = String(row.sale_post_status || '').trim().toUpperCase();
  const voucherPost = String(row.voucher_post_status || '').trim().toUpperCase();
  if (salePost === 'POSTED' || voucherPost === 'POSTED') return 'POSTED';
  if (!row.voucher_master_id) return 'NOT POSTED';
  return 'NOT POSTED';
}

function mapSaleRowToApi(row) {
  return {
    salesId: Number(row.sales_id),
    branchId: Number(row.branch_id),
    counterNo: row.counter_no != null ? String(row.counter_no) : null,
    billNo: row.bill_no != null ? String(row.bill_no) : '',
    billDate: row.bill_date,
    billTime: row.bill_time,
    paymentMode: row.payment_mode,
    customerId: row.customer_id != null ? Number(row.customer_id) : null,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    trnNo: row.customer_tax_reg_no,
    salesMan: row.staff_name,
    subTotal: row.subtotal_amount != null ? String(row.subtotal_amount) : '0',
    discount: row.discount_amount != null ? String(row.discount_amount) : '0',
    taxAmount: row.tax_amount != null ? String(row.tax_amount) : '0',
    roundOffAdjustment: row.round_off_adjustment != null ? String(row.round_off_adjustment) : '0',
    amount: row.amount != null ? String(row.amount) : '0',
    remarks: row.remarks,
    quotationId: row.quotation_id != null ? Number(row.quotation_id) : null,
    deliveryOrderId: row.delivery_order_id != null ? Number(row.delivery_order_id) : null,
    postStatus: resolveSaleListPostStatus(row),
    outstandingBalance: row.outstanding_balance != null ? String(row.outstanding_balance) : '0',
    counterClose: 'PENDING',
    transactionType: row.transaction_type || row.payment_mode || null,
  };
}

export async function getSale(pool, authStaff, salesId, branchId) {
  const companyId = Number(authStaff.company_id);
  const bid = parseBranchId(branchId) || parseBranchId(authStaff.branch_id);
  if (!bid) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const sid = Math.trunc(Number(salesId));
  if (!Number.isFinite(sid) || sid < 1) {
    const err = new Error('Invalid salesId');
    err.status = 400;
    throw err;
  }
  const row = await saleEntryRepo.getSaleById(pool, companyId, bid, sid);
  if (!row) {
    const err = new Error('Sale not found');
    err.status = 404;
    throw err;
  }

  let accountsSummary = null;
  try {
    accountsSummary = await getSaleAccounts(pool, authStaff, sid, { branchId: bid });
  } catch {
    accountsSummary = null;
  }

  const dbPostStatus = String(row.post_status || '').trim().toUpperCase();
  const salesPosted = Boolean(accountsSummary?.salesPosted) || dbPostStatus === 'POSTED';
  const receiptPosted = Boolean(accountsSummary?.receiptPosted);

  return {
    salesId: Number(row.sales_id),
    branchId: Number(row.branch_id),
    billNo: row.bill_no != null ? String(row.bill_no) : '',
    invoiceNo: row.invoice_no || '',
    billDate: row.bill_date,
    billTime: row.bill_time,
    counterNo: row.counter_no != null ? String(row.counter_no) : '',
    paymentMode: row.payment_mode || 'CASH',
    customerId: row.customer_id != null ? Number(row.customer_id) : null,
    customerName: row.customer_name || '',
    subTotal: row.subtotal_amount != null ? String(row.subtotal_amount) : '0',
    discount: row.discount_amount != null ? String(row.discount_amount) : '0',
    taxAmount: row.tax_amount != null ? String(row.tax_amount) : '0',
    roundOffAdj: row.round_off_adjustment != null ? String(row.round_off_adjustment) : '0',
    amount: row.amount != null ? String(row.amount) : '0',
    remarks: row.remarks || '',
    salesPosted,
    receiptPosted,
    canUnpost: salesPosted && !receiptPosted,
    outstandingBalance: accountsSummary?.outstandingBalance ?? null,
    accountsPosted: Boolean(accountsSummary?.accountsPosted),
    lines: (row.lines || []).map((l) => ({
      salesChildId: l.salesChildId != null ? Number(l.salesChildId) : null,
      productId: l.productId != null ? Number(l.productId) : null,
      shortDescription: l.shortDescription || '',
      qty: Number(l.qty) || 0,
      unitPrice: Number(l.unitPrice) || 0,
      unitCost: Number(l.unitCost) || 0,
      discountAmount: Number(l.discountAmount) || 0,
      subtotalAmount: Number(l.subtotalAmount) || 0,
      tax1Rate: Number(l.tax1Rate) || 0,
      tax1Amount: Number(l.tax1Amount) || 0,
      lineTotal: Number(l.lineTotal) || 0,
      quotationId: l.quotationId != null ? Number(l.quotationId) : null,
      doId: l.doId != null ? Number(l.doId) : null,
      barcode: l.barcode || '',
      ownRefNo: l.ownRefNo || '',
    })),
  };
}

/** Product line details for sales entry view (stock, pricing, last customer sale price). */
export async function getSaleLineProductDetails(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(query?.branchId) || parseBranchId(authStaff.branch_id);
  const productId = nullableLong(query?.productId);
  const customerId = nullableLong(query?.customerId);
  const excludeSalesId = nullableLong(query?.excludeSalesId);

  if (!branchId) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  if (!productId) {
    const err = new Error('productId is required');
    err.status = 400;
    throw err;
  }

  const okBranch = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!okBranch) {
    const err = new Error('Invalid branch for this company');
    err.status = 403;
    throw err;
  }

  const pricing = await productRepo.getProductPricingForPrivilege(pool, companyId, branchId, productId);
  const stockOnHand = await stockRepo.getStockQty(pool, companyId, branchId, productId);

  let lastCustomerPrice = null;
  let lastSaleBillNo = null;
  let lastSaleDate = null;
  if (customerId) {
    const last = await saleEntryRepo.getLastCustomerSalePrice(
      pool,
      companyId,
      branchId,
      customerId,
      productId,
      excludeSalesId,
    );
    if (last) {
      lastCustomerPrice = last.unit_price != null ? Number(last.unit_price) : null;
      lastSaleBillNo = last.bill_no != null ? String(last.bill_no) : null;
      lastSaleDate = last.bill_date ?? null;
    }
  }

  return {
    productId,
    customerId,
    stockOnHand,
    unitCost: pricing?.averageCost ?? null,
    minUnitPrice: pricing?.minimumRetailPrice ?? null,
    lastCustomerPrice,
    lastSaleBillNo,
    lastSaleDate,
  };
}

export async function listSales(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const okBranch = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!okBranch) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }
  const rows = await saleEntryRepo.listSales(pool, companyId, branchId, query.limit, query.offset);
  return rows.map(mapSaleRowToApi);
}

async function prepareSaleDocumentInput(pool, body, authStaff, branchId) {
  const companyId = Number(authStaff.company_id);
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) {
    const err = new Error('At least one line is required');
    err.status = 400;
    throw err;
  }

  const quotationIdOpt = nullableLong(body.quotationId);
  const deliveryOrderIdOpt = nullableLong(body.deliveryOrderId);
  const normalized = [];

  for (let i = 0; i < lines.length; i += 1) {
    const L = lines[i] || {};
    const productId = Math.trunc(num(L.productId, 0));
    if (productId < 1) {
      const err = new Error(`Line ${i + 1}: productId is required (pick a product from the catalog)`);
      err.status = 400;
      throw err;
    }
    const qty = num(L.qty, 0);
    if (qty <= 0) {
      const err = new Error(`Line ${i + 1}: qty must be > 0`);
      err.status = 400;
      throw err;
    }
    const unitPrice = round2(num(L.unitPrice, 0));
    const unitCost = round2(num(L.unitCost, 0));
    const disc = round2(num(L.discountAmount ?? L.discAmt ?? L.itemDiscount, 0));
    const subL = round2(num(L.subtotalAmount ?? L.subTotal, qty * unitPrice - disc));
    const tax1 = round2(num(L.taxAmt ?? L.tax1Amount, 0));
    const r1 = round2(num(L.taxPercent ?? L.tax1Rate, subL > 0.0001 ? round2((tax1 / subL) * 100) : 0));
    const lt = round2(num(L.lineTotal, subL + tax1));
    const desc = str(L.shortDescription ?? L.productDescription, 200) || 'Item';
    normalized.push({
      productId, qty, unitPrice, unitCost,
      packQty: Math.max(num(L.packQty, 1), 0.0001),
      discountAmount: disc, subtotalAmount: subL,
      tax1Amount: tax1, tax2Amount: 0, tax3Amount: 0,
      tax1Rate: r1, tax2Rate: 0, tax3Rate: 0,
      lineTotal: lt, shortDescription: desc.slice(0, 50),
      quotationId: nullableLong(L.quotationId),
      doId: nullableLong(L.doId ?? L.deliveryOrderId),
    });
  }

  const docAmounts = computeSaleDocumentAmounts(normalized, body);
  const { baseSub, subAfterDisc, headerDisc, sumTax: adjSumTax, roundOff, net: netExpected, effTaxRate } = docAmounts;
  const netClient = round2(num(body.netAmount, 0));
  const sumTax = adjSumTax;

  if (Math.abs(netExpected - netClient) > 0.05) {
    const err = new Error(`Net amount does not match lines and discounts (expected ${netExpected.toFixed(2)}, got ${netClient.toFixed(2)})`);
    err.status = 400;
    throw err;
  }
  if (netClient <= 0) {
    const err = new Error('netAmount must be > 0');
    err.status = 400;
    throw err;
  }

  const paymentModeRaw = str(body.paymentMode, 50);
  if (!paymentModeRaw) {
    const err = new Error('paymentMode is required');
    err.status = 400;
    throw err;
  }
  const paymentMode = paymentModeRaw.toUpperCase().includes('CREDIT')
    ? paymentModeRaw.toUpperCase().includes('CARD') ? 'CREDITCARD' : 'CREDIT'
    : paymentModeRaw.toUpperCase().includes('CASH') ? 'CASH' : paymentModeRaw.toUpperCase();

  let receiptLedgerId = nullableLong(body.receiptLedgerId ?? body.accountHeadId);
  if ((paymentMode === 'CASH' || paymentMode === 'CREDITCARD') && receiptLedgerId == null) {
    receiptLedgerId = await accountsParameterRepo.getParameterAccountId(
      pool, companyId, branchId, paymentMode === 'CREDITCARD' ? 'DEFAULT_CARD_LEDGER' : 'DEFAULT_CASH_LEDGER',
    );
  }
  if (paymentMode === 'CASH' || paymentMode === 'CREDITCARD') {
    if (receiptLedgerId == null) {
      const err = new Error('Cash/card ledger not configured — set in Account Integration (Payment / Receipt tab)');
      err.status = 400;
      throw err;
    }
    const head = await accountHeadRepo.findAccountHead(pool, companyId, receiptLedgerId);
    if (!head) {
      const err = new Error('Invalid cash/card ledger for this company');
      err.status = 400;
      throw err;
    }
  }

  const privilegeWarnings = [];
  const customerId = nullableLong(body.customerId);
  if (customerId == null) {
    const err = new Error('customerId is required');
    err.status = 400;
    throw err;
  }
  const customerLedgerId = await resolveCustomerLedgerId(pool, companyId, branchId, customerId);
  const customerHasLedger = customerLedgerId != null;
  if (!customerHasLedger) {
    privilegeWarnings.push(
      `Customer (ID ${customerId}) has no receivable ledger — set customer code and configure CUSTOMER_PARENT_LEDGER in Branch Account Integration.`,
    );
  }
  for (let i = 0; i < normalized.length; i += 1) {
    const L = normalized[i];
    if (L.unitPrice <= 0 && L.qty > 0) privilegeWarnings.push(`Line ${i + 1}: Zero unit price is not allowed.`);
    try {
      const pricing = await productRepo.getProductPricingForPrivilege(pool, companyId, branchId, L.productId);
      const qtyOnHand = await stockRepo.getStockQty(pool, companyId, branchId, L.productId);
      if (pricing) {
        if (pricing.minimumRetailPrice > 0 && L.unitPrice < pricing.minimumRetailPrice) {
          privilegeWarnings.push(`Line ${i + 1}: Unit price ${L.unitPrice.toFixed(2)} is below minimum retail price ${pricing.minimumRetailPrice.toFixed(2)}.`);
        }
        const lineProfit = (L.unitPrice * L.qty) - (pricing.averageCost * L.qty) - L.discountAmount;
        if (pricing.averageCost > 0 && lineProfit < 0) {
          privilegeWarnings.push(`Line ${i + 1}: Loss sale — selling below cost (profit: ${lineProfit.toFixed(2)}).`);
        }
      }
      if (qtyOnHand < L.qty) {
        privilegeWarnings.push(`Line ${i + 1}: Minus stock — available ${qtyOnHand.toFixed(2)}, selling ${L.qty}.`);
      }
    } catch { /* optional */ }
  }
  if (paymentMode === 'CREDIT' && customerId != null) {
    try {
      const creditInfo = await customerRepo.getCustomerCreditInfo(pool, companyId, customerId);
      if (creditInfo?.creditLimit > 0 && creditInfo.osBalance + netClient > creditInfo.creditLimit) {
        privilegeWarnings.push(`Credit limit exceeded: limit ${creditInfo.creditLimit.toFixed(2)}, current OS ${creditInfo.osBalance.toFixed(2)}, this sale ${netClient.toFixed(2)}.`);
      }
    } catch { /* optional */ }
  }
  if (privilegeWarnings.length > 0 && !body.overridePrivilegeChecks) {
    const err = new Error(`Privilege check warnings:\n${privilegeWarnings.join('\n')}`);
    err.status = 422;
    err.warnings = privilegeWarnings;
    err.requiresOverride = true;
    throw err;
  }

  const paid = round2(num(body.paidAmount, netClient));
  if (paid < netClient - 0.05) {
    const err = new Error('paidAmount must be >= netAmount');
    err.status = 400;
    throw err;
  }

  const remarksParts = [];
  if (body.salesTerms) remarksParts.push(String(body.salesTerms).trim());
  if (body.billing?.salesTerms) remarksParts.push(String(body.billing.salesTerms).trim());
  if (quotationIdOpt) remarksParts.push(`Q:${quotationIdOpt}`);
  if (deliveryOrderIdOpt) remarksParts.push(`DO:${deliveryOrderIdOpt}`);

  return {
    companyId, branchId, normalized, quotationIdOpt, deliveryOrderIdOpt,
    baseSub, subAfterDisc, headerDisc, sumTax, roundOff, netClient, effTaxRate,
    paymentMode, receiptLedgerId, customerId, customerLedgerId, customerHasLedger,
    privilegeWarnings, paid,
    counterNo: 99,
    remarks: str(remarksParts.filter(Boolean).join(' | '), 200),
    cashAmount: paymentMode === 'CASH' ? paid : 0,
    creditAmount: paymentMode === 'CREDIT' ? netClient : 0,
    creditCardAmount: paymentMode === 'CREDITCARD' ? paid : 0,
    balancePaid: round2(Math.max(0, paid - netClient)),
    creditCardNo: paymentMode === 'CREDITCARD' ? str(body.creditCardNo ?? body.billing?.creditCardNo, 50) : null,
  };
}

async function reverseSaleStockOut(client, authStaff, companyId, branchId, salesId, oldChildren) {
  const createdBy = staffIdForStockLog(authStaff) ?? auditStaffId(authStaff);
  for (const row of oldChildren || []) {
    const qty = num(row.qty, 0);
    if (qty <= 0) continue;
    try {
      await client.query('SAVEPOINT stock_reverse');
      await stockRepo.applyStockMovement(client, {
        companyId, branchId, productId: Number(row.product_id),
        transactionType: 'SALES', transactionId: salesId, qty,
        unitCost: num(row.unit_cost, 0), unitPrice: num(row.unit_price, 0), createdBy,
      });
      await client.query('RELEASE SAVEPOINT stock_reverse');
    } catch (stockErr) {
      await client.query('ROLLBACK TO SAVEPOINT stock_reverse');
      if (stockErr.code !== '42P01' && stockErr.code !== '42703') throw stockErr;
    }
  }
}

async function applySaleStockOut(client, authStaff, companyId, branchId, salesId, normalized, { allowMinusStock = false } = {}) {
  const createdBy = staffIdForStockLog(authStaff) ?? auditStaffId(authStaff);
  for (const L of normalized) {
    try {
      await client.query('SAVEPOINT stock_update');
      const currentQty = await stockRepo.getStockQty(client, companyId, branchId, L.productId);
      if (!allowMinusStock && round2(currentQty - L.qty) < 0) {
        const err = new Error(`Insufficient stock for "${L.shortDescription || L.productId}": available ${currentQty}, requested ${L.qty}`);
        err.status = 400;
        throw err;
      }
      await stockRepo.applyStockMovement(client, {
        companyId, branchId, productId: L.productId, transactionType: 'SALES', transactionId: salesId,
        qty: -L.qty, unitCost: L.unitCost, unitPrice: L.unitPrice, createdBy,
      });
      await client.query('RELEASE SAVEPOINT stock_update');
    } catch (stockErr) {
      await client.query('ROLLBACK TO SAVEPOINT stock_update');
      if (stockErr.code === '42P01' || stockErr.code === '42703') {
        console.warn('product_log_entry schema mismatch — stock update skipped');
      } else throw stockErr;
    }
  }
}

async function insertSaleLines(client, authStaff, companyId, branchId, salesId, normalized) {
  const auditBy = auditStaffId(authStaff);
  for (const L of normalized) {
    const salesChildId = await salesRepo.nextSalesChildId(client, companyId);
    await salesRepo.insertSalesChild(client, {
      companyId, salesChildId, salesId, branchId, kotChildId: null,
      productId: L.productId, shortDescription: L.shortDescription, groupId: null,
      qty: L.qty, unitPrice: L.unitPrice, unitCost: L.unitCost, packQty: L.packQty,
      discountAmount: L.discountAmount, lineTotal: L.lineTotal,
      tax1Amount: L.tax1Amount, tax2Amount: L.tax2Amount, tax3Amount: L.tax3Amount,
      tax1Rate: L.tax1Rate, tax2Rate: L.tax2Rate, tax3Rate: L.tax3Rate,
      subtotalAmount: L.subtotalAmount, modifier: null,
      createdBy: auditBy, modifiedBy: auditBy, quotationId: L.quotationId, doId: L.doId,
    });
  }
}

async function rewriteSaleVouchers(client, ctx) {
  const {
    companyId, branchId, salesId, billNo, auditBy,
    customerId, customerLedgerId, customerHasLedger, paymentMode,
    normalized, sumTax, headerDisc, roundOff, netClient, paid, receiptLedgerId,
    salesVoucher, receiptVoucher,
  } = ctx;
  let salesVoucherId = salesVoucher?.master?.voucher_master_id != null ? Number(salesVoucher.master.voucher_master_id) : null;
  const saleLinePlan = await resolveSaleVoucherLinePlan(client, companyId, branchId, {
    billNo, customerId, customerLedgerId, customerHasLedger, paymentMode, normalized,
    sumTax, headerDisc, roundOff, netClient, receiptLedgerId,
  });
  if (saleLinePlan.hasSalesCr && saleLinePlan.lines.length) {
    const salesVoucherTypeId = await voucherRepo.getVoucherTypeId(client, companyId, 'SalesEntryVoucherName', branchId) || 1;
    const voucherPrefix = await voucherRepo.getVoucherPrefix(client, companyId, salesVoucherTypeId) || 'SVT';
    const voucherBillNo = Number(billNo);
    if (salesVoucherId != null && salesVoucher?.master?.post_status !== 'POSTED') {
      await voucherRepo.updateVoucherMaster(client, companyId, branchId, salesVoucherId, {
        referenceNo: String(billNo), voucherAmount: netClient, remarks: `SVT: ${billNo}`,
      });
      await voucherRepo.deleteVoucherDetails(client, companyId, branchId, salesVoucherId);
    } else {
      salesVoucherId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
      await voucherRepo.insertVoucherMaster(client, {
        companyId, branchId, voucherMasterId: salesVoucherId, voucherTypeId: salesVoucherTypeId,
        autoVoucherNo: voucherBillNo, manualVoucherNo: String(billNo), voucherPrefix,
        referenceNo: String(billNo), voucherAmount: netClient, remarks: `SVT: ${billNo}`,
        postStatus: 'PENDING', creationMode: 'INVENTORYACCOUNTS', voucherPostedId: salesId,
        counterCloseNo: 'PENDING', recordStatus: 'ACTIVE', createdBy: auditBy,
      });
    }
    let detailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);
    for (const line of saleLinePlan.lines) {
      await voucherRepo.insertVoucherDetail(client, {
        companyId, branchId, voucherDetailId: detailSeq++, voucherMasterId: salesVoucherId,
        accountId: line.accountId, creditAmount: line.creditAmount, debitAmount: line.debitAmount,
        outstandingBalance: line.outstandingBalance, narration: line.narration,
        postStatus: 'PENDING', recordStatus: 'ACTIVE', createdBy: auditBy,
      });
    }
  }
  if (receiptVoucher?.master?.voucher_master_id != null && receiptVoucher.master.post_status !== 'POSTED') {
    await voucherRepo.softDeleteVoucher(client, companyId, branchId, Number(receiptVoucher.master.voucher_master_id));
  }
  if ((paymentMode === 'CASH' || paymentMode === 'CREDITCARD') && receiptLedgerId != null && customerLedgerId != null) {
    const recVoucherTypeId = await voucherRepo.getVoucherTypeId(client, companyId, 'ReceiptVoucherNameCustomer', branchId) || 2;
    const recPrefix = await voucherRepo.getVoucherPrefix(client, companyId, recVoucherTypeId) || 'RCV';
    const recMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
    await voucherRepo.insertVoucherMaster(client, {
      companyId, branchId, voucherMasterId: recMasterId, voucherTypeId: recVoucherTypeId,
      autoVoucherNo: Number(billNo), manualVoucherNo: String(billNo), voucherPrefix,
      referenceNo: String(billNo), voucherAmount: paid, remarks: `RCV: ${billNo}`,
      postStatus: 'PENDING', creationMode: 'INVENTORYACCOUNTS', voucherPostedId: salesId,
      counterCloseNo: 'PENDING', recordStatus: 'ACTIVE', createdBy: auditBy,
    });
    let recDetailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);
    await voucherRepo.insertVoucherDetail(client, {
      companyId, branchId, voucherDetailId: recDetailSeq++, voucherMasterId: recMasterId,
      accountId: receiptLedgerId, creditAmount: 0, debitAmount: paid, outstandingBalance: 0,
      narration: `RCV: ${billNo}`, postStatus: 'PENDING', recordStatus: 'ACTIVE', createdBy: auditBy,
    });
    await voucherRepo.insertVoucherDetail(client, {
      companyId, branchId, voucherDetailId: recDetailSeq++, voucherMasterId: recMasterId,
      accountId: customerLedgerId, creditAmount: paid, debitAmount: 0, outstandingBalance: 0,
      narration: `RCV: ${billNo}`, postStatus: 'PENDING', recordStatus: 'ACTIVE', createdBy: auditBy,
    });
  }
  return salesVoucherId;
}

/**
 * POST /api/sales — full VB-equivalent save:
 *   1.  Validate + Privilege checks (min price, loss sale, minus stock, credit limit)
 *   2.  SalesMaster INSERT
 *   3.  SalesChild INSERT (per line, with quotation_id + do_id)
 *   4.  SalesPaymentSplit
 *   5.  ERP fields (quotation_id, delivery_order_id, receipt_ledger_id on header)
 *   6.  MultiReferenceTable (document_reference_map for QTN + DO links)
 *   7.  Customer-as-debtor ledger validation
 *   8.  VoucherMaster + VoucherDetail (double-entry journal)
 *   9.  Receipt voucher (cash/card, PENDING until document Post)
 *  10.  Stock update (product_log_entry)
 *  11.  TransactionExpenseDetail (cash account head expense line)
 *  12.  DO status update (DOMaster → INVOICED)
 */
export async function createSale(pool, body, authStaff, { salesChannel = 'ERP' } = {}) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }

  let branchId = parseBranchId(body.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const okBranch = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!okBranch) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) {
    const err = new Error('At least one line is required');
    err.status = 400;
    throw err;
  }

  const quotationIdOpt = nullableLong(body.quotationId);
  const deliveryOrderIdOpt = nullableLong(body.deliveryOrderId);

  let sumLineTotal = 0;
  let sumSub = 0;
  const normalized = [];

  for (let i = 0; i < lines.length; i += 1) {
    const L = lines[i] || {};
    const productId = Math.trunc(num(L.productId, 0));
    if (productId < 1) {
      const err = new Error(`Line ${i + 1}: productId is required (pick a product from the catalog)`);
      err.status = 400;
      throw err;
    }
    const qty = num(L.qty, 0);
    if (qty <= 0) {
      const err = new Error(`Line ${i + 1}: qty must be > 0`);
      err.status = 400;
      throw err;
    }
    const unitPrice = round2(num(L.unitPrice, 0));
    const unitCost = round2(num(L.unitCost, 0));
    const disc = round2(num(L.discountAmount ?? L.discAmt ?? L.itemDiscount, 0));
    const subL = round2(num(L.subtotalAmount ?? L.subTotal, qty * unitPrice - disc));
    const tax1 = round2(num(L.taxAmt ?? L.tax1Amount, 0));
    const r1 = round2(num(L.taxPercent ?? L.tax1Rate, subL > 0.0001 ? round2((tax1 / subL) * 100) : 0));
    const lt = round2(num(L.lineTotal, subL + tax1));

    sumLineTotal += lt;
    sumSub += subL;

    const desc = str(L.shortDescription ?? L.productDescription, 200) || 'Item';

    normalized.push({
      productId,
      qty,
      unitPrice,
      unitCost,
      packQty: Math.max(num(L.packQty, 1), 0.0001),
      discountAmount: disc,
      subtotalAmount: subL,
      tax1Amount: tax1,
      tax2Amount: 0,
      tax3Amount: 0,
      tax1Rate: r1,
      tax2Rate: 0,
      tax3Rate: 0,
      lineTotal: lt,
      shortDescription: desc.slice(0, 50),
      quotationId: nullableLong(L.quotationId),
      doId: nullableLong(L.doId ?? L.deliveryOrderId),
    });
  }

  sumLineTotal = round2(sumLineTotal);
  sumSub = round2(sumSub);

  const docAmounts = computeSaleDocumentAmounts(normalized, body);
  const {
    baseSub,
    subAfterDisc,
    headerDisc,
    sumTax: adjSumTax,
    roundOff,
    net: netExpected,
    effTaxRate,
  } = docAmounts;
  const netClient = round2(num(body.netAmount, 0));
  const sumTax = adjSumTax;

  if (Math.abs(netExpected - netClient) > 0.05) {
    const err = new Error(
      `Net amount does not match lines and discounts (expected ${netExpected.toFixed(2)}, got ${netClient.toFixed(2)})`,
    );
    err.status = 400;
    throw err;
  }

  if (netClient <= 0) {
    const err = new Error('netAmount must be > 0');
    err.status = 400;
    throw err;
  }

  const paymentModeRaw = str(body.paymentMode, 50);
  if (!paymentModeRaw) {
    const err = new Error('paymentMode is required');
    err.status = 400;
    throw err;
  }
  const paymentMode = paymentModeRaw.toUpperCase().includes('CREDIT')
    ? paymentModeRaw.toUpperCase().includes('CARD') ? 'CREDITCARD' : 'CREDIT'
    : paymentModeRaw.toUpperCase().includes('CASH') ? 'CASH' : paymentModeRaw.toUpperCase();

  let receiptLedgerId = nullableLong(body.receiptLedgerId ?? body.accountHeadId);
  if ((paymentMode === 'CASH' || paymentMode === 'CREDITCARD') && receiptLedgerId == null) {
    receiptLedgerId = await accountsParameterRepo.getParameterAccountId(
      pool, companyId, branchId, paymentMode === 'CREDITCARD' ? 'DEFAULT_CARD_LEDGER' : 'DEFAULT_CASH_LEDGER',
    );
  }
  if (paymentMode === 'CASH' || paymentMode === 'CREDITCARD') {
    if (receiptLedgerId == null) {
      const err = new Error('Cash/card ledger not configured — set in Account Integration (Payment / Receipt tab)');
      err.status = 400;
      throw err;
    }
    const head = await accountHeadRepo.findAccountHead(pool, companyId, receiptLedgerId);
    if (!head) {
      const err = new Error('Invalid cash/card ledger for this company');
      err.status = 400;
      throw err;
    }
  }

  // ───── STEP 1b: Privilege checks (VB CheckPrivilage + credit checks) ─────
  const privilegeWarnings = [];

  // STEP 7: Customer receivable ledger (party sub-ledger under CUSTOMER_PARENT_LEDGER)
  const customerId = nullableLong(body.customerId);
  if (customerId == null) {
    const err = new Error('customerId is required');
    err.status = 400;
    throw err;
  }
  let customerLedgerId = null;
  let customerHasLedger = false;
  if (customerId != null) {
    customerLedgerId = await resolveCustomerLedgerId(pool, companyId, branchId, customerId);
    customerHasLedger = customerLedgerId != null;
    if (!customerHasLedger) {
      privilegeWarnings.push(
        `Customer (ID ${customerId}) has no receivable ledger — set customer code and configure ` +
        'CUSTOMER_PARENT_LEDGER in Branch Account Integration.',
      );
    }
  }
  for (let i = 0; i < normalized.length; i += 1) {
    const L = normalized[i];
    if (L.unitPrice <= 0 && L.qty > 0) {
      privilegeWarnings.push(`Line ${i + 1}: Zero unit price is not allowed.`);
    }
    try {
      const pricing = await productRepo.getProductPricingForPrivilege(pool, companyId, branchId, L.productId);
      const qtyOnHand = await stockRepo.getStockQty(pool, companyId, branchId, L.productId);
      if (pricing) {
        if (pricing.minimumRetailPrice > 0 && L.unitPrice < pricing.minimumRetailPrice) {
          privilegeWarnings.push(
            `Line ${i + 1}: Unit price ${L.unitPrice.toFixed(2)} is below minimum retail price ${pricing.minimumRetailPrice.toFixed(2)}.`,
          );
        }
        const lineProfit = (L.unitPrice * L.qty) - (pricing.averageCost * L.qty) - L.discountAmount;
        if (pricing.averageCost > 0 && lineProfit < 0) {
          privilegeWarnings.push(
            `Line ${i + 1}: Loss sale — selling below cost (profit: ${lineProfit.toFixed(2)}).`,
          );
        }
      }
      if (qtyOnHand < L.qty) {
        privilegeWarnings.push(
          `Line ${i + 1}: Minus stock — available ${qtyOnHand.toFixed(2)}, selling ${L.qty}.`,
        );
      }
    } catch { /* product_inventory may not exist for all products */ }
  }

  if (paymentMode === 'CREDIT' && customerId != null) {
    try {
      const creditInfo = await customerRepo.getCustomerCreditInfo(pool, companyId, customerId);
      if (creditInfo && creditInfo.creditLimit > 0) {
        const newBalance = creditInfo.osBalance + netClient;
        if (newBalance > creditInfo.creditLimit) {
          privilegeWarnings.push(
            `Credit limit exceeded: limit ${creditInfo.creditLimit.toFixed(2)}, ` +
            `current OS ${creditInfo.osBalance.toFixed(2)}, this sale ${netClient.toFixed(2)}, ` +
            `new balance ${newBalance.toFixed(2)}.`,
          );
        }
      }
    } catch { /* customer credit info may not be available */ }
  }

  if (privilegeWarnings.length > 0 && !body.overridePrivilegeChecks) {
    const err = new Error(
      'Privilege check warnings:\n' + privilegeWarnings.join('\n'),
    );
    err.status = 422;
    err.warnings = privilegeWarnings;
    err.requiresOverride = true;
    throw err;
  }

  let paid = round2(num(body.paidAmount, netClient));
  if (paid < netClient - 0.05) {
    const err = new Error('paidAmount must be >= netAmount');
    err.status = 400;
    throw err;
  }

  const counterNo = 99;

  const cashAmount = paymentMode === 'CASH' ? paid : 0;
  const creditAmount = paymentMode === 'CREDIT' ? netClient : 0;
  const creditCardAmount = paymentMode === 'CREDITCARD' ? paid : 0;
  const balancePaid = round2(Math.max(0, paid - netClient));

  const auditBy = auditStaffId(authStaff);
  const staffPk = nullableLong(authStaff.staff_id) ?? nullableLong(authStaff.id);

  const remarksParts = [];
  if (body.salesTerms) remarksParts.push(String(body.salesTerms).trim());
  if (body.billing?.salesTerms) remarksParts.push(String(body.billing.salesTerms).trim());
  if (quotationIdOpt) remarksParts.push(`Q:${quotationIdOpt}`);
  if (deliveryOrderIdOpt) remarksParts.push(`DO:${deliveryOrderIdOpt}`);
  const remarks = str(remarksParts.filter(Boolean).join(' | '), 200);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`ops.sales_erp:${companyId}`]);

    // ───── STEP 3: SalesMaster INSERT ─────
    const salesId = await salesRepo.nextSalesId(client, companyId);
    const billNo = await salesRepo.nextBillNo(client, companyId, branchId);
    const invoiceNo = await nextDocNo(client, {
      companyId,
      branchId,
      sequenceCode: salesChannel === 'VAN' ? 'VAN_SALES' : 'SALES',
      fiscalYear: new Date().getFullYear(),
    });

    await saleEntryRepo.insertSalesMaster(client, {
      companyId,
      salesId,
      branchId,
      kotMasterId: null,
      counterNo,
      billNo,
      customerId,
      paymentMode,
      creditCardNo: paymentMode === 'CREDITCARD' ? str(body.creditCardNo ?? body.billing?.creditCardNo, 50) : null,
      amount: netClient,
      cashAmount,
      creditAmount,
      creditCardAmount,
      paidAmount: paid,
      balancePaid,
      discountAmount: headerDisc,
      subtotalAmount: baseSub,
      taxableAmount: subAfterDisc,
      tax1Amount: sumTax,
      tax2Amount: 0,
      tax3Amount: 0,
      tax1Rate: effTaxRate,
      tax2Rate: 0,
      tax3Rate: 0,
      roundOffAdj: roundOff,
      waiterId: null,
      tableId: null,
      areaId: null,
      noOfCustomers: 0,
      staffId: staffPk,
      remarks,
      createdBy: auditBy,
      modifiedBy: auditBy,
    });

    // Set the formatted invoice_no (INV-0042) generated from document_sequence.
    await client.query(
      `UPDATE ops.sales_master SET invoice_no = $1 WHERE company_id = $2 AND sales_id = $3`,
      [invoiceNo, companyId, salesId],
    );

    // ───── STEP 3b: ERP header fields ─────
    try {
      await saleEntryRepo.updateSalesMasterErpFields(client, companyId, salesId, {
        quotationId: quotationIdOpt,
        deliveryOrderId: deliveryOrderIdOpt,
        receiptLedgerId: paymentMode === 'CASH' || paymentMode === 'CREDITCARD' ? receiptLedgerId : null,
      });
    } catch (e) {
      if (e.code === '42703') {
        const err = new Error(
          'sales_master is missing ERP columns. Apply migrations 029 (quotation/do) and 031 (receipt_ledger_id).',
        );
        err.status = 503;
        throw err;
      }
      throw e;
    }

    // ───── STEP 4: SalesChild INSERT (per line with quotation_id + do_id) ─────
    for (const L of normalized) {
      const salesChildId = await salesRepo.nextSalesChildId(client, companyId);
      await salesRepo.insertSalesChild(client, {
        companyId,
        salesChildId,
        salesId,
        branchId,
        kotChildId: null,
        productId: L.productId,
        shortDescription: L.shortDescription,
        groupId: null,
        qty: L.qty,
        unitPrice: L.unitPrice,
        unitCost: L.unitCost,
        packQty: L.packQty,
        discountAmount: L.discountAmount,
        lineTotal: L.lineTotal,
        tax1Amount: L.tax1Amount,
        tax2Amount: L.tax2Amount,
        tax3Amount: L.tax3Amount,
        tax1Rate: L.tax1Rate,
        tax2Rate: L.tax2Rate,
        tax3Rate: L.tax3Rate,
        subtotalAmount: L.subtotalAmount,
        modifier: null,
        createdBy: auditBy,
        modifiedBy: auditBy,
        quotationId: L.quotationId,
        doId: L.doId,
      });

      // ───── STEP 10: Stock update (product_log_entry) ─────
      try {
        await client.query('SAVEPOINT stock_update');
        const currentQty = await stockRepo.getStockQty(client, companyId, branchId, L.productId);
        const newQty = round2(currentQty - L.qty);
        if (!body.overridePrivilegeChecks && newQty < 0) {
          const label = L.shortDescription || `Product #${L.productId}`;
          const err = new Error(
            `Insufficient stock for "${label}": available ${currentQty}, requested ${L.qty}`,
          );
          err.status = 400;
          throw err;
        }
        const logId = await stockRepo.nextProductLogId(client, companyId);
        await stockRepo.insertProductLogEntry(client, {
          companyId,
          branchId,
          productLogId: logId,
          productId: L.productId,
          transactionType: 'SALES',
          transactionId: salesId,
          qty: -L.qty,
          balanceQty: newQty,
          unitCost: L.unitCost,
          unitPrice: L.unitPrice,
          createdBy: staffIdForStockLog(authStaff) ?? auditBy,
        });
        // Keep product_inventory.qty_on_hand in step with the log so stock
        // reports (closing qty) and movement history agree.
        await stockRepo.adjustQtyOnHand(client, companyId, branchId, L.productId, -L.qty);
        await client.query('RELEASE SAVEPOINT stock_update');
      } catch (stockErr) {
        await client.query('ROLLBACK TO SAVEPOINT stock_update');
        if (stockErr.code === '42P01' || stockErr.code === '42703') {
          console.warn('product_log_entry schema mismatch — stock update skipped');
        } else {
          throw stockErr;
        }
      }
    }

    // ───── STEP 4b: SalesPaymentSplit ─────
    await salesRepo.insertSalesPaymentSplit(client, {
      companyId,
      salesId,
      payerNo: 1,
      payMode: paymentMode === 'CREDITCARD' ? 'CARD' : paymentMode === 'CREDIT' ? 'CREDIT' : 'CASH',
      billAmount: paid,
      branchId,
      counterId: counterNo,
      staffId: staffPk,
      refNo: str(body.paymentRefNo, 100),
    });

    // ───── STEP 6: MultiReferenceTable (document_reference_map) ─────
    try {
      await client.query('SAVEPOINT doc_ref_save');
      // Quotation links
      const qtnIds = [];
      if (quotationIdOpt) qtnIds.push(quotationIdOpt);
      for (const L of normalized) {
        if (L.quotationId && !qtnIds.includes(L.quotationId)) qtnIds.push(L.quotationId);
      }
      if (qtnIds.length > 0) {
        await docRefRepo.deleteBySourceAndType(client, companyId, salesId, 'SL', 'QU');
        for (const qid of qtnIds) {
          const refId = await docRefRepo.nextDocumentReferenceId(client, companyId);
          await docRefRepo.insertDocumentReference(client, {
            companyId,
            branchId,
            documentReferenceId: refId,
            sourceDocId: salesId,
            sourceDocType: 'SL',
            sourceDocNo: String(billNo),
            referenceDocId: qid,
            referenceDocType: 'QU',
            referenceDocNo: String(qid),
          });
        }
      }

      // DO links
      const doIds = [];
      if (deliveryOrderIdOpt) doIds.push(deliveryOrderIdOpt);
      for (const L of normalized) {
        if (L.doId && !doIds.includes(L.doId)) doIds.push(L.doId);
      }
      if (doIds.length > 0) {
        await docRefRepo.deleteBySourceAndType(client, companyId, salesId, 'SL', 'DO');
        for (const did of doIds) {
          const refId = await docRefRepo.nextDocumentReferenceId(client, companyId);
          await docRefRepo.insertDocumentReference(client, {
            companyId,
            branchId,
            documentReferenceId: refId,
            sourceDocId: salesId,
            sourceDocType: 'SL',
            sourceDocNo: String(billNo),
            referenceDocId: did,
            referenceDocType: 'DO',
            referenceDocNo: String(did),
          });
        }
      }
    } catch (docRefErr) {
      await client.query('ROLLBACK TO SAVEPOINT doc_ref_save').catch(() => {});
      if (docRefErr.code === '42P01' || docRefErr.code === '42703') {
        console.warn('document_reference_map table missing — doc links skipped');
      } else {
        throw docRefErr;
      }
    }

    // ───── STEP 8: VoucherMaster + VoucherDetail (double-entry journal) ─────
    let salesVoucherId = null;
    try {
      await client.query('SAVEPOINT voucher_save');

      const customerLedgerIdForVoucher = customerId != null
        ? await resolveCustomerLedgerId(client, companyId, branchId, customerId)
        : null;

      const salesVoucherTypeId = await voucherRepo.getVoucherTypeId(client, companyId, 'SalesEntryVoucherName', branchId) || 1;
      const voucherPrefix = await voucherRepo.getVoucherPrefix(client, companyId, salesVoucherTypeId) || 'SVT';

      const saleLinePlan = await resolveSaleVoucherLinePlan(client, companyId, branchId, {
        billNo,
        customerId,
        customerLedgerId: customerLedgerIdForVoucher,
        customerHasLedger,
        paymentMode,
        normalized,
        sumTax,
        headerDisc,
        roundOff,
        netClient,
        receiptLedgerId,
      });

      if (saleLinePlan.warnings?.length) {
        privilegeWarnings.push(...saleLinePlan.warnings);
      }

      if (saleLinePlan.hasSalesCr && saleLinePlan.lines.length) {
        const vMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
        const voucherBillNo = Number(billNo);

        await voucherRepo.insertVoucherMaster(client, {
          companyId,
          branchId,
          voucherMasterId: vMasterId,
          voucherTypeId: salesVoucherTypeId,
          autoVoucherNo: voucherBillNo,
          manualVoucherNo: String(billNo),
          voucherPrefix,
          referenceNo: String(billNo),
          voucherAmount: netClient,
          remarks: `SVT: ${billNo}`,
          postStatus: 'PENDING',
          creationMode: 'INVENTORYACCOUNTS',
          voucherPostedId: salesId,
          counterCloseNo: 'PENDING',
          recordStatus: 'ACTIVE',
          createdBy: auditBy,
        });
        salesVoucherId = vMasterId;

        let detailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);
        for (const line of saleLinePlan.lines) {
          await voucherRepo.insertVoucherDetail(client, {
            companyId,
            branchId,
            voucherDetailId: detailSeq++,
            voucherMasterId: vMasterId,
            accountId: line.accountId,
            creditAmount: line.creditAmount,
            debitAmount: line.debitAmount,
            outstandingBalance: line.outstandingBalance,
            narration: line.narration,
            postStatus: 'PENDING',
            recordStatus: 'ACTIVE',
            createdBy: auditBy,
          });
        }
      }

      const voucherBillNo = Number(billNo);

      // ───── STEP 9: Receipt voucher (cash/card) — PENDING until document Post ─────
      if ((paymentMode === 'CASH' || paymentMode === 'CREDITCARD') && receiptLedgerId != null && customerLedgerIdForVoucher != null) {
        const recVoucherTypeId = await voucherRepo.getVoucherTypeId(client, companyId, 'ReceiptVoucherNameCustomer', branchId) || 2;
        const recPrefix = await voucherRepo.getVoucherPrefix(client, companyId, recVoucherTypeId) || 'RCV';

        const recMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);

        await voucherRepo.insertVoucherMaster(client, {
          companyId,
          branchId,
          voucherMasterId: recMasterId,
          voucherTypeId: recVoucherTypeId,
          autoVoucherNo: voucherBillNo,
          manualVoucherNo: String(billNo),
          voucherPrefix: recPrefix,
          referenceNo: String(billNo),
          voucherAmount: paid,
          remarks: `RCV: ${billNo}`,
          postStatus: 'PENDING',
          creationMode: 'INVENTORYACCOUNTS',
          voucherPostedId: salesId,
          counterCloseNo: 'PENDING',
          recordStatus: 'ACTIVE',
          createdBy: auditBy,
        });

        let recDetailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);

        // DR: Cash/Card account (receipt_ledger_id)
        await voucherRepo.insertVoucherDetail(client, {
          companyId,
          branchId,
          voucherDetailId: recDetailSeq++,
          voucherMasterId: recMasterId,
          accountId: receiptLedgerId,
          creditAmount: 0,
          debitAmount: paid,
          outstandingBalance: 0,
          narration: `RCV: ${billNo}`,
          postStatus: 'PENDING',
          recordStatus: 'ACTIVE',
          createdBy: auditBy,
        });

        // CR: Customer (debtor cleared on post)
        await voucherRepo.insertVoucherDetail(client, {
          companyId,
          branchId,
          voucherDetailId: recDetailSeq++,
          voucherMasterId: recMasterId,
          accountId: customerLedgerIdForVoucher,
          creditAmount: paid,
          debitAmount: 0,
          outstandingBalance: 0,
          narration: `RCV: ${billNo}`,
          postStatus: 'PENDING',
          recordStatus: 'ACTIVE',
          createdBy: auditBy,
        });
      }
    } catch (voucherErr) {
      await client.query('ROLLBACK TO SAVEPOINT voucher_save').catch(() => {});
      if (voucherErr.code === '42P01' || voucherErr.code === '42703') {
        console.warn('Voucher tables missing — accounting entries skipped');
      } else {
        throw voucherErr;
      }
    }

    // ───── STEP 11: TransactionExpenseDetail (cash account head expense line) ─────
    if (receiptLedgerId != null && (paymentMode === 'CASH' || paymentMode === 'CREDITCARD')) {
      try {
        await client.query('SAVEPOINT txn_expense_save');
        await txnExpenseRepo.deleteByTransactionMaster(client, companyId, salesId, 'SALES');
        const txnExpId = await txnExpenseRepo.nextTransactionExpenseId(client, companyId);
        await txnExpenseRepo.insertTransactionExpenseDetail(client, {
          companyId,
          branchId,
          transactionExpenseId: txnExpId,
          transactionMasterId: salesId,
          ledgerId: receiptLedgerId,
          description: 'SALES',
          referenceNo: String(billNo),
          amount: netClient,
          transactionType: 'SALES',
          expenseType: paymentMode === 'CREDITCARD' ? 'CREDIT CARD SALES' : 'CASH SALES',
          taxRate: subAfterDisc > 0.0001 ? effTaxRate : 0,
          createdBy: auditBy,
        });
      } catch (txnErr) {
        await client.query('ROLLBACK TO SAVEPOINT txn_expense_save').catch(() => {});
        if (txnErr.code === '42P01' || txnErr.code === '42703' || txnErr.code === '22P02') {
          console.warn('transaction_expense_detail insert skipped:', txnErr.message);
        } else {
          throw txnErr;
        }
      }
    }

    // ───── STEP 12: DO status update (DOMaster → INVOICED) ─────
    const allDoIds = [];
    if (deliveryOrderIdOpt) allDoIds.push(deliveryOrderIdOpt);
    for (const L of normalized) {
      if (L.doId && !allDoIds.includes(L.doId)) allDoIds.push(L.doId);
    }
    if (allDoIds.length > 0) {
      try {
        await deliveryOrderRepo.markDOsInvoiced(client, companyId, allDoIds, salesId, billNo);
      } catch (doErr) {
        if (doErr.code === '42703' || doErr.code === '42P01') {
          console.warn('DO invoice_status column or table issue — DO status update skipped');
        } else {
          throw doErr;
        }
      }
    }

    const outstandingBalance = netClient;

    return {
      ok: true,
      salesId: String(salesId),
      billNo: String(billNo),
      netAmount: String(netClient),
      receiptLedgerId:
        paymentMode === 'CASH' || paymentMode === 'CREDITCARD' ? String(receiptLedgerId) : null,
      salesVoucherId: salesVoucherId ? String(salesVoucherId) : null,
      salesPosted: false,
      receiptPosted: false,
      outstandingBalance: round2(outstandingBalance).toFixed(2),
      privilegeWarnings: privilegeWarnings.length > 0 ? privilegeWarnings : undefined,
      message: 'Sale saved.',
    };
  });
}

/** PUT /api/sales/:salesId — update draft sale (not posted). */
export async function updateSale(pool, body, authStaff, salesIdParam) {
  const companyId = Number(authStaff.company_id);
  const salesId = Math.trunc(num(salesIdParam, 0));
  if (salesId < 1) {
    const err = new Error('Invalid salesId');
    err.status = 400;
    throw err;
  }

  let branchId = parseBranchId(body.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const existing = await saleEntryRepo.getSaleMaster(pool, companyId, salesId);
  if (!existing) {
    const err = new Error('Sale not found');
    err.status = 404;
    throw err;
  }
  if (Number(existing.branch_id) !== branchId) {
    const err = new Error('Sale belongs to a different branch');
    err.status = 400;
    throw err;
  }

  const { salesVoucher, receiptVoucher } = await findSaleVouchers(pool, companyId, branchId, salesId);
  if (salesVoucher?.master?.post_status === 'POSTED') {
    const err = new Error('Posted sale cannot be updated — unpost first');
    err.status = 409;
    throw err;
  }
  if (receiptVoucher?.master?.post_status === 'POSTED') {
    const err = new Error('Receipt already done.');
    err.status = 409;
    throw err;
  }

  const prep = await prepareSaleDocumentInput(pool, body, authStaff, branchId);
  const billNo = existing.bill_no != null ? String(existing.bill_no) : String(salesId);
  const auditBy = auditStaffId(authStaff);
  const staffPk = nullableLong(authStaff.staff_id) ?? nullableLong(authStaff.id);

  return withTransaction(async (client) => {
    const oldChildren = await returnRepo.listSaleLines(pool, companyId, salesId);
    await reverseSaleStockOut(client, authStaff, companyId, branchId, salesId, oldChildren);
    await returnRepo.softDeleteSaleChildren(client, companyId, salesId);

    await saleEntryRepo.updateSalesMasterForEdit(client, companyId, salesId, {
      customerId: prep.customerId,
      counterNo: prep.counterNo,
      paymentMode: prep.paymentMode,
      creditCardNo: prep.creditCardNo,
      amount: prep.netClient,
      cashAmount: prep.cashAmount,
      creditAmount: prep.creditAmount,
      creditCardAmount: prep.creditCardAmount,
      paidAmount: prep.paid,
      balancePaid: prep.balancePaid,
      discountAmount: prep.headerDisc,
      subtotalAmount: prep.baseSub,
      taxableAmount: prep.subAfterDisc,
      tax1Amount: prep.sumTax,
      tax1Rate: prep.subAfterDisc > 0.0001 ? round2((prep.sumTax / prep.subAfterDisc) * 100) : 0,
      roundOffAdj: prep.roundOff,
      remarks: prep.remarks,
      modifiedBy: auditBy,
    });

    try {
      await saleEntryRepo.updateSalesMasterErpFields(client, companyId, salesId, {
        quotationId: prep.quotationIdOpt,
        deliveryOrderId: prep.deliveryOrderIdOpt,
        receiptLedgerId: prep.paymentMode === 'CASH' || prep.paymentMode === 'CREDITCARD' ? prep.receiptLedgerId : null,
      });
    } catch (e) {
      if (e.code !== '42703') throw e;
    }

    await insertSaleLines(client, authStaff, companyId, branchId, salesId, prep.normalized);
    await applySaleStockOut(client, authStaff, companyId, branchId, salesId, prep.normalized, {
      allowMinusStock: Boolean(body.overridePrivilegeChecks),
    });

    await saleEntryRepo.deleteSalesPaymentSplits(client, companyId, salesId);
    await salesRepo.insertSalesPaymentSplit(client, {
      companyId,
      salesId,
      payerNo: 1,
      payMode: prep.paymentMode === 'CREDITCARD' ? 'CARD' : prep.paymentMode === 'CREDIT' ? 'CREDIT' : 'CASH',
      billAmount: prep.paid,
      branchId,
      counterId: prep.counterNo,
      staffId: staffPk,
      refNo: str(body.paymentRefNo, 100),
    });

    let salesVoucherId = null;
    try {
      await client.query('SAVEPOINT voucher_save');
      salesVoucherId = await rewriteSaleVouchers(client, {
        companyId, branchId, salesId, billNo, auditBy,
        customerId: prep.customerId,
        customerLedgerId: prep.customerLedgerId,
        customerHasLedger: prep.customerHasLedger,
        paymentMode: prep.paymentMode,
        normalized: prep.normalized,
        sumTax: prep.sumTax,
        headerDisc: prep.headerDisc,
        roundOff: prep.roundOff,
        netClient: prep.netClient,
        paid: prep.paid,
        receiptLedgerId: prep.receiptLedgerId,
        salesVoucher,
        receiptVoucher,
      });
      await client.query('RELEASE SAVEPOINT voucher_save');
    } catch (voucherErr) {
      await client.query('ROLLBACK TO SAVEPOINT voucher_save').catch(() => {});
      if (voucherErr.code !== '42P01' && voucherErr.code !== '42703') throw voucherErr;
    }

    if (prep.receiptLedgerId != null && (prep.paymentMode === 'CASH' || prep.paymentMode === 'CREDITCARD')) {
      try {
        await client.query('SAVEPOINT txn_expense_save');
        await txnExpenseRepo.deleteByTransactionMaster(client, companyId, salesId, 'SALES');
        const txnExpId = await txnExpenseRepo.nextTransactionExpenseId(client, companyId);
        await txnExpenseRepo.insertTransactionExpenseDetail(client, {
          companyId, branchId, transactionExpenseId: txnExpId, transactionMasterId: salesId,
          ledgerId: prep.receiptLedgerId, description: 'SALES', referenceNo: billNo,
          amount: prep.netClient, transactionType: 'SALES',
          expenseType: prep.paymentMode === 'CREDITCARD' ? 'CREDIT CARD SALES' : 'CASH SALES',
          taxRate: prep.subAfterDisc > 0.0001 ? prep.effTaxRate : 0, createdBy: auditBy,
        });
        await client.query('RELEASE SAVEPOINT txn_expense_save');
      } catch (txnErr) {
        await client.query('ROLLBACK TO SAVEPOINT txn_expense_save').catch(() => {});
        if (txnErr.code !== '42P01' && txnErr.code !== '42703' && txnErr.code !== '22P02') throw txnErr;
      }
    }

    return {
      ok: true,
      salesId: String(salesId),
      billNo,
      netAmount: String(prep.netClient),
      receiptLedgerId: prep.paymentMode === 'CASH' || prep.paymentMode === 'CREDITCARD' ? String(prep.receiptLedgerId) : null,
      salesVoucherId: salesVoucherId ? String(salesVoucherId) : null,
      salesPosted: false,
      receiptPosted: false,
      outstandingBalance: round2(prep.netClient).toFixed(2),
      updated: true,
      message: 'Sale updated.',
    };
  });
}

// ─── Accounts preview / post (mirrors purchase flow) ───

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

async function enrichVoucherLinesWithAccountHeads(db, companyId, lines) {
  const out = [];
  for (const line of lines || []) {
    const head = line.accountId ? await accountHeadRepo.findAccountHead(db, companyId, line.accountId) : null;
    out.push({
      accountId: line.accountId,
      accountNo: head?.account_no ?? head?.accountNo ?? line.accountNo ?? '',
      accountHead: head?.account_head ?? head?.accountHead ?? line.accountHead ?? '',
      debitAmount: num(line.debitAmount, 0),
      creditAmount: num(line.creditAmount, 0),
      outstandingBalance: num(line.outstandingBalance, 0),
      narration: line.narration || '',
    });
  }
  return out;
}

async function findSaleVouchers(db, companyId, branchId, salesId) {
  const salesVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(db, companyId, 'SalesEntryVoucherName', branchId)) || 1;
  const receiptVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(db, companyId, 'ReceiptVoucherNameCustomer', branchId))
    || (await voucherRepo.getVoucherTypeId(db, companyId, 'ReceiptVoucherName', branchId))
    || 2;

  const vouchers = await voucherRepo.listVouchersByPostedId(db, companyId, branchId, salesId, 'INVENTORYACCOUNTS');
  let salesVoucher = null;
  let receiptVoucher = null;
  for (const v of vouchers) {
    const typeId = Number(v.master.voucher_type_id);
    if (typeId === salesVoucherTypeId) salesVoucher = v;
    else if (typeId === receiptVoucherTypeId) receiptVoucher = v;
    else if (!salesVoucher) salesVoucher = v;
    else if (!receiptVoucher) receiptVoucher = v;
  }
  return { salesVoucherTypeId, receiptVoucherTypeId, salesVoucher, receiptVoucher };
}

function saleOutstandingFromVouchers(mappedSales, mappedReceipt, fallbackNet) {
  if (mappedReceipt?.postStatus === 'POSTED') return 0;
  if (mappedSales?.lines?.length) {
    const os = mappedSales.lines
      .filter((l) => l.debitAmount > 0)
      .reduce((s, l) => s + num(l.outstandingBalance, 0), 0);
    if (os > 0) return round2(os);
  }
  return round2(num(fallbackNet, 0));
}

async function normalizeSaleBodyForAccounts(pool, companyId, branchId, body) {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) {
    const err = new Error('Add at least one line item');
    err.status = 400;
    throw err;
  }

  let sumLineTotal = 0;
  let sumSub = 0;
  const normalized = [];

  for (let i = 0; i < lines.length; i += 1) {
    const L = lines[i] || {};
    const productId = Math.trunc(num(L.productId, 0));
    if (productId < 1) {
      const err = new Error(`Line ${i + 1}: productId is required`);
      err.status = 400;
      throw err;
    }
    const qty = num(L.qty, 0);
    if (qty <= 0) {
      const err = new Error(`Line ${i + 1}: qty must be > 0`);
      err.status = 400;
      throw err;
    }
    const unitPrice = round2(num(L.unitPrice, 0));
    const disc = round2(num(L.discountAmount ?? L.discAmt, 0));
    const subL = round2(num(L.subtotalAmount ?? L.subTotal, qty * unitPrice - disc));
    const tax1 = round2(num(L.taxAmt ?? L.tax1Amount, 0));
    const r1 = round2(num(L.taxPercent ?? L.tax1Rate, subL > 0.0001 ? round2((tax1 / subL) * 100) : 0));
    const lt = round2(num(L.lineTotal, subL + tax1));
    sumLineTotal += lt;
    sumSub += subL;
    normalized.push({
      productId, qty, unitPrice, subtotalAmount: subL, tax1Amount: tax1, tax1Rate: r1, lineTotal: lt,
    });
  }

  sumLineTotal = round2(sumLineTotal);
  sumSub = round2(sumSub);

  const {
    baseSub,
    subAfterDisc,
    headerDisc,
    sumTax: adjSumTax,
    roundOff,
    net: netClient,
  } = computeSaleDocumentAmounts(normalized, body);

  const paymentModeRaw = str(body.paymentMode, 50) || 'CASH';
  const paymentMode = paymentModeRaw.toUpperCase().includes('CREDIT')
    ? paymentModeRaw.toUpperCase().includes('CARD') ? 'CREDITCARD' : 'CREDIT'
    : 'CASH';

  let receiptLedgerId = nullableLong(body.receiptLedgerId ?? body.accountHeadId);
  if ((paymentMode === 'CASH' || paymentMode === 'CREDITCARD') && receiptLedgerId == null) {
    receiptLedgerId = await accountsParameterRepo.getParameterAccountId(
      pool, companyId, branchId, paymentMode === 'CREDITCARD' ? 'DEFAULT_CARD_LEDGER' : 'DEFAULT_CASH_LEDGER',
    );
  }

  const customerId = nullableLong(body.customerId);
  const customerLedgerId = customerId != null
    ? await resolveCustomerLedgerId(pool, companyId, branchId, customerId)
    : null;
  const customerHasLedger = customerLedgerId != null;

  const paid = round2(num(body.paidAmount, netClient));

  return {
    normalized,
    baseSub,
    sumSub: subAfterDisc,
    sumTax: adjSumTax,
    sumLineTotal,
    headerDisc,
    roundOff,
    netClient,
    paymentMode,
    receiptLedgerId,
    customerId,
    customerLedgerId,
    customerHasLedger,
    paid,
  };
}

function resolveSaleExemptCrLedger(salesCrTaxableId, salesCrExemptId, warnings) {
  if (salesCrExemptId && salesCrExemptId !== salesCrTaxableId) {
    return salesCrExemptId;
  }
  if (salesCrExemptId === salesCrTaxableId) {
    warnings.push(
      'Sales CR — Exempted uses the same ledger as taxable sales. Assign a separate zero-rated ledger in Branch Account Integration.',
    );
  } else {
    warnings.push(
      'Sales CR — Exempted is not configured. Zero-rated line amounts are posted to the taxable sales ledger.',
    );
  }
  return salesCrTaxableId;
}

function resolveSaleCustomerDebit(netClient, amtTaxable, amtExempt, sumTax, headerDisc, roundOff, warnings) {
  const computed = round2(amtTaxable + amtExempt + sumTax - headerDisc + roundOff);
  if (Math.abs(netClient - computed) > 0.05) {
    warnings.push(
      `Net amount ${netClient.toFixed(2)} differs from line totals ${computed.toFixed(2)} — customer debit uses ${computed.toFixed(2)}.`,
    );
    return computed;
  }
  return netClient;
}

async function resolveSaleVoucherLinePlan(client, companyId, branchId, {
  billNo,
  customerId,
  customerLedgerId: customerLedgerIdIn,
  customerHasLedger: customerHasLedgerIn,
  paymentMode,
  normalized,
  sumTax,
  headerDisc,
  roundOff,
  netClient,
  receiptLedgerId,
}) {
  const warnings = [];
  await accountsParameterRepo.ensureBranchIntegrationDefaults(client, companyId, branchId);

  let customerLedgerId = customerLedgerIdIn ?? null;
  if (customerId != null && !customerLedgerId) {
    customerLedgerId = await resolveCustomerLedgerId(client, companyId, branchId, customerId);
  }
  const customerHasLedger = customerHasLedgerIn ?? customerLedgerId != null;

  const { taxable: amtTaxable, exempt: amtExempt } = splitTaxableSubtotals(normalized);
  const salesCrTaxableId = (await resolveBoSalesCrLedger(client, companyId, branchId, paymentMode))
    || receiptLedgerId;
  const salesCrExemptId = amtExempt > 0
    ? await resolveBoSalesCrExemptLedger(client, companyId, branchId)
    : null;
  const outputTaxLedgerId = sumTax > 0 ? await resolveOutputTaxLedger(client, companyId, branchId) : null;
  const discountLedgerId = headerDisc > 0
    ? await resolveDiscountLedger(client, companyId, branchId, 'sales')
    : null;
  const roundLedgerId = roundOff !== 0
    ? await resolveRoundingLedger(client, companyId, branchId, 'sales')
    : null;

  const hasSalesCr = salesCrTaxableId != null || (amtExempt > 0 && salesCrExemptId != null);
  const lines = [];

  if (!hasSalesCr) {
    warnings.push(
      'Sales not posted to accounts — configure sales CR ledger in Account Integration (Sales Back Office tab)',
    );
    return {
      lines,
      warnings,
      hasSalesCr: false,
      customerDebit: netClient,
      headerDisc,
      roundOff,
    };
  }

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
  const pushCr = (accountId, amount, narration) => {
    if (!accountId || amount <= 0) return;
    lines.push({
      accountId,
      debitAmount: 0,
      creditAmount: round2(amount),
      outstandingBalance: 0,
      narration,
    });
  };

  const customerDebit = resolveSaleCustomerDebit(
    netClient, amtTaxable, amtExempt, sumTax, headerDisc, roundOff, warnings,
  );

  if (customerId != null && customerHasLedger && customerLedgerId) {
    pushDr(
      customerLedgerId,
      customerDebit,
      `SVT: ${billNo}`,
      paymentMode === 'CREDIT' ? customerDebit : 0,
    );
  } else if (customerId != null) {
    warnings.push('Customer receivable ledger not found — sales voucher customer line will be skipped');
  }

  if (amtTaxable > 0) {
    pushCr(salesCrTaxableId, amtTaxable, `SVT taxable: ${billNo}`);
  }
  if (amtExempt > 0) {
    const exId = resolveSaleExemptCrLedger(salesCrTaxableId, salesCrExemptId, warnings);
    if (exId) pushCr(exId, amtExempt, `SVT exempt (0%): ${billNo}`);
  }
  if (amtTaxable === 0 && amtExempt === 0) {
    pushCr(salesCrTaxableId, round2(netClient - sumTax), `SVT: ${billNo}`);
  }

  if (headerDisc > 0 && discountLedgerId) {
    pushDr(discountLedgerId, headerDisc, `Discount SVT: ${billNo}`);
  } else if (headerDisc > 0) {
    warnings.push('Sales discount ledger not configured — discount DR line skipped');
  }

  if (roundOff > 0 && roundLedgerId) {
    pushCr(roundLedgerId, roundOff, `RoundOff SVT: ${billNo}`);
  } else if (roundOff < 0 && roundLedgerId) {
    pushDr(roundLedgerId, Math.abs(roundOff), `RoundOff SVT: ${billNo}`);
  } else if (roundOff !== 0) {
    warnings.push('Sales rounding ledger not configured — round off line skipped');
  }

  if (sumTax > 0 && outputTaxLedgerId) {
    pushCr(outputTaxLedgerId, sumTax, `Tax SVT: ${billNo}`);
  } else if (sumTax > 0) {
    warnings.push('Output tax ledger not configured — tax credited to sales ledger');
    pushCr(salesCrTaxableId, sumTax, `Tax SVT: ${billNo}`);
  }

  return {
    lines,
    warnings,
    hasSalesCr: true,
    customerDebit,
    headerDisc,
    roundOff,
    amtTaxable,
    amtExempt,
  };
}

/** @deprecated alias — use resolveSaleVoucherLinePlan */
async function buildSaleVoucherLinePlan(client, companyId, branchId, args) {
  return resolveSaleVoucherLinePlan(client, companyId, branchId, {
    billNo: args.billNo,
    customerId: args.customerId,
    customerLedgerId: args.customerLedgerId,
    customerHasLedger: args.customerHasLedger,
    paymentMode: args.paymentMode,
    normalized: args.normalized || [],
    sumTax: args.sumTax,
    headerDisc: args.headerDisc,
    roundOff: args.roundOff,
    netClient: args.netClient,
    receiptLedgerId: args.receiptLedgerId,
  });
}

function buildReceiptVoucherLinePlan({
  billNo, customerLedgerId, customerHasLedger, receiptLedgerId, paid, paymentMode,
}) {
  const warnings = [];
  if (!(paymentMode === 'CASH' || paymentMode === 'CREDITCARD')) {
    return { lines: [], warnings };
  }
  if (!receiptLedgerId) {
    warnings.push('Receipt ledger not configured for cash/card sale');
    return { lines: [], warnings };
  }
  if (!customerLedgerId || !customerHasLedger) {
    warnings.push('Customer receivable ledger required for auto receipt on cash/card sale');
    return { lines: [], warnings };
  }
  const ref = `RCV: ${billNo}`;
  return {
    lines: [
      {
        accountId: receiptLedgerId,
        debitAmount: paid,
        creditAmount: 0,
        outstandingBalance: 0,
        narration: ref,
      },
      {
        accountId: customerLedgerId,
        debitAmount: 0,
        creditAmount: paid,
        outstandingBalance: 0,
        narration: ref,
      },
    ],
    warnings,
  };
}

async function buildSaleAccountsPreview(pool, companyId, branchId, body, billNo = 'Preview') {
  const norm = await normalizeSaleBodyForAccounts(pool, companyId, branchId, body);
  const salesPlan = await resolveSaleVoucherLinePlan(pool, companyId, branchId, {
    billNo,
    customerId: norm.customerId,
    customerLedgerId: norm.customerLedgerId,
    customerHasLedger: norm.customerHasLedger,
    paymentMode: norm.paymentMode,
    normalized: norm.normalized,
    sumTax: norm.sumTax,
    headerDisc: norm.headerDisc,
    roundOff: norm.roundOff,
    netClient: norm.netClient,
    receiptLedgerId: norm.receiptLedgerId,
  });
  const receiptPlan = buildReceiptVoucherLinePlan({ billNo, ...norm });
  const salesLines = await enrichVoucherLinesWithAccountHeads(pool, companyId, salesPlan.lines);
  const receiptLines = await enrichVoucherLinesWithAccountHeads(pool, companyId, receiptPlan.lines);
  const warnings = [...salesPlan.warnings, ...receiptPlan.warnings];
  const outstandingBalance = norm.netClient;

  return {
    preview: billNo === 'Preview',
    billNo,
    invoiceAmount: norm.netClient.toFixed(2),
    outstandingBalance: round2(outstandingBalance).toFixed(2),
    paymentMode: norm.paymentMode,
    salesPosted: false,
    receiptPosted: false,
    accountsPosted: salesLines.length > 0,
    salesVoucher: salesLines.length
      ? { voucherNo: billNo === 'Preview' ? 'Preview' : billNo, postStatus: 'PREVIEW', lines: salesLines }
      : null,
    receiptVoucher: receiptLines.length
      ? { voucherNo: billNo === 'Preview' ? 'Preview (auto on post)' : billNo, postStatus: 'PREVIEW', lines: receiptLines }
      : null,
    warnings: warnings.length ? warnings : undefined,
    message: salesPlan.lines.length
      ? (billNo === 'Preview' ? 'Preview from current entry — save to persist voucher lines.' : undefined)
      : 'Configure sales ledgers in Branch Account Integration (Sales Back Office tab).',
  };
}

/** POST /api/sales/accounts/preview-draft — ledger preview from current form (no save). */
export async function previewSaleAccountsDraft(pool, authStaff, body) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseBranchId(body.branchId) || parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }
  return buildSaleAccountsPreview(pool, companyId, branchId, body, 'Preview');
}

/** GET /api/sales/:salesId/accounts */
export async function getSaleAccounts(pool, authStaff, salesIdParam, query) {
  const companyId = Number(authStaff.company_id);
  const salesId = Math.trunc(num(salesIdParam, 0));
  if (salesId < 1) {
    const err = new Error('Invalid salesId');
    err.status = 400;
    throw err;
  }
  let branchId = parseBranchId(query?.branchId) || parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const master = await saleEntryRepo.getSaleById(pool, companyId, branchId, salesId);
  if (!master) {
    const err = new Error('Sale not found');
    err.status = 404;
    throw err;
  }

  const { salesVoucher, receiptVoucher } = await findSaleVouchers(pool, companyId, branchId, salesId);
  const mappedSales = salesVoucher ? mapVoucherToApi(salesVoucher) : null;
  const mappedReceipt = receiptVoucher ? mapVoucherToApi(receiptVoucher) : null;
  const netAmount = num(master.amount, 0);
  const outstandingBalance = saleOutstandingFromVouchers(mappedSales, mappedReceipt, netAmount);

  return {
    salesId,
    branchId,
    billNo: master.bill_no != null ? String(master.bill_no) : '',
    invoiceAmount: master.amount != null ? String(master.amount) : '0',
    paymentMode: master.payment_mode ?? null,
    outstandingBalance: outstandingBalance.toFixed(2),
    receiptPosted: mappedReceipt != null && mappedReceipt.postStatus === 'POSTED',
    salesPosted: mappedSales != null && mappedSales.postStatus === 'POSTED',
    salesVoucher: mappedSales,
    receiptVoucher: mappedReceipt,
    accountsPosted: mappedSales != null,
    canUnpost: mappedSales != null
      && mappedSales.postStatus === 'POSTED'
      && !(mappedReceipt != null && mappedReceipt.postStatus === 'POSTED'),
  };
}

/** POST /api/sales/:salesId/accounts/preview — preview from saved sale + form overrides */
export async function previewSaleAccounts(pool, authStaff, salesIdParam, body, query) {
  const companyId = Number(authStaff.company_id);
  const salesId = Math.trunc(num(salesIdParam, 0));
  if (salesId < 1) {
    const err = new Error('Invalid salesId');
    err.status = 400;
    throw err;
  }
  let branchId = parseBranchId(query?.branchId) || parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const existing = await saleEntryRepo.getSaleById(pool, companyId, branchId, salesId);
  if (!existing) {
    const err = new Error('Sale not found');
    err.status = 404;
    throw err;
  }
  const saleBranchId = Number(existing.branch_id);
  const { salesVoucher } = await findSaleVouchers(pool, companyId, saleBranchId, salesId);
  if (salesVoucher?.master?.post_status === 'POSTED') {
    return getSaleAccounts(pool, authStaff, salesId, query);
  }
  const billNo = existing.bill_no != null ? String(existing.bill_no) : String(salesId);
  return buildSaleAccountsPreview(pool, companyId, saleBranchId, body, billNo);
}

/** POST /api/sales/:salesId/post — post sales voucher; cash/card receipt posts here (like purchase Pay now). */
export async function postSale(pool, authStaff, salesIdParam, body, query) {
  const companyId = Number(authStaff.company_id);
  const salesId = Math.trunc(num(salesIdParam, 0));
  if (salesId < 1) {
    const err = new Error('Invalid salesId');
    err.status = 400;
    throw err;
  }

  let branchId = parseBranchId(query?.branchId) || parseBranchId(body?.branchId) || parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const master = await saleEntryRepo.getSaleById(pool, companyId, branchId, salesId);
  if (!master) {
    const err = new Error('Sale not found');
    err.status = 404;
    throw err;
  }

  const { salesVoucher, receiptVoucher } = await findSaleVouchers(pool, companyId, branchId, salesId);
  if (!salesVoucher?.master?.voucher_master_id) {
    const err = new Error(
      'No sales voucher found — save the sale after configuring Account Integration (Sales Back Office tab)',
    );
    err.status = 400;
    throw err;
  }

  const voucherMasterId = Number(salesVoucher.master.voucher_master_id);
  const alreadyPosted = salesVoucher.master.post_status === 'POSTED';
  const receiptPosted = receiptVoucher?.master?.post_status === 'POSTED';

  if (alreadyPosted && receiptPosted) {
    const mappedSales = mapVoucherToApi(salesVoucher);
    const mappedReceipt = mapVoucherToApi(receiptVoucher);
    return {
      salesId,
      branchId,
      billNo: String(master.bill_no || ''),
      salesPosted: true,
      receiptPosted: true,
      outstandingBalance: '0.00',
      voucherMasterId,
      message: 'Sale already posted with receipt',
      salesVoucher: mappedSales,
      receiptVoucher: mappedReceipt,
    };
  }

  return withTransaction(async (client) => {
    if (!alreadyPosted) {
      await voucherRepo.updateVoucherPostStatus(client, companyId, branchId, voucherMasterId, 'POSTED');
    }
    await saleEntryRepo.updateSalesPostStatus(client, companyId, salesId, branchId, 'POSTED');

    const paymentMode = String(master.payment_mode || '').toUpperCase();
    const isCashCard = paymentMode === 'CASH' || paymentMode === 'CREDITCARD';
    if (
      isCashCard
      && receiptVoucher?.master?.voucher_master_id
      && receiptVoucher.master.post_status !== 'POSTED'
    ) {
      await voucherRepo.updateVoucherPostStatus(
        client,
        companyId,
        branchId,
        Number(receiptVoucher.master.voucher_master_id),
        'POSTED',
      );
    }

    const refreshed = await findSaleVouchers(client, companyId, branchId, salesId);
    const mappedSales = mapVoucherToApi(refreshed.salesVoucher);
    const mappedReceipt = mapVoucherToApi(refreshed.receiptVoucher);
    const netAmount = num(master.amount, 0);
    const outstandingBalance = saleOutstandingFromVouchers(mappedSales, mappedReceipt, netAmount);

    return {
      salesId,
      branchId,
      billNo: String(master.bill_no || ''),
      salesPosted: true,
      receiptPosted: mappedReceipt?.postStatus === 'POSTED',
      outstandingBalance: outstandingBalance.toFixed(2),
      voucherMasterId,
      receiptVoucherMasterId: mappedReceipt?.voucherMasterId ?? null,
      message: mappedReceipt?.postStatus === 'POSTED'
        ? 'Sale posted — receipt voucher completed (cash/card).'
        : outstandingBalance > 0
          ? 'Sale posted — customer outstanding remains until receipt voucher.'
          : 'Sale posted to accounts.',
    };
  });
}

/** POST /api/sales/:salesId/unpost — reverse sale post when customer receipt is not posted. */
export async function unpostSale(pool, authStaff, salesIdParam, query) {
  const companyId = Number(authStaff.company_id);
  const salesId = Math.trunc(num(salesIdParam, 0));
  if (salesId < 1) {
    const err = new Error('Invalid salesId');
    err.status = 400;
    throw err;
  }

  let branchId = parseBranchId(query?.branchId) || parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const master = await saleEntryRepo.getSaleById(pool, companyId, branchId, salesId);
  if (!master) {
    const err = new Error('Sale not found');
    err.status = 404;
    throw err;
  }

  const { salesVoucher, receiptVoucher } = await findSaleVouchers(pool, companyId, branchId, salesId);
  const salesPosted = salesVoucher?.master?.post_status === 'POSTED';
  if (!salesPosted) {
    const err = new Error('Sale is not posted');
    err.status = 409;
    throw err;
  }

  if (receiptVoucher?.master?.post_status === 'POSTED') {
    const err = new Error('Receipt already done.');
    err.status = 409;
    throw err;
  }

  const voucherMasterId = Number(salesVoucher.master.voucher_master_id);
  const billNo = master.bill_no != null ? String(master.bill_no) : String(salesId);
  const netAmount = num(master.amount, 0);

  return withTransaction(async (client) => {
    await voucherRepo.updateVoucherPostStatus(client, companyId, branchId, voucherMasterId, 'PENDING');
    await saleEntryRepo.updateSalesPostStatus(client, companyId, salesId, branchId, 'DRAFT');

    const refreshed = await findSaleVouchers(client, companyId, branchId, salesId);
    const mappedSales = mapVoucherToApi(refreshed.salesVoucher);
    const mappedReceipt = mapVoucherToApi(refreshed.receiptVoucher);
    const outstandingBalance = saleOutstandingFromVouchers(mappedSales, mappedReceipt, netAmount);

    return {
      salesId,
      branchId,
      billNo,
      salesPosted: false,
      receiptPosted: false,
      outstandingBalance: outstandingBalance.toFixed(2),
      voucherMasterId,
      unposted: true,
    };
  });
}
