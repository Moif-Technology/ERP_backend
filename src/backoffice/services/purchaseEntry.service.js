import { withTransaction } from '../../config/db.js';
import * as accountHeadRepo from '../../accounts/repositories/accountHead.repository.js';
import * as accountsParameterRepo from '../../accounts/repositories/accountsParameter.repository.js';
import {
  resolvePurchaseDrLedger,
  resolveInputTaxLedger,
  resolveDiscountLedger,
  resolveRoundingLedger,
  splitTaxableSubtotals,
} from '../../accounts/lib/integrationPosting.js';
import * as voucherRepo from '../../accounts/repositories/voucher.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as stockRepo from '../../shared/repositories/stock.repository.js';
import * as lpoRepo from '../repositories/lpo.repository.js';
import * as grnRepo from '../repositories/grn.repository.js';
import * as supplierRepo from '../repositories/supplier.repository.js';
import * as purchaseEntryRepo from '../repositories/purchaseEntry.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';
import * as partyLedgerService from './partyLedger.service.js';
import { computePurchaseAmounts, resolveHeaderDiscountFromBody } from '../lib/purchaseAmounts.js';
import { auditStaffId } from '../../pos/restaurant-pos/lib/staffAudit.js';
import { auditUserName } from '../../shared/lib/auditUser.js';
import { parsePaymentMode, canPaySupplierNow } from '../../shared/lib/paymentMode.js';

