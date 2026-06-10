import { withTransaction } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as lpoRepo from '../repositories/lpo.repository.js';
import * as supplierRepo from '../repositories/supplier.repository.js';

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function num(v, d = 0) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function str(v, max = 500) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function mapMasterToApi(row) {
  if (!row) return null;
  return {
    lpoMasterId: Number(row.lpo_master_id),
    branchId: Number(row.branch_id),
    lpoNo: row.lpo_no,
    lpoDate: row.lpo_date,
    supplierId: row.supplier_id != null ? Number(row.supplier_id) : null,
    lpoAmount: row.lpo_amount != null ? String(row.lpo_amount) : '0',
    discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
    subTotal: row.sub_total != null ? String(row.sub_total) : '0',
    status: row.status,
    recordStatus: row.record_status,
    remarks: row.remarks,
    orderFormNo: row.order_form_no ?? null,
    supplierDisplayName: row.supplier_display_name ?? null,
    supplierQuotationNo: row.supplier_quotation_no ?? null,
    discountMode: row.discount_mode ?? null,
    bySupplier: Boolean(row.by_supplier),
    listItems: Boolean(row.list_items),
    useDiscPct: Boolean(row.use_disc_pct),
    lpoTerms: row.lpo_terms ?? null,
  };
}

function mapChildToApi(row) {
  const subRaw = row.subtotal_amount != null ? row.subtotal_amount : row.sub_total;
  const discRaw = row.item_discount != null ? row.item_discount : row.discount;
  const vatAmt = row.vat_amount != null ? row.vat_amount : row.input_tax_1_amount;
  const subN = num(subRaw, 0);
  const vatN = num(vatAmt, 0);
  const lineFromCols =
    row.line_total != null
      ? row.line_total
      : round2(subN + vatN);
  return {
    lpoChildId: Number(row.lpo_child_id),
    productId: Number(row.product_id),
    barcode: row.barcode,
    description: row.description,
    uom: row.uom,
    qty: row.qty != null ? String(row.qty) : '0',
    unitPrice: row.unit_price != null ? String(row.unit_price) : '0',
    itemDiscount: discRaw != null ? String(discRaw) : '0',
    subtotalAmount: subRaw != null ? String(subRaw) : '0',
    lineTotal: lineFromCols != null ? String(lineFromCols) : '0',
    focQty: row.foc_qty != null ? String(row.foc_qty) : '0',
    packQty: row.pack_qty != null ? String(row.pack_qty) : '1',
    ownRefNo: row.own_ref_no ?? null,
    baseCost: row.base_cost != null ? String(row.base_cost) : '0',
    discPercent: row.disc_percent != null ? String(row.disc_percent) : '0',
    vatPercent:
      row.vat_percent != null
        ? String(row.vat_percent)
        : row.input_tax_1_rate != null
          ? String(row.input_tax_1_rate)
          : '0',
    vatAmount: vatAmt != null ? String(vatAmt) : '0',
  };
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

function resolveCompanyBranch(authStaff, body) {
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
  return { companyId, branchId };
}

export async function listLpos(pool, authStaff, query) {
  const { companyId, branchId } = resolveCompanyBranch(authStaff, query);
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }
  const rows = await lpoRepo.listLposByBranch(pool, companyId, branchId, query.limit);
  return rows.map(mapMasterToApi);
}

export async function getLpo(pool, authStaff, lpoMasterId) {
  const companyId = Number(authStaff.company_id);
  const lid = Number(lpoMasterId);
  if (!Number.isFinite(lid) || lid < 1) {
    const err = new Error('Invalid LPO id');
    err.status = 400;
    throw err;
  }
  const full = await lpoRepo.getLpoWithLines(pool, companyId, lid);
  if (!full) {
    const err = new Error('LPO not found');
    err.status = 404;
    throw err;
  }
  return {
    lpo: mapMasterToApi(full.master),
    lines: (full.children || []).map(mapChildToApi),
  };
}

