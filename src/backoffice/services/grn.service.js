import { withTransaction } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as grnRepo from '../repositories/grn.repository.js';
import * as supplierRepo from '../repositories/supplier.repository.js';
import { actorStaffPk } from '../../utils/actorStaff.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

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
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}

function nullablePosInt(v) {
  const n = Math.trunc(num(v, 0));
  return n > 0 ? n : 0;
}

function mapMasterToApi(row) {
  if (!row) return null;
  return {
    grnId: Number(row.grn_id),
    branchId: Number(row.branch_id),
    grnNo: row.grn_no ?? '',
    grnDate: row.grn_date,
    supplierId: row.supplier_id != null ? Number(row.supplier_id) : 0,
    lpoMasterId: row.lpo_master_id != null ? Number(row.lpo_master_id) : 0,
    supplierRefNo: row.supplier_ref_no ?? '',
    supplierDocNo: row.supplier_ref_no ?? '',
    invoiceAmount: row.invoice_amount != null ? String(row.invoice_amount) : '0',
    postStatus: row.post_status ?? '',
    discountType: row.discount_type ?? '',
    discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
    roundOffAdjustment: row.round_off_adjustment != null ? String(row.round_off_adjustment) : '0',
    transactionType: row.transaction_type ?? '',
    stationId: row.station_id != null ? Number(row.station_id) : 0,
    remarks: row.remarks ?? '',
    staffId: row.staff_id != null ? Number(row.staff_id) : 0,
    purchaseId: row.purchase_id != null ? Number(row.purchase_id) : 0,
    purchaseNo: row.purchase_no != null ? String(row.purchase_no) : '',
    purchaseStatus: row.purchase_status ?? '',
    recordStatus: row.r_status_m ?? '',
    uploadStatus: row.upload_status_m ?? '',
  };
}

function mapChildToApi(row) {
  return {
    grnChildId: Number(row.grn_child_id),
    productId: Number(row.product_id),
    barcode: row.barcode ?? '',
    shortDescription: row.short_description ?? row.description ?? '',
    unitName: row.unit ?? row.unit_name ?? '',
    uom: row.unit ?? row.unit_name ?? '',
    qty: row.qty != null ? String(row.qty) : '0',
    unitCost: row.unit_cost != null ? String(row.unit_cost) : '0',
    discountPercentage: row.discount_percentage != null ? String(row.discount_percentage) : '0',
    discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
    subtotalAmount: row.amount != null ? String(row.amount) : '0',
    lineTotal: row.amount != null ? String(row.amount) : '0',
    focQty: row.foc_qty != null ? String(row.foc_qty) : '0',
    focAmount: row.foc_amount != null ? String(row.foc_amount) : '0',
    packQty: row.pack_qty != null ? String(row.pack_qty) : '1',
    lastPurchaseCost: row.last_purchase_cost != null ? String(row.last_purchase_cost) : '0',
    lpoChildId: row.lpo_child_id != null ? Number(row.lpo_child_id) : 0,
  };
}

function resolveCompanyBranch(authStaff, bodyOrQuery) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }
  let branchId = parseBranchId(bodyOrQuery?.branchId);
  if (branchId == null) branchId = parseBranchId(authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  return { companyId, branchId };
}

async function productExistsInCompany(client, companyId, productId) {
  const { rows } = await client.query(
    `SELECT 1
     FROM core.product_master
     WHERE company_id = $1 AND product_id = $2
       AND (record_status IS NULL OR record_status = 'ACTIVE')
     LIMIT 1`,
    [companyId, productId],
  );
  return rows.length > 0;
}

function normalizeGrnLines(bodyLines) {
  const raw = Array.isArray(bodyLines) ? bodyLines : [];
  const lines = [];
  let sumAmount = 0;

  for (let i = 0; i < raw.length; i += 1) {
    const L = raw[i] || {};
    const productId = Math.trunc(num(L.productId ?? L.product_id, 0));
    if (productId < 1) {
      const err = new Error(`Line ${i + 1}: productId is required`);
      err.status = 400;
      throw err;
    }

    const qty = round2(num(L.qty, 0));
    if (qty <= 0) {
      const err = new Error(`Line ${i + 1}: qty must be > 0`);
      err.status = 400;
      throw err;
    }

    const unitCost = round2(num(L.unitCost ?? L.baseCost ?? L.lastPurchaseCost, 0));
    if (unitCost <= 0) {
      const err = new Error(`Line ${i + 1}: unit cost is required`);
      err.status = 400;
      throw err;
    }

    const gross = round2(qty * unitCost);
    const discountPercentage = Math.max(0, round2(num(L.discPercent ?? L.discountPercentage, 0)));
    const discountAmount = round2(
      num(L.discountAmount, gross * (discountPercentage / 100)),
    );
    const fallbackAmount = Math.max(0, round2(gross - discountAmount));
    const amount = round2(num(L.lineTotal ?? L.total ?? L.subTotal ?? L.subtotalAmount, fallbackAmount));

    sumAmount += amount;
    lines.push({
      productId,
      uniqueProductId: nullablePosInt(L.uniqueProductId ?? L.unique_product_id),
      packQty: Math.max(0, num(L.packQty, 0)),
      qty,
      unitCost,
      lastPurchaseCost: round2(num(L.lastPurchaseCost, unitCost)),
      unit: str(L.uom ?? L.unit ?? L.unitName, 50) || 'PCS',
      focQty: Math.max(0, num(L.foc ?? L.focQty, 0)),
      focAmount: Math.max(0, round2(num(L.focAmount, 0))),
      discountPercentage,
      discountAmount,
      amount,
      lpoChildId: nullablePosInt(L.lpoChildId ?? L.lpo_child_id),
    });
  }

  return { lines, invoiceAmount: round2(sumAmount) };
}