function staffIdForStockLog(authStaff) {
  const n = Number(authStaff?.staff_id ?? authStaff?.id);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

// Seeded chart-of-accounts fallbacks (accountsSeed.repository.js)
const ACCOUNTS_PAYABLE_ID = 2001;
const PURCHASES_EXPENSE_ID = 5001;
const CASH_IN_HAND_ID = 1001;
const BANK_ACCOUNT_ID = 1002;

function num(v, d = 0) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n) {
  return Math.round(n * 100) / 100;
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

async function resolvePaymentLedger(client, companyId, branchId, paymentMode, explicitAccountId) {
  const explicit = nullableLong(explicitAccountId);
  if (explicit) {
    const head = await accountHeadRepo.findAccountHead(client, companyId, explicit);
    if (head && (Number(head.posting_allowed) === 1 || head.posting_allowed === true)) {
      return explicit;
    }
  }
  const mode = parsePaymentMode(paymentMode);
  const isCardOrTransfer = mode === 'CARD' || mode === 'TRANSFER';
  const primary = isCardOrTransfer ? 'DEFAULT_CARD_LEDGER' : 'DEFAULT_CASH_LEDGER';
  const fallback = isCardOrTransfer ? 'CODRCreditCardReceiptLedger' : 'CODRCashReceiptLedger';
  let accountId = await accountsParameterRepo.getParameterAccountId(client, companyId, branchId, primary);
  if (accountId == null) {
    accountId = await accountsParameterRepo.getParameterAccountId(client, companyId, branchId, fallback);
  }
  if (accountId == null) {
    const fallbackId = isCardOrTransfer ? BANK_ACCOUNT_ID : CASH_IN_HAND_ID;
    const head = await accountHeadRepo.findAccountHead(client, companyId, fallbackId);
    if (head) accountId = fallbackId;
  }
  return accountId;
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

async function reducePurchaseSupplierOutstanding(client, companyId, purchaseId, supplierLedgerId, reduceBy, purchaseVoucherTypeId) {
  await client.query(
    `UPDATE accounts.voucher_detail vd
     SET outstanding_balance = GREATEST(COALESCE(vd.outstanding_balance, 0) - $4, 0),
         modified_at = NOW()
     FROM accounts.voucher_master vm
     WHERE vd.company_id = $1
       AND vd.voucher_master_id = vm.voucher_master_id
       AND vm.company_id = $1
       AND vm.voucher_posted_id = $2
       AND vm.voucher_type_id = $5
       AND vm.creation_mode = 'INVENTORYACCOUNTS'
       AND vd.account_id = $3
       AND vd.credit_amount > 0`,
    [companyId, purchaseId, supplierLedgerId, reduceBy, purchaseVoucherTypeId],
  );
}

async function postSupplierPaymentVoucher(client, args) {
  const {
    companyId, branchId, purchaseId, purchaseNo, supplierLedgerId, paymentLedgerId,
    amount, purchaseDate, auditBy, paymentVoucherTypeId,
  } = args;

  const voucherPrefix = await voucherRepo.getVoucherPrefix(client, companyId, paymentVoucherTypeId) || 'PAY-';
  const payMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
  const payAutoNo = await voucherRepo.nextAutoVoucherNo(client, companyId, branchId, paymentVoucherTypeId);
  const ref = `PAY-${purchaseNo}`;

  await voucherRepo.insertVoucherMaster(client, {
    companyId, branchId,
    voucherMasterId: payMasterId,
    voucherTypeId: paymentVoucherTypeId,
    autoVoucherNo: payAutoNo,
    voucherPrefix,
    voucherDate: purchaseDate,
    referenceNo: ref,
    voucherAmount: amount,
    remarks: `PAY: ${purchaseNo}`,
    postStatus: 'POSTED',
    creationMode: 'INVENTORYACCOUNTS',
    voucherPostedId: purchaseId,
    counterCloseNo: 'PENDING',
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  let detailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);
  await voucherRepo.insertVoucherDetail(client, {
    companyId, branchId,
    voucherDetailId: detailSeq++,
    voucherMasterId: payMasterId,
    accountId: supplierLedgerId,
    creditAmount: 0,
    debitAmount: amount,
    outstandingBalance: 0,
    narration: ref,
    postStatus: 'POSTED',
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });
  await voucherRepo.insertVoucherDetail(client, {
    companyId, branchId,
    voucherDetailId: detailSeq++,
    voucherMasterId: payMasterId,
    accountId: paymentLedgerId,
    creditAmount: amount,
    debitAmount: 0,
    outstandingBalance: 0,
    narration: ref,
    postStatus: 'POSTED',
    recordStatus: 'ACTIVE',
    createdBy: auditBy,
  });

  return payMasterId;
}

function mapPurchaseLineToApi(row) {
  if (!row) return null;
  const unitCost = row.unit_cost != null ? Number(row.unit_cost) : 0;
  const lineAmount = row.line_amount != null ? Number(row.line_amount) : 0;
  return {
    purchaseChildId: Number(row.purchase_child_id),
    productId: row.product_id != null ? Number(row.product_id) : null,
    ownRefNo: row.own_ref_no ?? null,
    supplierRefNo: row.supplier_ref_no ?? null,
    productCode: row.product_code ?? null,
    shortDescription: row.short_name ?? row.product_name ?? null,
    qty: row.qty != null ? String(row.qty) : '0',
    focQty: row.foc_qty != null ? String(row.foc_qty) : '0',
    unitCost: unitCost > 0 ? String(unitCost) : '0',
    unitName: row.unit_name ?? 'Pcs',
    discountPercentage: row.discount_percentage != null ? String(row.discount_percentage) : '0',
    discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
    subtotalAmount: row.subtotal_amount != null ? String(row.subtotal_amount) : '0',
    inputTax1Amount: row.input_tax_1_amount != null ? String(row.input_tax_1_amount) : '0',
    inputTax1Rate: row.input_tax_1_rate != null ? String(row.input_tax_1_rate) : '0',
    lineAmount: lineAmount > 0 ? String(lineAmount) : '0',
    total: lineAmount > 0 ? String(lineAmount) : '0',
  };
}

function parseOptionalISODate(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function mapPurchaseMasterToApi(row) {
  if (!row) return null;
  return {
    purchaseId: Number(row.purchase_id),
    branchId: Number(row.branch_id),
    supplierId: row.supplier_id != null ? Number(row.supplier_id) : null,
    supplierName: row.supplier_name ?? null,
    grnId: row.grn_id != null ? Number(row.grn_id) : null,
    lpoMasterId: row.lpo_master_id != null ? Number(row.lpo_master_id) : null,
    purchaseDate: row.purchase_date,
    purchaseNo: row.purchase_no != null ? String(row.purchase_no) : '',
    supplierInvoiceNo: row.supplier_invoice_no ?? null,
    invoiceAmount: row.invoice_amount != null ? String(row.invoice_amount) : '0',
    outstandingBalance: row.outstanding_balance != null ? String(row.outstanding_balance) : '0',
    paymentMode: row.payment_mode ?? null,
    postStatus: row.post_status ?? null,
    remarks: row.remarks ?? null,
    subtotalAmount: row.subtotal_amount != null ? String(row.subtotal_amount) : '0',
    inputTax1Amount: row.input_tax_1_amount != null ? String(row.input_tax_1_amount) : '0',
    netVat: row.net_vat != null ? String(row.net_vat) : '0',
    itemsTotalBc: row.items_total_bc != null ? String(row.items_total_bc) : '0',
    discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
    roundOffAdjustment: row.round_off_adjustment != null ? String(row.round_off_adjustment) : '0',
    recordStatus: row.record_status ?? null,
  };
}

function parseLimitOffset(query) {
  const lim = Math.min(Math.max(Number(query?.limit) || 50, 1), 200);
  const off = Math.max(Number(query?.offset) || 0, 0);
  return { lim, off };
}

async function productExistsInCompany(client, companyId, productId) {
  const { rows } = await client.query(
    `SELECT 1 FROM core.product_master
     WHERE company_id = $1 AND product_id = $2
       AND (record_status IS NULL OR record_status = 'ACTIVE')
     LIMIT 1`,
    [companyId, productId],
  );
  return rows.length > 0;
}

/**
 * POST /api/purchases — ops.purchase_master + ops.purchase_child.
 * Body: branchId, supplierId, grnId?, lpoMasterId?, supplierInvoiceNo?, purchaseDate?,
 * invoiceAmount?, netAmount (sum check), paymentMode?, paymentNow?, remark?,
 * lines[{ productId, ownRef?, supRef?, qty, focQty?, unitCost?, sellingPrice?, discPct?, discAmt?, subTotal, vatPct?, vatAmt?, total, unitName? }].
 */
export async function createPurchase(pool, body, authStaff) {
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

  const supplierId = Math.trunc(num(body.supplierId, 0));
  if (supplierId < 1) {
    const err = new Error('supplierId is required');
    err.status = 400;
    throw err;
  }
  const okSup = await supplierRepo.supplierExists(pool, companyId, supplierId);
  if (!okSup) {
    const err = new Error('Supplier not found for this company');
    err.status = 400;
    throw err;
  }

  const grnIdOpt = nullableLong(body.grnId);
  if (grnIdOpt != null) {
    const grnFull = await grnRepo.getGrnWithLines(pool, companyId, grnIdOpt);
    if (!grnFull) {
      const err = new Error('GRN not found');
      err.status = 404;
      throw err;
    }
    if (Number(grnFull.master.branch_id) !== branchId) {
      const err = new Error('GRN belongs to a different branch');
      err.status = 400;
      throw err;
    }
  }

  const lpoMasterIdOpt = nullableLong(body.lpoMasterId);
  if (lpoMasterIdOpt != null) {
    const lpoFull = await lpoRepo.getLpoWithLines(pool, companyId, lpoMasterIdOpt);
    if (!lpoFull) {
      const err = new Error('LPO not found');
      err.status = 404;
      throw err;
    }
    if (Number(lpoFull.master.branch_id) !== branchId) {
      const err = new Error('LPO belongs to a different branch');
      err.status = 400;
      throw err;
    }
  }

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) {
    const err = new Error('At least one line is required');
    err.status = 400;
    throw err;
  }

  const {
    normalized, sumLineTotal, sumSub, sumTax, netClient, invoiceAmount, headerDisc, roundOff,
  } = normalizePurchaseInput(body);

  const paymentModeLabel = str(body.paymentMode, 50) || 'CASH';
  const paymentNow = Boolean(body.paymentNow);
  const paySupplierNow = canPaySupplierNow(body.paymentMode, paymentNow);
  const paymentLedgerAccountId = nullableLong(body.paymentLedgerAccountId);
  const supplierInvoiceNo = str(body.supplierInvoiceNo ?? body.supplierInvNo, 50);
  if (!supplierInvoiceNo) {
    const err = new Error('Supplier invoice number is required');
    err.status = 400;
    throw err;
  }

  const purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : new Date();
  if (Number.isNaN(purchaseDate.getTime())) {
    const err = new Error('Invalid purchaseDate');
    err.status = 400;
    throw err;
  }

  const auditBy = auditStaffId(authStaff);
  const userLabel = auditUserName(authStaff);
  const remarks = str(body.remark ?? body.remarks, 200);

  return withTransaction(async (client) => {
    for (let i = 0; i < normalized.length; i += 1) {
      const okP = await productExistsInCompany(client, companyId, normalized[i].productId);
      if (!okP) {
        const err = new Error(`Line ${i + 1}: product not found for this company`);
        err.status = 400;
        throw err;
      }
    }

    const purchaseId = await purchaseEntryRepo.nextPurchaseId(client, companyId);
    const purchaseNo = await nextDocNo(client, {
      companyId,
      branchId,
      sequenceCode: 'PURCHASE',
      fiscalYear: new Date().getFullYear(),
    });

    await purchaseEntryRepo.insertPurchaseMaster(client, {
      companyId,
      purchaseId,
      branchId,
      supplierId,
      grnId: grnIdOpt,
      lpoMasterId: lpoMasterIdOpt,
      purchaseDate,
      purchaseNo,
      supplierInvoiceNo,
      invoiceAmount,
      outstandingBalance: netClient,
      paymentMode: paymentModeLabel,
      postStatus: 'DRAFT',
      discountAmount: headerDisc,
      roundOffAdjustment: roundOff,
      remarks,
      subtotalAmount: sumSub,
      inputTax1Amount: sumTax,
      inputTax2Amount: 0,
      inputTax3Amount: 0,
      inputTax1Rate: sumSub > 0 ? round2((sumTax / sumSub) * 100) : 0,
      inputTax2Rate: 0,
      inputTax3Rate: 0,
      netVat: sumTax,
      itemsTotalBc: sumLineTotal,
      currencyRate: 1,
      recordStatus: 'ACTIVE',
      createdBy: userLabel,
      modifiedBy: userLabel,
    });

    for (let i = 0; i < normalized.length; i += 1) {
      const L = normalized[i];
      const purchaseChildId = await purchaseEntryRepo.nextPurchaseChildId(client, companyId);
      const lineAmount = L.lineTotal;
      const ucBc = L.unitCost;
      await purchaseEntryRepo.insertPurchaseChild(client, {
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
        lineAmount,
        subtotalAmount: L.subtotalAmount,
        inputTax1Amount: L.inputTax1Amount,
        inputTax1Rate: L.inputTax1Rate,
        inputTax2Amount: 0,
        inputTax3Amount: 0,
        inputTax2Rate: 0,
        inputTax3Rate: 0,
        currencyRate: 1,
        unitCostBc: ucBc,
        recordStatus: 'ACTIVE',
        createdBy: userLabel,
        modifiedBy: userLabel,
      });
    }

    const warnings = [];

    // ───── Stock-in: cost roll-up + product_log_entry + qty_on_hand ─────
    try {
      await client.query('SAVEPOINT stock_update');
      for (const L of normalized) {
        const inQty = L.qty + L.focQty;
        // Costs first — weighted average uses the pre-purchase on-hand qty.
        await stockRepo.updateCostsOnPurchase(client, companyId, branchId, L.productId, inQty, L.unitCost);
        await stockRepo.applyStockMovement(client, {
          companyId, branchId,
          productId: L.productId,
          transactionType: 'PURCHASE',
          transactionId: purchaseId,
          qty: inQty,
          unitCost: L.unitCost,
          unitPrice: 0,
          // product_log_entry.created_by is bigint (staff id), not a name
          createdBy: staffIdForStockLog(authStaff),
        });
      }
      await client.query('RELEASE SAVEPOINT stock_update');
    } catch (stockErr) {
      await client.query('ROLLBACK TO SAVEPOINT stock_update');
      if (stockErr.code === '42P01' || stockErr.code === '42703') {
        console.warn('product_log_entry/product_inventory schema mismatch — purchase stock-in skipped');
        warnings.push('Stock update skipped (schema mismatch)');
      } else {
        throw stockErr;
      }
    }

    let purchaseVoucherMasterId = null;

    const acct = await writePurchaseAccounting(client, {
      companyId, branchId, purchaseId, purchaseNo, purchaseDate,
      supplierId, normalized, body: {
        ...body,
        paymentMode: paymentModeLabel,
        discountAmount: headerDisc,
        roundOffAdjustment: roundOff,
      },
      invoiceAmount, sumTax, auditBy,
    });
    purchaseVoucherMasterId = acct.purchaseVoucherMasterId;
    if (acct.warnings?.length) warnings.push(...acct.warnings);

    const supplierOs = round2(num(acct.outstandingBalance, netClient));
    await patchPurchaseOutstandingBalance(client, companyId, purchaseId, branchId, supplierOs);

    return {
      purchaseId,
      branchId,
      purchaseNo: String(purchaseNo),
      invoiceAmount: invoiceAmount.toFixed(2),
      netAmount: netClient.toFixed(2),
      lineCount: normalized.length,
      supplierInvoiceNo,
      paymentMode: paymentModeLabel,
      paymentNow: paySupplierNow,
      outstandingBalance: supplierOs.toFixed(2),
      purchaseVoucherMasterId,
      paymentVoucherMasterId: null,
      accountsPosted: purchaseVoucherMasterId != null,
      paymentPosted: false,
      purchasePosted: false,
      warnings: warnings.length ? warnings : undefined,
    };
  });
}

function normalizePurchaseInput(body) {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) {
    const err = new Error('At least one line is required');
    err.status = 400;
    throw err;
  }

  const normalized = [];
  let sumLineTotal = 0;
  let sumSub = 0;
  let sumTax = 0;

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

    const focQty = Math.max(0, num(L.focQty, 0));
    const unitCostRaw = num(L.unitCost ?? L.actualCost, 0);
    const sell = num(L.sellingPrice ?? L.unitPrice, 0);
    const unitCost = round2(unitCostRaw > 0 ? unitCostRaw : sell);

    const discPct = round2(num(L.discPct ?? L.discountPercentage, 0));
    const disc = round2(num(L.discAmt ?? L.discountAmount ?? L.itemDiscount, 0));
    const subL = round2(num(L.subTotal ?? L.subtotalAmount, 0));
    const tax1 = round2(num(L.vatAmt ?? L.taxAmt ?? L.inputTax1Amount, 0));
    const r1 = round2(num(L.vatPct ?? L.taxPercent ?? L.inputTax1Rate, 0));
    const lt = round2(num(L.total ?? L.lineTotal, subL + tax1));

    sumLineTotal += lt;
    sumSub += subL;
    sumTax += tax1;

    normalized.push({
      productId,
      ownRefNo: str(L.ownRef ?? L.ownRefNo ?? L.own_ref_no, 120),
      supplierRefNo: str(L.supRef ?? L.supplierRefNo ?? L.supplier_ref_no, 120),
      qty,
      focQty,
      unitCost,
      unitName: str(L.unitName ?? L.packetDetails, 50),
      discountPercentage: discPct,
      discountAmount: disc,
      subtotalAmount: subL,
      inputTax1Amount: tax1,
      inputTax1Rate: r1,
      lineTotal: lt,
    });
  }

  sumLineTotal = round2(sumLineTotal);
  sumSub = round2(sumSub);
  sumTax = round2(sumTax);

  const roundOff = round2(num(body.roundOffAdjustment ?? body.roundOff, 0));
  const { headerDiscAmt, headerDiscPct, headerDisc } = resolveHeaderDiscountFromBody(body, sumSub);
  const amounts = computePurchaseAmounts(normalized, { headerDiscAmt, headerDiscPct, roundOff });

  const netExpected = amounts.net;
  const netClient = round2(num(body.netAmount, netExpected));
  if (Math.abs(netClient - netExpected) > 0.05) {
    const err = new Error(
      `Net amount does not match line totals (expected ${netExpected.toFixed(2)}, got ${netClient.toFixed(2)})`,
    );
    err.status = 400;
    throw err;
  }
  if (netClient <= 0) {
    const err = new Error('netAmount must be > 0');
    err.status = 400;
    throw err;
  }

  const invoiceAmount = round2(num(body.invoiceAmount, netClient));
  if (invoiceAmount <= 0) {
    const err = new Error('invoiceAmount must be > 0');
    err.status = 400;
    throw err;
  }

  return {
    normalized,
    sumLineTotal,
    sumSub,
    sumTax: amounts.sumTax,
    netClient,
    invoiceAmount,
    headerDisc: amounts.headerDisc,
    subAfterDisc: amounts.subAfterDisc,
    roundOff,
  };
}

async function insertPurchaseLines(client, {
  companyId, branchId, purchaseId, normalized, userLabel,
}) {
  for (let i = 0; i < normalized.length; i += 1) {
    const L = normalized[i];
    const purchaseChildId = await purchaseEntryRepo.nextPurchaseChildId(client, companyId);
    await purchaseEntryRepo.insertPurchaseChild(client, {
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

async function applyPurchaseStockIn(client, authStaff, companyId, branchId, purchaseId, normalized) {
  const warnings = [];
  try {
    await client.query('SAVEPOINT stock_update');
    for (const L of normalized) {
      const inQty = L.qty + L.focQty;
      await stockRepo.updateCostsOnPurchase(client, companyId, branchId, L.productId, inQty, L.unitCost);
      await stockRepo.applyStockMovement(client, {
        companyId, branchId,
        productId: L.productId,
        transactionType: 'PURCHASE',
        transactionId: purchaseId,
        qty: inQty,
        unitCost: L.unitCost,
        unitPrice: 0,
        createdBy: Number(authStaff.staff_id) || null,
      });
    }
    await client.query('RELEASE SAVEPOINT stock_update');
  } catch (stockErr) {
    await client.query('ROLLBACK TO SAVEPOINT stock_update');
    if (stockErr.code === '42P01' || stockErr.code === '42703') {
      warnings.push('Stock update skipped (schema mismatch)');
    } else {
      throw stockErr;
    }
  }
  return warnings;
}

async function reversePurchaseStockIn(client, authStaff, companyId, branchId, purchaseId, oldChildren) {
  const warnings = [];
  if (!oldChildren?.length) return warnings;
  try {
    await client.query('SAVEPOINT stock_reverse');
    for (const row of oldChildren) {
      const inQty = num(row.qty, 0) + num(row.foc_qty, 0);
      if (inQty <= 0) continue;
      await stockRepo.applyStockMovement(client, {
        companyId, branchId,
        productId: Number(row.product_id),
        transactionType: 'PURCHASE',
        transactionId: purchaseId,
        qty: -inQty,
        unitCost: num(row.unit_cost, 0),
        unitPrice: 0,
        createdBy: Number(authStaff.staff_id) || null,
      });
    }
    await client.query('RELEASE SAVEPOINT stock_reverse');
  } catch (stockErr) {
    await client.query('ROLLBACK TO SAVEPOINT stock_reverse');
    if (stockErr.code === '42P01' || stockErr.code === '42703') {
      warnings.push('Stock reversal skipped (schema mismatch)');
    } else {
      throw stockErr;
    }
  }
  return warnings;
}

function resolvePurchaseExemptDrLedger(purchaseDrTaxableId, purchaseDrExemptId, warnings) {
  if (purchaseDrExemptId && purchaseDrExemptId !== purchaseDrTaxableId) {
    return purchaseDrExemptId;
  }
  if (purchaseDrExemptId === purchaseDrTaxableId) {
    warnings.push(
      'Purchase DR — Exempted uses the same ledger as taxable purchases. Assign a separate zero-rated ledger in Branch Account Integration.',
    );
  } else {
    warnings.push(
      'Purchase DR — Exempted is not configured. Zero-rated line amounts are posted to the taxable purchase ledger.',
    );
  }
  return purchaseDrTaxableId;
}

function resolvePurchaseSupplierCredit(invoiceAmount, amtTaxable, amtExempt, sumTax, headerDisc, roundOff, warnings) {
  const computed = round2(amtTaxable + amtExempt + sumTax - headerDisc + roundOff);
  if (Math.abs(invoiceAmount - computed) > 0.05) {
    warnings.push(
      `Invoice amount ${invoiceAmount.toFixed(2)} differs from line totals ${computed.toFixed(2)} — supplier credit uses ${computed.toFixed(2)}.`,
    );
    return computed;
  }
  return invoiceAmount;
}

async function patchPurchaseOutstandingBalance(client, companyId, purchaseId, branchId, outstandingBalance) {
  await client.query(
    `UPDATE ops.purchase_master
     SET outstanding_balance = $4, modified_at = NOW()
     WHERE company_id = $1 AND purchase_id = $2 AND branch_id = $3`,
    [companyId, purchaseId, branchId, round2(outstandingBalance)],
  );
}

function supplierOutstandingFromVoucher(mappedPurchase, fallback = null) {
  if (!mappedPurchase?.lines?.length) {
    return fallback != null ? round2(fallback) : null;
  }
  const withOs = mappedPurchase.lines.filter(
    (l) => num(l.creditAmount, 0) > 0 && num(l.outstandingBalance, 0) > 0,
  );
  if (withOs.length > 0) {
    return round2(withOs.reduce((s, l) => s + num(l.outstandingBalance, 0), 0));
  }
  return fallback != null ? round2(fallback) : 0;
}

async function enrichVoucherLinesWithAccountHeads(db, companyId, lines) {
  const out = [];
  for (const line of lines) {
    const head = line.accountId ? await accountHeadRepo.findAccountHead(db, companyId, line.accountId) : null;
    const accountNo = head?.account_no ?? head?.accountNo ?? line.accountNo ?? '';
    const accountHead = head?.account_head ?? head?.accountHead ?? line.accountHead ?? '';
    out.push({
      accountId: line.accountId,
      accountNo,
      accountHead,
      debitAmount: num(line.debitAmount, 0),
      creditAmount: num(line.creditAmount, 0),
      outstandingBalance: num(line.outstandingBalance, 0),
      narration: line.narration || '',
    });
  }
  return out;
}

async function resolvePurchaseVoucherLinePlan(client, companyId, branchId, {
  purchaseNo, supplierId, normalized, body, invoiceAmount, sumTax, paymentModeLabel,
}) {
  const warnings = [];
  await accountsParameterRepo.ensureBranchIntegrationDefaults(client, companyId, branchId);

  const supplierLedgerId = await partyLedgerService.ensureSupplierLedgerForId(
    client, companyId, branchId, supplierId,
  );
  const { taxable: amtTaxable, exempt: amtExempt } = splitTaxableSubtotals(normalized);
  const baseSub = round2(normalized.reduce((s, L) => s + round2(L.subtotalAmount || 0), 0));
  const { headerDiscAmt, headerDiscPct } = resolveHeaderDiscountFromBody(body, baseSub);
  const roundOff = round2(num(body.roundOffAdjustment, 0));
  const amounts = computePurchaseAmounts(normalized, { headerDiscAmt, headerDiscPct, roundOff });
  const adjSumTax = amounts.sumTax;
  const headerDisc = amounts.headerDisc;
  const purchaseDrTaxableId = await resolvePurchaseDrLedger(client, companyId, branchId, paymentModeLabel, { taxable: true });
  const purchaseDrExemptId = amtExempt > 0
    ? await resolvePurchaseDrLedger(client, companyId, branchId, paymentModeLabel, { taxable: false })
    : null;
  const inputTaxLedgerId = adjSumTax > 0 ? await resolveInputTaxLedger(client, companyId, branchId) : null;
  const discountLedgerId = headerDisc > 0
    ? await resolveDiscountLedger(client, companyId, branchId, 'purchase')
    : null;
  const roundLedgerId = roundOff !== 0
    ? await resolveRoundingLedger(client, companyId, branchId, 'purchase')
    : null;

  const hasPurchaseDr = purchaseDrTaxableId != null || (amtExempt > 0 && purchaseDrExemptId != null);
  const lines = [];

  if (!supplierLedgerId || !hasPurchaseDr) {
    warnings.push('Purchase not posted to accounts — configure supplier parent ledger and purchase DR ledger in Account Integration');
    return {
      lines,
      warnings,
      supplierLedgerId,
      hasPurchaseDr: false,
      supplierCredit: invoiceAmount,
      headerDisc,
      roundOff,
    };
  }

  const pushDr = (accountId, amount, narration) => {
    if (!accountId || amount <= 0) return;
    lines.push({
      accountId,
      debitAmount: round2(amount),
      creditAmount: 0,
      outstandingBalance: 0,
      narration,
    });
  };
  const pushCr = (accountId, amount, narration, outstanding = 0) => {
    if (!accountId || amount <= 0) return;
    lines.push({
      accountId,
      debitAmount: 0,
      creditAmount: round2(amount),
      outstandingBalance: round2(outstanding),
      narration,
    });
  };

  if (amtTaxable > 0) {
    pushDr(purchaseDrTaxableId, amtTaxable, `PUR taxable: ${purchaseNo}`);
  }
  if (amtExempt > 0) {
    const exId = resolvePurchaseExemptDrLedger(purchaseDrTaxableId, purchaseDrExemptId, warnings);
    if (exId) pushDr(exId, amtExempt, `PUR exempt (0%): ${purchaseNo}`);
  }
  if (amtTaxable === 0 && amtExempt === 0) {
    pushDr(purchaseDrTaxableId, invoiceAmount - adjSumTax, `PUR: ${purchaseNo}`);
  }

  if (headerDisc > 0 && discountLedgerId) {
    pushCr(discountLedgerId, headerDisc, `PUR discount: ${purchaseNo}`);
  }
  if (roundOff > 0 && roundLedgerId) {
    pushDr(roundLedgerId, roundOff, `PUR round: ${purchaseNo}`);
  } else if (roundOff < 0 && roundLedgerId) {
    pushCr(roundLedgerId, Math.abs(roundOff), `PUR round: ${purchaseNo}`);
  }
  if (adjSumTax > 0 && inputTaxLedgerId) {
    pushDr(inputTaxLedgerId, adjSumTax, `PUR input tax: ${purchaseNo}`);
  } else if (adjSumTax > 0) {
    warnings.push('Input tax ledger not configured — tax added to purchase DR');
    pushDr(purchaseDrTaxableId || purchaseDrExemptId, adjSumTax, `PUR tax: ${purchaseNo}`);
  }

  const supplierCredit = resolvePurchaseSupplierCredit(
    invoiceAmount, amtTaxable, amtExempt, adjSumTax, headerDisc, roundOff, warnings,
  );
  pushCr(supplierLedgerId, supplierCredit, `PUR: ${purchaseNo}`, supplierCredit);

  return {
    lines,
    warnings,
    supplierLedgerId,
    hasPurchaseDr: true,
    supplierCredit,
    headerDisc,
    roundOff,
  };
}

async function persistPurchaseVoucherFromPlan(client, {
  companyId, branchId, purchaseId, purchaseNo, purchaseDate, invoiceAmount, auditBy, linePlan,
  existingVoucherMasterId = null,
  existingVoucherPostStatus = null,
}) {
  if (!linePlan.hasPurchaseDr || !linePlan.lines.length) {
    return { purchaseVoucherMasterId: null, outstandingBalance: invoiceAmount, warnings: linePlan.warnings || [] };
  }

  const purchaseVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(client, companyId, 'PurchaseEntryVoucherName', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(client, companyId, 'PUR'))
    || 6;
  const voucherPrefix = await voucherRepo.getVoucherPrefix(client, companyId, purchaseVoucherTypeId) || 'PUR-';

  let purchaseVoucherMasterId = existingVoucherMasterId;
  const canReplace = purchaseVoucherMasterId != null
    && String(existingVoucherPostStatus || '').toUpperCase() !== 'POSTED';

  if (canReplace) {
    await voucherRepo.updateVoucherMaster(client, companyId, branchId, purchaseVoucherMasterId, {
      voucherDate: purchaseDate,
      referenceNo: String(purchaseNo),
      voucherAmount: invoiceAmount,
      remarks: `PUR: ${purchaseNo}`,
    });
    await voucherRepo.deleteVoucherDetails(client, companyId, branchId, purchaseVoucherMasterId);
  } else {
    purchaseVoucherMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
    const autoNo = await voucherRepo.nextAutoVoucherNo(client, companyId, branchId, purchaseVoucherTypeId);
    await voucherRepo.insertVoucherMaster(client, {
      companyId, branchId,
      voucherMasterId: purchaseVoucherMasterId,
      voucherTypeId: purchaseVoucherTypeId,
      autoVoucherNo: autoNo,
      voucherPrefix,
      voucherDate: purchaseDate,
      referenceNo: String(purchaseNo),
      voucherAmount: invoiceAmount,
      remarks: `PUR: ${purchaseNo}`,
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
      voucherMasterId: purchaseVoucherMasterId,
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
    purchaseVoucherMasterId,
    outstandingBalance: linePlan.supplierCredit ?? invoiceAmount,
    warnings: linePlan.warnings || [],
  };
}

async function writePurchaseAccounting(client, args) {
  const {
    companyId, branchId, purchaseId, purchaseNo, purchaseDate,
    supplierId, normalized, body, invoiceAmount, sumTax, auditBy,
    existingVoucherMasterId = null,
    existingVoucherPostStatus = null,
  } = args;

  const paymentModeLabel = str(body.paymentMode, 50) || 'CASH';
  const warnings = [];

  try {
    await client.query('SAVEPOINT voucher_save');

    const linePlan = await resolvePurchaseVoucherLinePlan(client, companyId, branchId, {
      purchaseNo, supplierId, normalized, body, invoiceAmount, sumTax, paymentModeLabel,
    });
    warnings.push(...(linePlan.warnings || []));

    const persisted = await persistPurchaseVoucherFromPlan(client, {
      companyId, branchId, purchaseId, purchaseNo, purchaseDate, invoiceAmount, auditBy, linePlan,
      existingVoucherMasterId,
      existingVoucherPostStatus,
    });
    warnings.push(...(persisted.warnings || []));

    await client.query('RELEASE SAVEPOINT voucher_save');
    return {
      purchaseVoucherMasterId: persisted.purchaseVoucherMasterId,
      outstandingBalance: persisted.outstandingBalance ?? invoiceAmount,
      warnings,
    };
  } catch (voucherErr) {
    await client.query('ROLLBACK TO SAVEPOINT voucher_save');
    if (voucherErr.code === '42P01' || voucherErr.code === '42703') {
      warnings.push('Purchase accounting skipped (schema mismatch)');
    } else {
      throw voucherErr;
    }
  }

  return { purchaseVoucherMasterId: null, outstandingBalance: invoiceAmount, warnings };
}

async function loadPurchaseLinesForAccounting(client, companyId, purchaseId) {
  const { rows } = await client.query(
    `SELECT product_id, qty, foc_qty, unit_cost, subtotal_amount, input_tax_1_amount, input_tax_1_rate
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
    subtotalAmount: num(r.subtotal_amount, 0),
    inputTax1Amount: num(r.input_tax_1_amount, 0),
    inputTax1Rate: num(r.input_tax_1_rate, 0),
  }));
}

async function findPurchaseVouchers(db, companyId, branchId, purchaseId) {
  const purchaseVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(db, companyId, 'PurchaseEntryVoucherName', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(db, companyId, 'PUR'))
    || 6;
  const paymentVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(db, companyId, 'PaymentVoucherNameSupplier', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(db, companyId, 'PAY'))
    || 4;

  const vouchers = await voucherRepo.listVouchersByPostedId(db, companyId, branchId, purchaseId, 'INVENTORYACCOUNTS');
  let purchaseVoucher = null;
  let paymentVoucher = null;
  for (const v of vouchers) {
    const typeId = Number(v.master.voucher_type_id);
    if (typeId === purchaseVoucherTypeId) purchaseVoucher = v;
    else if (typeId === paymentVoucherTypeId) paymentVoucher = v;
    else if (!purchaseVoucher) purchaseVoucher = v;
    else if (!paymentVoucher) paymentVoucher = v;
  }
  return { purchaseVoucherTypeId, paymentVoucherTypeId, purchaseVoucher, paymentVoucher };
}

async function findPurchasePaymentVouchers(db, companyId, branchId, purchaseId) {
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT
         ctm.voucher_master_id,
         ctm.transaction_id,
         ctm.transaction_no,
         ctm.transaction_date,
         ctm.status,
         ctm.payment_mode,
         ctm.post_dated_cheque,
         ctm.cheque_details,
         ctm.cheque_date,
         ctm.remarks,
         ctm.modified_at
       FROM accounts.cash_transaction_child ctc
       JOIN accounts.cash_transaction_master ctm
         ON ctm.company_id = ctc.company_id
        AND ctm.transaction_id = ctc.transaction_id
       JOIN ops.purchase_master pm
         ON pm.company_id = ctc.company_id
        AND pm.branch_id = $2
        AND pm.purchase_id = ctc.bill_id
        AND pm.supplier_id = ctm.supplier_id
       WHERE ctc.company_id = $1
         AND ctc.bill_id = $3
         AND ctm.branch_id = $2
         AND ctm.customer_id IS NULL
         AND ctm.supplier_id IS NOT NULL
         AND ctm.voucher_master_id IS NOT NULL
       ORDER BY ctm.voucher_master_id ASC`,
      [companyId, branchId, purchaseId],
    );

    const vouchers = [];
    for (const row of rows) {
      const voucher = await voucherRepo.getVoucherWithDetails(
        db, companyId, branchId, Number(row.voucher_master_id),
      );
      if (voucher?.master) vouchers.push({ voucher, payment: row });
    }
    return vouchers;
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return [];
    throw e;
  }
}

async function syncPurchaseAccountsVoucher(client, companyId, branchId, purchaseId, auditBy) {
  const existing = await purchaseEntryRepo.getPurchaseMaster(client, companyId, purchaseId);
  if (!existing) return null;
  if (String(existing.post_status || '').toUpperCase() === 'POSTED') return null;

  const { purchaseVoucher, paymentVoucher } = await findPurchaseVouchers(client, companyId, branchId, purchaseId);
  if (paymentVoucher?.master?.post_status === 'POSTED') return null;

  const normalized = await loadPurchaseLinesForAccounting(client, companyId, purchaseId);
  if (!normalized.length) return null;

  const body = {
    paymentMode: str(existing.payment_mode, 50) || 'CASH',
    discountAmount: num(existing.discount_amount, 0),
    roundOffAdjustment: num(existing.round_off_adjustment, 0),
  };

  const acct = await writePurchaseAccounting(client, {
    companyId,
    branchId,
    purchaseId,
    purchaseNo: String(existing.purchase_no),
    purchaseDate: existing.purchase_date ? new Date(existing.purchase_date) : new Date(),
    supplierId: Math.trunc(num(existing.supplier_id, 0)),
    normalized,
    body,
    invoiceAmount: round2(num(existing.invoice_amount, 0)),
    sumTax: round2(num(existing.input_tax_1_amount, 0)),
    auditBy,
    existingVoucherMasterId: purchaseVoucher?.master?.voucher_master_id
      ? Number(purchaseVoucher.master.voucher_master_id)
      : null,
    existingVoucherPostStatus: purchaseVoucher?.master?.post_status || null,
  });
  if (acct?.outstandingBalance != null) {
    await patchPurchaseOutstandingBalance(
      client, companyId, purchaseId, branchId, acct.outstandingBalance,
    );
  }
  return acct;
}

async function rebuildPurchaseVoucherIfMissing(client, {
  companyId, branchId, purchaseId, existing, paymentModeLabel, auditBy,
}) {
  const purchaseNo = String(existing.purchase_no);
  const purchaseDate = existing.purchase_date ? new Date(existing.purchase_date) : new Date();
  const supplierId = Math.trunc(num(existing.supplier_id, 0));
  const invoiceAmount = round2(num(existing.invoice_amount, 0));
  const sumTax = round2(num(existing.input_tax_1_amount, 0));
  const normalized = await loadPurchaseLinesForAccounting(client, companyId, purchaseId);
  if (!normalized.length) {
    const err = new Error('Purchase has no lines — cannot create accounts voucher');
    err.status = 400;
    throw err;
  }
  const body = {
    paymentMode: paymentModeLabel,
    discountAmount: num(existing.discount_amount, 0),
    roundOffAdjustment: num(existing.round_off_adjustment, 0),
  };
  return writePurchaseAccounting(client, {
    companyId,
    branchId,
    purchaseId,
    purchaseNo,
    purchaseDate,
    supplierId,
    normalized,
    body,
    invoiceAmount,
    sumTax,
    auditBy,
  });
}

/**
 * PUT /api/purchases/:purchaseId — update draft purchase (before post).
 */
export async function updatePurchase(pool, body, authStaff, purchaseIdParam) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }

  const purchaseId = Math.trunc(num(purchaseIdParam, 0));
  if (purchaseId < 1) {
    const err = new Error('Invalid purchaseId');
    err.status = 400;
    throw err;
  }

  const existing = await purchaseEntryRepo.getPurchaseMaster(pool, companyId, purchaseId);
  if (!existing) {
    const err = new Error('Purchase not found');
    err.status = 404;
    throw err;
  }

  let branchId = parseBranchId(body.branchId);
  if (branchId == null) branchId = Number(existing.branch_id);
  if (Number(existing.branch_id) !== branchId) {
    const err = new Error('Purchase belongs to a different branch');
    err.status = 400;
    throw err;
  }

  if (String(existing.post_status || '').toUpperCase() === 'POSTED') {
    const err = new Error('Posted purchase cannot be updated');
    err.status = 409;
    throw err;
  }

  const purchaseVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(pool, companyId, 'PurchaseEntryVoucherName', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(pool, companyId, 'PUR'))
    || 6;
  const paymentVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(pool, companyId, 'PaymentVoucherNameSupplier', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(pool, companyId, 'PAY'))
    || 4;

  const existingVouchers = await voucherRepo.listVouchersByPostedId(pool, companyId, branchId, purchaseId, 'INVENTORYACCOUNTS');
  let existingPurchaseVoucher = null;
  let existingPaymentVoucher = null;
  for (const v of existingVouchers) {
    const typeId = Number(v.master.voucher_type_id);
    if (typeId === purchaseVoucherTypeId) existingPurchaseVoucher = v;
    else if (typeId === paymentVoucherTypeId) existingPaymentVoucher = v;
  }

  if (existingPurchaseVoucher?.master?.post_status === 'POSTED') {
    const err = new Error('Purchase voucher is already posted — cannot update');
    err.status = 409;
    throw err;
  }

  const supplierId = Math.trunc(num(body.supplierId, existing.supplier_id));
  if (supplierId < 1) {
    const err = new Error('supplierId is required');
    err.status = 400;
    throw err;
  }
  const okSup = await supplierRepo.supplierExists(pool, companyId, supplierId);
  if (!okSup) {
    const err = new Error('Supplier not found for this company');
    err.status = 400;
    throw err;
  }

  const { normalized, sumSub, sumTax, netClient, invoiceAmount, headerDisc, roundOff } = normalizePurchaseInput(body);

  const paymentModeLabel = str(body.paymentMode, 50) || 'CASH';
  const paymentNow = Boolean(body.paymentNow);
  const paySupplierNow = canPaySupplierNow(body.paymentMode, paymentNow);

  if (existingPaymentVoucher?.master?.post_status === 'POSTED') {
    const err = new Error('Payment already posted — delete payment voucher from payment list before updating purchase');
    err.status = 409;
    throw err;
  }

  const supplierInvoiceNo = str(body.supplierInvoiceNo ?? body.supplierInvNo, 50);
  if (!supplierInvoiceNo) {
    const err = new Error('Supplier invoice number is required');
    err.status = 400;
    throw err;
  }

  const purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : new Date(existing.purchase_date);
  if (Number.isNaN(purchaseDate.getTime())) {
    const err = new Error('Invalid purchaseDate');
    err.status = 400;
    throw err;
  }

  const auditBy = auditStaffId(authStaff);
  const userLabel = auditUserName(authStaff);
  const remarks = str(body.remark ?? body.remarks, 200);
  const purchaseNo = String(existing.purchase_no);
  const grnIdOpt = nullableLong(body.grnId);
  const lpoMasterIdOpt = nullableLong(body.lpoMasterId);

  return withTransaction(async (client) => {
    for (let i = 0; i < normalized.length; i += 1) {
      const okP = await productExistsInCompany(client, companyId, normalized[i].productId);
      if (!okP) {
        const err = new Error(`Line ${i + 1}: product not found for this company`);
        err.status = 400;
        throw err;
      }
    }

    const oldChildren = await purchaseEntryRepo.getPurchaseChildren(client, companyId, purchaseId);
    const stockWarnings = [];
    stockWarnings.push(...await reversePurchaseStockIn(client, authStaff, companyId, branchId, purchaseId, oldChildren));

    await purchaseEntryRepo.updatePurchaseMaster(client, companyId, purchaseId, branchId, {
      supplierId,
      grnId: grnIdOpt,
      lpoMasterId: lpoMasterIdOpt,
      purchaseDate,
      supplierInvoiceNo,
      invoiceAmount,
      outstandingBalance: netClient,
      paymentMode: paymentModeLabel,
      remarks,
      discountAmount: headerDisc,
      roundOffAdjustment: roundOff,
      subtotalAmount: sumSub,
      inputTax1Amount: sumTax,
      inputTax1Rate: sumSub > 0 ? round2((sumTax / sumSub) * 100) : 0,
      netVat: sumTax,
      itemsTotalBc: netClient,
      modifiedBy: userLabel,
    });

    await purchaseEntryRepo.softDeletePurchaseChildren(client, companyId, purchaseId);
    await insertPurchaseLines(client, {
      companyId, branchId, purchaseId, normalized, userLabel,
    });
    stockWarnings.push(...await applyPurchaseStockIn(client, authStaff, companyId, branchId, purchaseId, normalized));

    if (existingPaymentVoucher?.master?.voucher_master_id) {
      await voucherRepo.softDeleteVoucher(client, companyId, branchId, Number(existingPaymentVoucher.master.voucher_master_id));
    }

    const existingVmId = existingPurchaseVoucher?.master?.voucher_master_id
      ? Number(existingPurchaseVoucher.master.voucher_master_id)
      : null;

    const acct = await writePurchaseAccounting(client, {
      companyId, branchId, purchaseId, purchaseNo, purchaseDate,
      supplierId, normalized, body: {
        ...body,
        paymentMode: paymentModeLabel,
        discountAmount: headerDisc,
        roundOffAdjustment: roundOff,
      },
      invoiceAmount, sumTax, auditBy,
      existingVoucherMasterId: existingVmId,
      existingVoucherPostStatus: existingPurchaseVoucher?.master?.post_status || null,
    });
    const purchaseVoucherMasterId = acct.purchaseVoucherMasterId;
    const acctWarnings = acct.warnings || [];
    const supplierOs = round2(num(acct.outstandingBalance, netClient));
    await patchPurchaseOutstandingBalance(client, companyId, purchaseId, branchId, supplierOs);

    const warnings = [...stockWarnings, ...acctWarnings].filter(Boolean);
    return {
      purchaseId,
      branchId,
      purchaseNo,
      invoiceAmount: invoiceAmount.toFixed(2),
      netAmount: netClient.toFixed(2),
      lineCount: normalized.length,
      supplierInvoiceNo,
      paymentMode: paymentModeLabel,
      paymentNow: paySupplierNow,
      outstandingBalance: supplierOs.toFixed(2),
      purchaseVoucherMasterId,
      paymentVoucherMasterId: null,
      accountsPosted: purchaseVoucherMasterId != null,
      paymentPosted: false,
      purchasePosted: false,
      updated: true,
      warnings: warnings.length ? warnings : undefined,
    };
  });
}

/**
 * POST /api/purchases/:purchaseId/post — post purchase voucher; Pay now payment runs here only.
 */
export async function postPurchase(pool, authStaff, purchaseIdParam, query, body = {}) {
  const companyId = Number(authStaff.company_id);
  const purchaseId = Math.trunc(num(purchaseIdParam, 0));
  if (purchaseId < 1) {
    const err = new Error('Invalid purchaseId');
    err.status = 400;
    throw err;
  }

  const existing = await purchaseEntryRepo.getPurchaseMaster(pool, companyId, purchaseId);
  if (!existing) {
    const err = new Error('Purchase not found');
    err.status = 404;
    throw err;
  }

  let branchId = parseBranchId(query?.branchId);
  if (branchId == null) branchId = Number(existing.branch_id);

  const paymentModeLabel = str(body.paymentMode ?? existing.payment_mode, 50) || 'CASH';
  const paymentNow = Boolean(body.paymentNow);
  const paySupplierNow = canPaySupplierNow(paymentModeLabel, paymentNow);
  const paymentLedgerAccountId = nullableLong(body.paymentLedgerAccountId);
  const invoiceAmount = round2(num(existing.invoice_amount, 0));
  const purchaseNo = String(existing.purchase_no);
  const purchaseDate = existing.purchase_date ? new Date(existing.purchase_date) : new Date();
  const supplierId = Math.trunc(num(existing.supplier_id, 0));
  const auditBy = auditStaffId(authStaff);

  if (paySupplierNow && !paymentLedgerAccountId) {
    const err = new Error('Select cash/bank account head for Pay now before posting');
    err.status = 400;
    throw err;
  }

  const purchaseVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(pool, companyId, 'PurchaseEntryVoucherName', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(pool, companyId, 'PUR'))
    || 6;
  const paymentVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(pool, companyId, 'PaymentVoucherNameSupplier', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(pool, companyId, 'PAY'))
    || 4;

  const vouchers = await voucherRepo.listVouchersByPostedId(pool, companyId, branchId, purchaseId, 'INVENTORYACCOUNTS');
  let purchaseVoucher = vouchers.find((v) => Number(v.master.voucher_type_id) === purchaseVoucherTypeId)
    || vouchers.find((v) => Number(v.master.voucher_type_id) !== paymentVoucherTypeId);
  let existingPaymentVoucher = vouchers.find((v) => Number(v.master.voucher_type_id) === paymentVoucherTypeId);

  if (!purchaseVoucher?.master?.voucher_master_id) {
    await accountsParameterRepo.ensureBranchIntegrationDefaults(pool, companyId, branchId);
    const rebuilt = await withTransaction(async (client) => rebuildPurchaseVoucherIfMissing(client, {
      companyId, branchId, purchaseId, existing, paymentModeLabel, auditBy,
    }));
    if (!rebuilt.purchaseVoucherMasterId) {
      const err = new Error(
        'Purchase accounts voucher could not be created — set Purchase DR ledger and Supplier parent in Branch Account Integration (Purchase + Payment tabs)',
      );
      err.status = 400;
      throw err;
    }
    const refreshed = await voucherRepo.listVouchersByPostedId(pool, companyId, branchId, purchaseId, 'INVENTORYACCOUNTS');
    purchaseVoucher = refreshed.find((v) => Number(v.master.voucher_type_id) === purchaseVoucherTypeId)
      || refreshed.find((v) => Number(v.master.voucher_type_id) !== paymentVoucherTypeId);
    existingPaymentVoucher = refreshed.find((v) => Number(v.master.voucher_type_id) === paymentVoucherTypeId);
  }

  if (!purchaseVoucher?.master?.voucher_master_id) {
    const err = new Error('No purchase voucher found — save or update the purchase after configuring Account Integration');
    err.status = 400;
    throw err;
  }

  const alreadyPosted = String(existing.post_status || '').toUpperCase() === 'POSTED'
    || purchaseVoucher.master.post_status === 'POSTED';

  if (alreadyPosted && existingPaymentVoucher?.master?.post_status === 'POSTED') {
    return {
      purchaseId,
      branchId,
      purchaseNo,
      purchasePosted: true,
      paymentPosted: true,
      outstandingBalance: '0.00',
      voucherMasterId: Number(purchaseVoucher.master.voucher_master_id),
      paymentVoucherMasterId: Number(existingPaymentVoucher.master.voucher_master_id),
      message: 'Purchase already posted and paid',
    };
  }

  if (alreadyPosted && !paySupplierNow) {
    return {
      purchaseId,
      branchId,
      purchaseNo,
      purchasePosted: true,
      paymentPosted: false,
      outstandingBalance: round2(num(existing.outstanding_balance, invoiceAmount)).toFixed(2),
      voucherMasterId: Number(purchaseVoucher.master.voucher_master_id),
      message: 'Purchase already posted',
    };
  }

  return withTransaction(async (client) => {
    const voucherMasterId = Number(purchaseVoucher.master.voucher_master_id);
    let paymentVoucherMasterId = existingPaymentVoucher?.master?.post_status === 'POSTED'
      ? Number(existingPaymentVoucher.master.voucher_master_id)
      : null;
    let outstandingBalance = round2(num(existing.outstanding_balance, invoiceAmount));
    const warnings = [];

    if (purchaseVoucher.master.post_status !== 'POSTED') {
      await voucherRepo.updateVoucherPostStatus(client, companyId, branchId, voucherMasterId, 'POSTED');
      await purchaseEntryRepo.updatePurchasePostStatus(client, companyId, purchaseId, branchId, 'POSTED');
    }

    if (paySupplierNow && !paymentVoucherMasterId) {
      const supplierLedgerId = await partyLedgerService.ensureSupplierLedgerForId(
        client, companyId, branchId, supplierId,
      );
      const paymentLedgerId = await resolvePaymentLedger(
        client, companyId, branchId, paymentModeLabel, paymentLedgerAccountId,
      );
      if (!paymentLedgerId) {
        const err = new Error('Pay now failed — configure cash/card ledger in Account Integration');
        err.status = 400;
        throw err;
      }
      if (!supplierLedgerId) {
        const err = new Error('Supplier ledger not configured');
        err.status = 400;
        throw err;
      }

      paymentVoucherMasterId = await postSupplierPaymentVoucher(client, {
        companyId, branchId, purchaseId, purchaseNo,
        supplierLedgerId, paymentLedgerId,
        amount: invoiceAmount, purchaseDate, auditBy,
        paymentVoucherTypeId,
      });
      await reducePurchaseSupplierOutstanding(
        client, companyId, purchaseId, supplierLedgerId, invoiceAmount, purchaseVoucherTypeId,
      );
      outstandingBalance = 0;
      await client.query(
        `UPDATE ops.purchase_master
         SET outstanding_balance = 0, payment_mode = $4, modified_at = NOW()
         WHERE company_id = $1 AND purchase_id = $2 AND branch_id = $3`,
        [companyId, purchaseId, branchId, paymentModeLabel],
      );
    } else if (!paySupplierNow && outstandingBalance <= 0 && invoiceAmount > 0) {
      outstandingBalance = invoiceAmount;
      await client.query(
        `UPDATE ops.purchase_master
         SET outstanding_balance = $4, payment_mode = $5, modified_at = NOW()
         WHERE company_id = $1 AND purchase_id = $2 AND branch_id = $3`,
        [companyId, purchaseId, branchId, outstandingBalance, paymentModeLabel],
      );
    }

    return {
      purchaseId,
      branchId,
      purchaseNo,
      purchasePosted: true,
      paymentPosted: paymentVoucherMasterId != null,
      paymentNow: paySupplierNow,
      outstandingBalance: outstandingBalance.toFixed(2),
      voucherMasterId,
      paymentVoucherMasterId,
      warnings: warnings.length ? warnings : undefined,
    };
  });
}

/**
 * POST /api/purchases/:purchaseId/unpost — reverse purchase post when supplier payment is not posted.
 */
export async function unpostPurchase(pool, authStaff, purchaseIdParam, query) {
  const companyId = Number(authStaff.company_id);
  const purchaseId = Math.trunc(num(purchaseIdParam, 0));
  if (purchaseId < 1) {
    const err = new Error('Invalid purchaseId');
    err.status = 400;
    throw err;
  }

  const existing = await purchaseEntryRepo.getPurchaseMaster(pool, companyId, purchaseId);
  if (!existing) {
    const err = new Error('Purchase not found');
    err.status = 404;
    throw err;
  }

  let branchId = parseBranchId(query?.branchId);
  if (branchId == null) branchId = Number(existing.branch_id);

  const masterPosted = String(existing.post_status || '').toUpperCase() === 'POSTED';
  if (!masterPosted) {
    const err = new Error('Purchase is not posted');
    err.status = 409;
    throw err;
  }

  const purchaseVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(pool, companyId, 'PurchaseEntryVoucherName', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(pool, companyId, 'PUR'))
    || 6;
  const paymentVoucherTypeId =
    (await voucherRepo.getVoucherTypeId(pool, companyId, 'PaymentVoucherNameSupplier', branchId))
    || (await voucherRepo.getVoucherTypeIdByCode(pool, companyId, 'PAY'))
    || 4;

  const vouchers = await voucherRepo.listVouchersByPostedId(pool, companyId, branchId, purchaseId, 'INVENTORYACCOUNTS');
  const purchaseVoucher = vouchers.find((v) => Number(v.master.voucher_type_id) === purchaseVoucherTypeId)
    || vouchers.find((v) => Number(v.master.voucher_type_id) !== paymentVoucherTypeId);
  const paymentVoucher = vouchers.find((v) => Number(v.master.voucher_type_id) === paymentVoucherTypeId);

  if (paymentVoucher?.master?.post_status === 'POSTED') {
    const err = new Error(
      'Cannot unpost — supplier payment is already posted. Unpost the payment voucher from Accounts first.',
    );
    err.status = 409;
    throw err;
  }

  const purchaseNo = String(existing.purchase_no);
  const invoiceAmount = round2(num(existing.invoice_amount, 0));
  const voucherMasterId = purchaseVoucher?.master?.voucher_master_id
    ? Number(purchaseVoucher.master.voucher_master_id)
    : null;
  const auditBy = auditStaffId(authStaff);

  return withTransaction(async (client) => {
    if (voucherMasterId && purchaseVoucher?.master?.post_status === 'POSTED') {
      await voucherRepo.updateVoucherPostStatus(client, companyId, branchId, voucherMasterId, 'PENDING');
    }

    await purchaseEntryRepo.updatePurchasePostStatus(client, companyId, purchaseId, branchId, 'DRAFT');

    const outstandingBalance = round2(num(existing.outstanding_balance, invoiceAmount));
    const restoredOs = outstandingBalance > 0 ? outstandingBalance : invoiceAmount;
    if (restoredOs > 0 && outstandingBalance <= 0) {
      await client.query(
        `UPDATE ops.purchase_master
         SET outstanding_balance = $4, modified_at = NOW()
         WHERE company_id = $1 AND purchase_id = $2 AND branch_id = $3`,
        [companyId, purchaseId, branchId, restoredOs],
      );
    }

    await syncPurchaseAccountsVoucher(client, companyId, branchId, purchaseId, auditBy);

    return {
      purchaseId,
      branchId,
      purchaseNo,
      purchasePosted: false,
      paymentPosted: false,
      outstandingBalance: (restoredOs > 0 ? restoredOs : outstandingBalance).toFixed(2),
      voucherMasterId,
      unposted: true,
    };
  });
}

export async function getPurchaseAccounts(pool, authStaff, purchaseId, query) {
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

  const master = await purchaseEntryRepo.getPurchaseMaster(pool, companyId, pid);
  if (!master) {
    const err = new Error('Purchase not found');
    err.status = 404;
    throw err;
  }
  if (Number(master.branch_id) !== branchId) {
    const err = new Error('Purchase belongs to a different branch');
    err.status = 400;
    throw err;
  }

  const masterPosted = String(master.post_status || '').toUpperCase() === 'POSTED';
  let masterRow = master;
  if (!masterPosted && String(query?.sync ?? '1') !== '0') {
    try {
      await withTransaction(async (client) => {
        await syncPurchaseAccountsVoucher(client, companyId, branchId, pid, auditStaffId(authStaff));
      });
      masterRow = await purchaseEntryRepo.getPurchaseMaster(pool, companyId, pid);
    } catch (syncErr) {
      console.warn('Purchase accounts sync skipped:', syncErr.message);
    }
  }

  const { purchaseVoucher, paymentVoucher } =
    await findPurchaseVouchers(pool, companyId, branchId, pid);
  const allocatedPaymentVouchers = await findPurchasePaymentVouchers(pool, companyId, branchId, pid);

  let mappedPurchase = purchaseVoucher ? mapVoucherToApi(purchaseVoucher) : null;
  const directPayment = paymentVoucher ? mapPaymentVoucherToApi(paymentVoucher) : null;
  const allocatedPayments = allocatedPaymentVouchers.map(mapPaymentVoucherToApi).filter(Boolean);
  const paymentMap = new Map();
  for (const p of [directPayment, ...allocatedPayments].filter(Boolean)) {
    paymentMap.set(Number(p.voucherMasterId), p);
  }
  const paymentVouchers = [...paymentMap.values()];
  const mappedPayment = paymentVouchers[0] ?? null;

  let outstandingBalance = num(masterRow.outstanding_balance, num(masterRow.invoice_amount, 0));
  const fromVoucher = supplierOutstandingFromVoucher(mappedPurchase, null);
  if (fromVoucher != null) {
    outstandingBalance = fromVoucher;
  }

  return {
    purchaseId: pid,
    branchId,
    purchaseNo: masterRow.purchase_no != null ? String(masterRow.purchase_no) : '',
    supplierInvoiceNo: masterRow.supplier_invoice_no ?? null,
    invoiceAmount: masterRow.invoice_amount != null ? String(masterRow.invoice_amount) : '0',
    paymentMode: masterRow.payment_mode ?? null,
    outstandingBalance: outstandingBalance.toFixed(2),
    paymentDone: paymentVouchers.some((p) => p.postStatus === 'POSTED'),
    purchasePosted: mappedPurchase != null && mappedPurchase.postStatus === 'POSTED',
    purchaseVoucher: mappedPurchase,
    paymentVoucher: mappedPayment,
    paymentVouchers,
    accountsPosted: mappedPurchase != null,
  };
}

function parseBankReconFromRemarks(remarks) {
  const text = String(remarks || '');
  return {
    bankStatementDate: text.match(/\[BR_DATE:([^\]]+)\]/)?.[1] || null,
    bankReference: text.match(/\[BR_REF:([^\]]+)\]/)?.[1] || null,
  };
}

function mapPaymentVoucherToApi(record) {
  const voucher = record?.voucher ?? record;
  const mapped = mapVoucherToApi(voucher);
  if (!mapped) return null;
  const payment = record?.payment ?? null;
  if (!payment) return mapped;
  const paymentStatus = String(payment.status || 'ACTIVE').toUpperCase();
  const postDatedCheque = Boolean(payment.post_dated_cheque)
    || String(payment.payment_mode || '').toUpperCase() === 'CHEQUE';
  const bankRecon = parseBankReconFromRemarks(payment.remarks);
  const pdcPending = postDatedCheque && paymentStatus === 'PDC_PENDING';
  const bankReconciled = paymentStatus === 'BANK_RECONCILED';
  return {
    ...mapped,
    transactionId: payment.transaction_id != null ? Number(payment.transaction_id) : null,
    transactionNo: payment.transaction_no != null ? Number(payment.transaction_no) : null,
    paymentStatus,
    paymentMode: payment.payment_mode || mapped.voucherTypeCode || '',
    paymentDate: payment.transaction_date || mapped.voucherDate,
    postDatedCheque,
    chequeDetails: payment.cheque_details || null,
    chequeDate: payment.cheque_date || null,
    pdcPending,
    pdcCleared: postDatedCheque && !pdcPending,
    bankReconciled,
    bankStatementDate: bankRecon.bankStatementDate,
    bankReference: bankRecon.bankReference,
    pdcStatusDate: payment.modified_at || null,
  };
}

/**
 * POST /api/purchases/:purchaseId/accounts/preview — ledger lines from current form (no save).
 */
export async function previewPurchaseAccounts(pool, authStaff, purchaseIdParam, body, query) {
  const companyId = Number(authStaff.company_id);
  const purchaseId = Math.trunc(num(purchaseIdParam, 0));
  if (purchaseId < 1) {
    const err = new Error('Invalid purchaseId');
    err.status = 400;
    throw err;
  }

  const existing = await purchaseEntryRepo.getPurchaseMaster(pool, companyId, purchaseId);
  if (!existing) {
    const err = new Error('Purchase not found');
    err.status = 404;
    throw err;
  }

  let branchId = parseBranchId(query?.branchId);
  if (branchId == null) branchId = Number(existing.branch_id);
  if (Number(existing.branch_id) !== branchId) {
    const err = new Error('Purchase belongs to a different branch');
    err.status = 400;
    throw err;
  }

  if (String(existing.post_status || '').toUpperCase() === 'POSTED') {
    return getPurchaseAccounts(pool, authStaff, purchaseId, query);
  }

  const { normalized, sumTax, invoiceAmount } = normalizePurchaseInput(body);
  const paymentModeLabel = str(body.paymentMode ?? existing.payment_mode, 50) || 'CASH';
  const purchaseNo = String(existing.purchase_no);
  const supplierId = Math.trunc(num(body.supplierId, existing.supplier_id));

  const linePlan = await resolvePurchaseVoucherLinePlan(pool, companyId, branchId, {
    purchaseNo,
    supplierId,
    normalized,
    body,
    invoiceAmount,
    sumTax,
    paymentModeLabel,
  });

  const enrichedLines = await enrichVoucherLinesWithAccountHeads(pool, companyId, linePlan.lines);
  const supplierCredit = linePlan.supplierCredit ?? invoiceAmount;

  return {
    purchaseId,
    branchId,
    purchaseNo,
    preview: true,
    invoiceAmount: invoiceAmount.toFixed(2),
    outstandingBalance: round2(supplierCredit).toFixed(2),
    paymentDone: false,
    purchasePosted: false,
    accountsPosted: enrichedLines.length > 0,
    purchaseVoucher: enrichedLines.length
      ? {
          voucherNo: 'Preview',
          postStatus: 'PREVIEW',
          lines: enrichedLines,
        }
      : null,
    paymentVoucher: null,
    warnings: linePlan.warnings?.length ? linePlan.warnings : undefined,
    message: enrichedLines.length
      ? 'Preview from current entry — save to persist voucher lines.'
      : 'Configure purchase DR and supplier ledgers in Branch Account Integration.',
  };
}

export async function listPurchases(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
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

  const { lim, off } = parseLimitOffset(query);
  const rows = await purchaseEntryRepo.listPurchasesByBranch(pool, companyId, branchId, lim, off, {
    dateFrom: parseOptionalISODate(query.dateFrom),
    dateTo: parseOptionalISODate(query.dateTo),
  });
  return rows.map(mapPurchaseMasterToApi);
}

export async function lookupPurchase(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  let branchId = parseBranchId(query.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
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

  const purchaseNo = query.purchaseNo != null ? String(query.purchaseNo).trim() : '';
  const supplierInvoiceNo = query.supplierInvoiceNo != null ? String(query.supplierInvoiceNo).trim() : '';
  if (!purchaseNo && !supplierInvoiceNo) {
    const err = new Error('Enter Purchase # or Sup Inv# to load');
    err.status = 400;
    throw err;
  }

  const result = await purchaseEntryRepo.findPurchaseByLookup(pool, companyId, branchId, {
    purchaseNo: purchaseNo || undefined,
    supplierInvoiceNo: supplierInvoiceNo || undefined,
  });

  if (result.kind === 'not_found') {
    const err = new Error('Purchase not found for this branch');
    err.status = 404;
    throw err;
  }
  if (result.kind === 'ambiguous') {
    const err = new Error(`Multiple purchases match supplier invoice — enter Purchase # (${result.count} found)`);
    err.status = 409;
    throw err;
  }
  if (result.kind !== 'found') {
    const err = new Error('Purchase not found');
    err.status = 404;
    throw err;
  }

  return {
    purchaseId: result.purchaseId,
    purchaseNo: result.purchaseNo,
    supplierInvoiceNo: result.supplierInvoiceNo,
    branchId,
    postStatus: result.postStatus,
    recordStatus: result.recordStatus,
  };
}

export async function getPurchase(pool, authStaff, purchaseIdParam, query) {
  const companyId = Number(authStaff.company_id);
  const purchaseId = Math.trunc(num(purchaseIdParam, 0));
  if (purchaseId < 1) {
    const err = new Error('Invalid purchaseId');
    err.status = 400;
    throw err;
  }

  const master = await purchaseEntryRepo.getPurchaseMaster(pool, companyId, purchaseId);
  if (!master) {
    const err = new Error('Purchase not found');
    err.status = 404;
    throw err;
  }

  let branchId = parseBranchId(query?.branchId);
  if (branchId == null) branchId = Number(master.branch_id);
  if (Number(master.branch_id) !== branchId) {
    const err = new Error('Purchase belongs to a different branch');
    err.status = 400;
    throw err;
  }

  const lineRows = await purchaseEntryRepo.listPurchaseLines(pool, companyId, purchaseId);
  const accountsSummary = await getPurchaseAccounts(pool, authStaff, purchaseId, { branchId });

  const postStatus = String(master.post_status || '').toUpperCase();
  const recordStatus = String(master.record_status || '').toUpperCase();
  const purchasePosted = postStatus === 'POSTED'
    || Boolean(accountsSummary?.purchasePosted);
  const paymentPosted = Boolean(accountsSummary?.paymentDone);
  const cancelled = postStatus === 'CANCELLED' || recordStatus === 'CANCELLED';
  const canUnpost = purchasePosted && !paymentPosted && !cancelled;

  return {
    ...mapPurchaseMasterToApi(master),
    purchasePosted,
    paymentPosted,
    canUnpost,
    paymentNow: paymentPosted || (accountsSummary?.paymentVoucher != null),
    cancelled,
    lines: lineRows.map(mapPurchaseLineToApi).filter(Boolean),
    accountsSummary,
  };
}