function normalizeLpoLines(bodyLines) {
  const raw = Array.isArray(bodyLines) ? bodyLines : [];
  const normalized = [];
  let sumLineTotal = 0;
  let sumSub = 0;
  let sumTax = 0;

  for (let i = 0; i < raw.length; i += 1) {
    const L = raw[i] || {};
    const productId = Math.trunc(num(L.productId ?? L.product_id, 0));
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
    const unit = round2(num(L.unitCost ?? L.unitPrice, 0) > 0 ? num(L.unitCost ?? L.unitPrice) : num(L.baseCost, 0));
    if (unit <= 0) {
      const err = new Error(`Line ${i + 1}: unit cost is required`);
      err.status = 400;
      throw err;
    }
    const subL = round2(num(L.subTotal ?? L.subtotalAmount, 0));
    const taxAmt = round2(num(L.vatAmount ?? L.vatAmt, 0));
    const lt = round2(num(L.lineTotal ?? L.total, subL + taxAmt));
    const gross = round2(qty * unit);
    const itemDiscount = round2(Math.max(0, gross - subL));
    const discPct = round2(num(L.discPercent ?? L.discountPercentage, 0));
    const vatPct = round2(num(L.vatPercent ?? L.vatPct, 0));

    sumLineTotal += lt;
    sumSub += subL;
    sumTax += taxAmt;

    normalized.push({
      productId,
      ownRefNo: str(L.ownRefNo ?? L.own_ref_no, 120),
      barcode: str(L.barCode ?? L.barcode, 100),
      description: str(L.shortDescription ?? L.description, 500),
      uom: str(L.uom ?? L.unitName, 50) || 'PCS',
      qty,
      unitPrice: unit,
      itemDiscount,
      subtotalAmount: subL,
      lineTotal: lt,
      focQty: Math.max(0, num(L.foc ?? L.focQty, 0)),
      packQty: Math.max(0.0001, num(L.packQty, 1)),
      baseCost: round2(num(L.baseCost, unit)),
      discPercent: discPct,
      vatPercent: vatPct,
      vatAmount: taxAmt,
    });
  }

  return {
    lines: normalized,
    sumLineTotal: round2(sumLineTotal),
    sumSub: round2(sumSub),
    sumTax: round2(sumTax),
  };
}

function buildMasterPayload(body, ctx) {
  const { companyId, branchId, lpoMasterId, supplierId, lpoDate, sumSub, sumLineTotal } = ctx;

  const headerDisc = round2(num(body.discountAmount ?? body.headerDiscount, 0));
  const expectedAfterHeader = round2(sumLineTotal - headerDisc);
  const netClient = round2(num(body.netAmount, expectedAfterHeader));
  if (netClient <= 0) {
    const err = new Error('netAmount must be > 0');
    err.status = 400;
    throw err;
  }
  const matchesLines = Math.abs(netClient - sumLineTotal) <= 0.05;
  const matchesAfterDisc = Math.abs(netClient - expectedAfterHeader) <= 0.05;
  if (!matchesLines && !matchesAfterDisc) {
    const err = new Error(
      `netAmount does not match lines (expected about ${sumLineTotal.toFixed(2)} or ${expectedAfterHeader.toFixed(2)}, got ${netClient.toFixed(2)})`,
    );
    err.status = 400;
    throw err;
  }

  const trimmedNo = str(body.lpoNo ?? body.lpo_no, 50);
  const digitsOnly = trimmedNo ? String(trimmedNo).replace(/\D/g, '') : '';
  /** Some DBs use bigint for lpo_no; strip non-digits so alphanumeric UI values still save. */
  const finalNo = digitsOnly.length ? digitsOnly : String(lpoMasterId);

  return {
    companyId,
    lpoMasterId,
    branchId,
    lpoNo: finalNo,
    lpoDate,
    supplierId,
    lpoAmount: netClient,
    discountAmount: headerDisc,
    subTotal: sumSub,
    status: str(body.status, 50) || 'DRAFT',
    recordStatus: 'ACTIVE',
    remarks: str(body.remarks, 500),
    orderFormNo: str(body.orderFormNo ?? body.orderFrom, 120),
    supplierDisplayName: str(body.supplierDisplayName ?? body.lpoSupplierName, 255),
    supplierQuotationNo: str(body.supplierQuotationNo ?? body.supplier_quotation_no, 120),
    discountMode: str(body.discountMode ?? body.discount, 50),
    bySupplier: Boolean(body.bySupplier ?? body.by_supplier),
    listItems: Boolean(body.listItem ?? body.listItems ?? body.list_items),
    useDiscPct: Boolean(body.useDiscPct ?? body.use_disc_pct),
    lpoTerms: body.lpoTerms != null ? String(body.lpoTerms).trim().slice(0, 2000) : '',
  };
}