function buildMasterPayload(body, ctx) {
  const { companyId, branchId, grnId, grnDate, invoiceAmount, authStaff } = ctx;
  const headerDiscount = round2(num(body.discountAmount ?? body.headerDiscount, 0));
  const expectedNet = Math.max(0, round2(invoiceAmount - headerDiscount));
  const clientNet = round2(num(body.netAmount ?? body.invoiceAmount, expectedNet));
  if (clientNet <= 0) {
    const err = new Error('netAmount must be > 0');
    err.status = 400;
    throw err;
  }

  const actor = str(authStaff.staff_name || authStaff.login_name || 'staff', 50) || 'staff';
  const staffId = actorStaffPk(authStaff) || nullablePosInt(authStaff.staff_id);
  const grnNo = str(body.grnNo ?? body.grn_no, 50) || String(grnId);

  return {
    grnId,
    companyId,
    branchId,
    supplierId: nullablePosInt(body.supplierId),
    grnDate,
    grnNo,
    lpoMasterId: nullablePosInt(body.lpoMasterId ?? body.lpo_master_id),
    supplierRefNo: str(body.supplierDocNo ?? body.supplierRefNo ?? body.supplier_ref_no, 50),
    invoiceAmount: clientNet,
    postStatus: str(body.postStatus, 50) || 'DRAFT',
    discountType: str(body.discountType ?? body.discount, 50) || 'None',
    discountAmount: headerDiscount,
    roundOffAdjustment: round2(num(body.roundOffAdjustment, 0)),
    transactionType: str(body.transactionType, 50) || 'GRN',
    stationId: nullablePosInt(body.stationId ?? branchId),
    remarks: str(body.remarks ?? body.grnTerms, 200),
    staffId,
    purchaseId: nullablePosInt(body.purchaseId),
    purchaseNo: nullablePosInt(body.purchaseNo),
    purchaseStatus: str(body.purchaseStatus, 50),
    createdBy: actor,
    modifiedBy: actor,
    recordStatus: 'ACTIVE',
    uploadStatus: 'PENDING',
  };
}

export async function listGrns(pool, authStaff, query) {
  const { companyId, branchId } = resolveCompanyBranch(authStaff, query);
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }
  const rows = await grnRepo.listGrnsByBranch(pool, companyId, branchId, query.limit);
  return rows.map(mapMasterToApi);
}

export async function getGrn(pool, authStaff, grnId) {
  const companyId = Number(authStaff.company_id);
  const gid = Number(grnId);
  if (!Number.isFinite(gid) || gid < 1) {
    const err = new Error('Invalid GRN id');
    err.status = 400;
    throw err;
  }
  const full = await grnRepo.getGrnWithLines(pool, companyId, gid);
  if (!full) {
    const err = new Error('GRN not found');
    err.status = 404;
    throw err;
  }
  return {
    grn: mapMasterToApi(full.master),
    lines: (full.children || []).map(mapChildToApi),
  };
}

export async function createGrn(pool, body, authStaff) {
  const { companyId, branchId } = resolveCompanyBranch(authStaff, body);
  const branchOk = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!branchOk) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  const supplierId = nullablePosInt(body.supplierId);
  if (supplierId < 1) {
    const err = new Error('supplierId is required');
    err.status = 400;
    throw err;
  }
  const supplierOk = await supplierRepo.supplierExists(pool, companyId, supplierId);
  if (!supplierOk) {
    const err = new Error('Supplier not found for this company');
    err.status = 400;
    throw err;
  }

  const { lines, invoiceAmount } = normalizeGrnLines(body.lines);
  if (!lines.length) {
    const err = new Error('At least one line is required');
    err.status = 400;
    throw err;
  }

  const grnDate = body.grnDate ? new Date(body.grnDate) : new Date();
  if (Number.isNaN(grnDate.getTime())) {
    const err = new Error('Invalid grnDate');
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

    const grnId = await grnRepo.nextGrnId(client, companyId);
    const autoGrnNo = await nextDocNo(client, {
      companyId,
      branchId,
      sequenceCode: 'GRN',
      fiscalYear: new Date().getFullYear(),
    });
    const masterRow = buildMasterPayload(body, {
      companyId,
      branchId,
      grnId,
      grnDate,
      invoiceAmount,
      authStaff,
    });
    masterRow.supplierId = supplierId;
    // Override grnNo with the sequence-generated value (body override still possible via buildMasterPayload).
    if (!masterRow.grnNo || masterRow.grnNo === String(grnId)) {
      masterRow.grnNo = autoGrnNo;
    }

    await grnRepo.insertGrnMaster(client, masterRow);

    for (let i = 0; i < lines.length; i += 1) {
      const L = lines[i];
      const grnChildId = await grnRepo.nextGrnChildId(client, companyId);
      await grnRepo.insertGrnChild(client, {
        ...L,
        grnChildId,
        grnId,
        companyId,
        branchId,
        stationId: masterRow.stationId,
        postStatus: masterRow.postStatus,
        createdBy: masterRow.createdBy,
        modifiedBy: masterRow.modifiedBy,
        uploadStatus: 'PENDING',
        recordStatus: 'ACTIVE',
      });
    }

    const full = await grnRepo.getGrnWithLines(client, companyId, grnId);
    return {
      grn: mapMasterToApi(full.master),
      lines: (full.children || []).map(mapChildToApi),
    };
  });
}
