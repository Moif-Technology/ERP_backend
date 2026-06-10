import { withTransaction } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as lpoRepo from '../repositories/lpo.repository.js';
import * as grnRepo from '../repositories/grn.repository.js';
import * as supplierRepo from '../repositories/supplier.repository.js';
import * as purchaseEntryRepo from '../repositories/purchaseEntry.repository.js';

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

function parsePaymentMode(raw) {
  const s = (str(raw, 50) || 'CASH').toUpperCase();
  if (s.includes('CREDIT') && !s.includes('CARD')) return 'CREDIT';
  if (s.includes('CARD') || s.includes('BANK')) return 'CARD';
  return 'CASH';
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

  const netClient = round2(num(body.netAmount, sumLineTotal));
  if (Math.abs(netClient - sumLineTotal) > 0.05) {
    const err = new Error(
      `Net amount does not match line totals (expected ${sumLineTotal.toFixed(2)}, got ${netClient.toFixed(2)})`,
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

  const paymentMode = parsePaymentMode(body.paymentMode);
  const paymentNow = Boolean(body.paymentNow);
  let outstandingBalance = 0;
  if (paymentMode === 'CREDIT' && !paymentNow) {
    outstandingBalance = invoiceAmount;
  }

  const purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : new Date();
  if (Number.isNaN(purchaseDate.getTime())) {
    const err = new Error('Invalid purchaseDate');
    err.status = 400;
    throw err;
  }

  const userLabel = (authStaff.staff_name || '').slice(0, 50) || 'system';
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
    const purchaseNo = await purchaseEntryRepo.nextPurchaseNo(client, companyId, branchId);

    await purchaseEntryRepo.insertPurchaseMaster(client, {
      companyId,
      purchaseId,
      branchId,
      supplierId,
      grnId: grnIdOpt,
      lpoMasterId: lpoMasterIdOpt,
      purchaseDate,
      purchaseNo,
      supplierInvoiceNo: str(body.supplierInvoiceNo ?? body.supplierInvNo, 50),
      invoiceAmount,
      outstandingBalance,
      paymentMode,
      postStatus: 'DRAFT',
      discountAmount: 0,
      roundOffAdjustment: 0,
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

    return {
      purchaseId,
      branchId,
      purchaseNo: String(purchaseNo),
      invoiceAmount: invoiceAmount.toFixed(2),
      netAmount: netClient.toFixed(2),
      lineCount: normalized.length,
    };
  });
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
  const rows = await purchaseEntryRepo.listPurchasesByBranch(pool, companyId, branchId, lim, off);
  return rows.map(mapPurchaseMasterToApi);
}