export async function createLpo(pool, body, authStaff) {
  const { companyId, branchId } = resolveCompanyBranch(authStaff, body);
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!ok) {
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

  const { lines, sumLineTotal, sumSub } = normalizeLpoLines(body.lines);
  if (!lines.length) {
    const err = new Error('At least one line is required');
    err.status = 400;
    throw err;
  }

  const lpoDate = body.lpoDate ? new Date(body.lpoDate) : new Date();
  if (Number.isNaN(lpoDate.getTime())) {
    const err = new Error('Invalid lpoDate');
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    for (let i = 0; i < lines.length; i += 1) {
      const okP = await productExistsInCompany(client, companyId, lines[i].productId);
      if (!okP) {
        const err = new Error(`Line ${i + 1}: product not found for this company`);
        err.status = 400;
        throw err;
      }
    }

    const lpoMasterId = await lpoRepo.nextLpoMasterId(client, companyId);
    const masterRow = buildMasterPayload(body, {
      companyId,
      branchId,
      lpoMasterId,
      supplierId,
      lpoDate,
      sumSub,
      sumLineTotal,
    });

    try {
      await lpoRepo.insertLpoMaster(client, masterRow);
    } catch (e) {
      if (e.code === '23505') {
        const err = new Error('LPO number already exists for this branch');
        err.status = 409;
        throw err;
      }
      if (e.code === '42703') {
        const err = new Error(
          'LPO schema is outdated. Run database/migrations/039_ops_lpo_detail_columns.sql (and 038 if needed).',
        );
        err.status = 503;
        throw err;
      }
      throw e;
    }

    for (let i = 0; i < lines.length; i += 1) {
      const L = lines[i];
      const lpoChildId = await lpoRepo.nextLpoChildId(client, companyId);
      await lpoRepo.insertLpoChild(client, {
        companyId,
        branchId,
        lpoChildId,
        lpoMasterId,
        productId: L.productId,
        qty: L.qty,
        unitPrice: L.unitPrice,
        itemDiscount: L.itemDiscount,
        subtotalAmount: L.subtotalAmount,
        lineTotal: L.lineTotal,
        uom: L.uom,
        barcode: L.barcode,
        description: L.description,
        focQty: L.focQty,
        packQty: L.packQty,
        ownRefNo: L.ownRefNo,
        baseCost: L.baseCost,
        discPercent: L.discPercent,
        vatPercent: L.vatPercent,
        vatAmount: L.vatAmount,
      });
    }

    const full = await lpoRepo.getLpoWithLines(client, companyId, lpoMasterId);
    return {
      lpo: mapMasterToApi(full.master),
      lines: (full.children || []).map(mapChildToApi),
    };
  });
}

export async function updateLpo(pool, body, authStaff, lpoMasterIdParam) {
  const { companyId, branchId } = resolveCompanyBranch(authStaff, body);
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  const lpoMasterId = Math.trunc(Number(lpoMasterIdParam));
  if (!Number.isFinite(lpoMasterId) || lpoMasterId < 1) {
    const err = new Error('Invalid LPO id');
    err.status = 400;
    throw err;
  }

  const existing = await lpoRepo.getLpoWithLines(pool, companyId, lpoMasterId);
  if (!existing) {
    const err = new Error('LPO not found');
    err.status = 404;
    throw err;
  }
  if (Number(existing.master.branch_id) !== branchId) {
    const err = new Error('LPO belongs to a different branch');
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

  const { lines, sumLineTotal, sumSub } = normalizeLpoLines(body.lines);
  if (!lines.length) {
    const err = new Error('At least one line is required');
    err.status = 400;
    throw err;
  }

  const lpoDate = body.lpoDate ? new Date(body.lpoDate) : new Date();
  if (Number.isNaN(lpoDate.getTime())) {
    const err = new Error('Invalid lpoDate');
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    for (let i = 0; i < lines.length; i += 1) {
      const okP = await productExistsInCompany(client, companyId, lines[i].productId);
      if (!okP) {
        const err = new Error(`Line ${i + 1}: product not found for this company`);
        err.status = 400;
        throw err;
      }
    }

    const masterRow = buildMasterPayload(body, {
      companyId,
      branchId,
      lpoMasterId,
      supplierId,
      lpoDate,
      sumSub,
      sumLineTotal,
    });

    try {
      await lpoRepo.updateLpoMaster(client, companyId, lpoMasterId, masterRow);
    } catch (e) {
      if (e.code === '23505') {
        const err = new Error('LPO number already exists for this branch');
        err.status = 409;
        throw err;
      }
      if (e.code === '42703') {
        const err = new Error(
          'LPO schema is outdated. Run database/migrations/039_ops_lpo_detail_columns.sql (and 038 if needed).',
        );
        err.status = 503;
        throw err;
      }
      throw e;
    }

    await lpoRepo.deleteLpoChildren(client, companyId, lpoMasterId);

    for (let i = 0; i < lines.length; i += 1) {
      const L = lines[i];
      const lpoChildId = await lpoRepo.nextLpoChildId(client, companyId);
      await lpoRepo.insertLpoChild(client, {
        companyId,
        branchId,
        lpoChildId,
        lpoMasterId,
        productId: L.productId,
        qty: L.qty,
        unitPrice: L.unitPrice,
        itemDiscount: L.itemDiscount,
        subtotalAmount: L.subtotalAmount,
        lineTotal: L.lineTotal,
        uom: L.uom,
        barcode: L.barcode,
        description: L.description,
        focQty: L.focQty,
        packQty: L.packQty,
        ownRefNo: L.ownRefNo,
        baseCost: L.baseCost,
        discPercent: L.discPercent,
        vatPercent: L.vatPercent,
        vatAmount: L.vatAmount,
      });
    }

    const full = await lpoRepo.getLpoWithLines(client, companyId, lpoMasterId);
    return {
      lpo: mapMasterToApi(full.master),
      lines: (full.children || []).map(mapChildToApi),
    };
  });
}
