import { withTransaction } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as quotationRepo from '../repositories/quotation.repository.js';
import { actorStaffPk } from '../../utils/actorStaff.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

function trimOrEmpty(v) {
  if (v == null) return '';
  return String(v).trim();
}

function sliceOrNull(v, maxLen) {
  const s = trimOrEmpty(v);
  if (!s) return null;
  return s.slice(0, maxLen);
}

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function parseMoney(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 100) / 100;
}

function parseQty(v, fallback = 1) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 10000) / 10000;
}

function parseOptionalCustomerId(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function parseDateOrNow(s) {
  const t = trimOrEmpty(s);
  if (!t) return new Date();
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

function parseOptionalDate(s) {
  const t = trimOrEmpty(s);
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function mapMasterToApi(row) {
  if (!row) return null;
  return {
    quotationId: Number(row.quotation_id),
    branchId: Number(row.branch_id),
    quotationNo: row.quotation_no,
    quotationDate: row.quotation_date,
    customerRefNo: row.customer_ref_no,
    customerRefDate: row.customer_ref_date,
    staffId: row.staff_id != null ? Number(row.staff_id) : null,
    quotationStatus: row.quotation_status,
    customerId: row.customer_id != null ? Number(row.customer_id) : null,
    customerName: row.customer_name,
    customerAddress: row.customer_address,
    contactPerson: row.contact_person,
    quotationAmount: row.quotation_amount != null ? String(row.quotation_amount) : '0',
    discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
    quotationTerms: row.quotation_terms,
    remarks: row.remarks,
    recordStatus: row.record_status,
    postStatus: row.post_status,
    subtotalAmount: row.subtotal_amount != null ? String(row.subtotal_amount) : '0',
    taxableAmount: row.taxable_amount != null ? String(row.taxable_amount) : '0',
    roundOffAdjustment: row.round_off_adjustment != null ? String(row.round_off_adjustment) : '0',
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
  };
}

function mapChildToApi(row) {
  return {
    quotationChildId: Number(row.quotation_child_id),
    productId: Number(row.product_id),
    barcode: row.barcode,
    productDescription: row.product_description,
    unitName: row.unit_name,
    qty: row.qty != null ? String(row.qty) : '0',
    unitPrice: row.unit_price != null ? String(row.unit_price) : '0',
    itemDiscount: row.item_discount != null ? String(row.item_discount) : '0',
    locationCode: row.location_code,
    subtotalAmount: row.subtotal_amount != null ? String(row.subtotal_amount) : '0',
    lineTotal: row.line_total != null ? String(row.line_total) : '0',
    tax1Amount: row.tax_1_amount != null ? String(row.tax_1_amount) : '0',
    tax1Rate: row.tax_1_rate != null ? String(row.tax_1_rate) : '0',
    originName: row.origin_name,
    stockStatus: row.stock_status,
  };
}

/**
 * Creates a quotation. Document number comes from core.document_sequence (sequence_code `quotation`, per company + branch).
 * Tax fields are stored as zero until tax is implemented.
 */
export async function createQuotation(pool, body, authStaff) {
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

  const linesIn = Array.isArray(body.lines) ? body.lines : [];
  if (linesIn.length === 0) {
    const err = new Error('At least one line item is required');
    err.status = 400;
    throw err;
  }

  const quotationDate = parseDateOrNow(body.quotationDate);
  const customerRefNo = sliceOrNull(body.customerRefNo, 50);
  const customerRefDate = parseOptionalDate(body.customerRefDate);
  const headerDiscount = parseMoney(body.discountAmount, 0);
  const roundOff = parseMoney(body.roundOff, 0);
  const quotationTerms = sliceOrNull(body.quotationTerms, 2000);
  const remarks = sliceOrNull(body.remarks, 500);

  const customerIdOpt = parseOptionalCustomerId(body.customerId);
  let customerName = sliceOrNull(body.customerName, 100);
  let customerAddress = sliceOrNull(body.customerAddress, 250);
  let contactPerson = sliceOrNull(body.contactPerson, 100);

  if (customerIdOpt != null) {
    const cust = await quotationRepo.findCustomerForQuotation(pool, companyId, customerIdOpt);
    if (!cust) {
      const err = new Error('Customer not found');
      err.status = 400;
      throw err;
    }
    if (!customerName) customerName = sliceOrNull(cust.customer_name, 100) || null;
    if (!customerAddress) customerAddress = sliceOrNull(cust.address, 250) || null;
    if (!contactPerson) contactPerson = sliceOrNull(cust.contact_person, 100) || null;
  }

  const staffBusinessId =
    authStaff.staff_id != null ? Number(authStaff.staff_id) : null;
  const userLabel = trimOrEmpty(authStaff.staff_name).slice(0, 50) || 'system';
  const staffPk = actorStaffPk(authStaff);

  const normalizedLines = [];
  for (let i = 0; i < linesIn.length; i++) {
    const L = linesIn[i] || {};
    const productId = Number(L.productId);
    if (!Number.isFinite(productId) || productId < 1) {
      const err = new Error(`Line ${i + 1}: productId is required`);
      err.status = 400;
      throw err;
    }
    const prow = await quotationRepo.findProductLineForQuotation(pool, companyId, branchId, productId);
    if (!prow) {
      const err = new Error(`Line ${i + 1}: product not found for this branch`);
      err.status = 400;
      throw err;
    }
    const qty = parseQty(L.qty, 1);
    const unitPrice = parseMoney(L.unitPrice, 0);
    const itemDiscount = parseMoney(L.itemDiscount ?? L.item_discount, 0);
    const sub = Math.round((qty * unitPrice - itemDiscount) * 100) / 100;
    if (sub < 0) {
      const err = new Error(`Line ${i + 1}: invalid amounts`);
      err.status = 400;
      throw err;
    }
    const lineTotal = sub;
    const desc =
      sliceOrNull(L.description ?? L.productDescription, 1000) ||
      sliceOrNull(prow.short_name || prow.product_name, 1000) ||
      '';
    normalizedLines.push({
      productId,
      barcode: sliceOrNull(L.barcode ?? prow.barcode, 100),
      productDescription: desc,
      unitName: sliceOrNull(L.unitName ?? L.unit_name ?? prow.unit_name, 50),
      qty,
      unitPrice,
      itemDiscount,
      locationCode: sliceOrNull(L.locationCode ?? L.location_code ?? prow.location_code, 50),
      originName: sliceOrNull(L.originName ?? L.origin_name, 20),
      stockStatus: sliceOrNull(L.stockStatus ?? L.stock_status, 20),
      subtotalAmount: sub,
      lineTotal,
    });
  }

  const linesSubtotal = normalizedLines.reduce((s, L) => s + L.subtotalAmount, 0);
  const subRounded = Math.round(linesSubtotal * 100) / 100;
  const disc = Math.min(Math.max(headerDiscount, 0), subRounded);
  const net =
    Math.round((subRounded - disc + roundOff) * 100) / 100;

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.quotation_id:${companyId}`,
    ]);
    const quotationId = await quotationRepo.nextQuotationId(client, companyId);

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.quotation_child_id:${companyId}`,
    ]);

    const quotationNo = await nextDocNo(client, {
      companyId,
      branchId,
      sequenceCode: 'QUOTATION',
      fiscalYear: new Date().getFullYear(),
    });

    await quotationRepo.insertQuotationMaster(client, {
      companyId,
      quotationId,
      branchId,
      quotationNo,
      quotationDate,
      customerRefNo,
      customerRefDate,
      staffId: Number.isFinite(staffBusinessId) && staffBusinessId >= 1 ? staffBusinessId : null,
      quotationStatus: 'DRAFT',
      customerId: customerIdOpt,
      customerName,
      customerAddress,
      contactPerson,
      quotationAmount: net,
      discountAmount: disc,
      quotationTerms,
      remarks,
      recordStatus: 'ACTIVE',
      postStatus: 'UNPOSTED',
      prefix: docPrefix,
      quotationNoNumeric: seqNum,
      subtotalAmount: subRounded,
      taxableAmount: 0,
      tax1Amount: 0,
      tax2Amount: 0,
      tax3Amount: 0,
      tax1Rate: 0,
      tax2Rate: 0,
      tax3Rate: 0,
      roundOffAdjustment: roundOff,
      createdBy: userLabel,
      modifiedBy: userLabel,
      createdByStaffId: staffPk,
    });

    const lineResults = [];
    for (const L of normalizedLines) {
      const quotationChildId = await quotationRepo.nextQuotationChildId(client, companyId);
      await quotationRepo.insertQuotationChild(client, {
        companyId,
        quotationChildId,
        quotationId,
        productId: L.productId,
        barcode: L.barcode,
        productDescription: L.productDescription,
        unitName: L.unitName,
        qty: L.qty,
        unitPrice: L.unitPrice,
        itemDiscount: L.itemDiscount,
        locationCode: L.locationCode,
        recordStatus: 'ACTIVE',
        postStatus: 'UNPOSTED',
        tax1Amount: 0,
        tax2Amount: 0,
        tax3Amount: 0,
        tax1Rate: 0,
        tax2Rate: 0,
        tax3Rate: 0,
        subtotalAmount: L.subtotalAmount,
        lineTotal: L.lineTotal,
        originName: L.originName,
        stockStatus: L.stockStatus,
        createdBy: userLabel,
        modifiedBy: userLabel,
      });
      lineResults.push({
        quotationChildId,
        productId: L.productId,
        barcode: L.barcode,
        productDescription: L.productDescription,
        unitName: L.unitName,
        qty: L.qty,
        unitPrice: L.unitPrice,
        itemDiscount: L.itemDiscount,
        locationCode: L.locationCode,
        subtotalAmount: L.subtotalAmount,
        lineTotal: L.lineTotal,
        originName: L.originName,
        stockStatus: L.stockStatus,
      });
    }

    return {
      quotation: {
        quotationId,
        branchId,
        quotationNo,
        quotationDate: quotationDate.toISOString(),
        customerRefNo,
        customerRefDate: customerRefDate ? customerRefDate.toISOString() : null,
        staffId: Number.isFinite(staffBusinessId) && staffBusinessId >= 1 ? staffBusinessId : null,
        quotationStatus: 'DRAFT',
        customerId: customerIdOpt,
        customerName,
        customerAddress,
        contactPerson,
        quotationAmount: String(net),
        discountAmount: String(disc),
        quotationTerms,
        remarks,
        recordStatus: 'ACTIVE',
        postStatus: 'UNPOSTED',
        subtotalAmount: String(subRounded),
        taxableAmount: '0',
        roundOffAdjustment: String(roundOff),
      },
      lines: lineResults.map((r) => ({
        quotationChildId: r.quotationChildId,
        productId: r.productId,
        barcode: r.barcode,
        productDescription: r.productDescription,
        unitName: r.unitName,
        qty: String(r.qty),
        unitPrice: String(r.unitPrice),
        itemDiscount: String(r.itemDiscount),
        locationCode: r.locationCode,
        subtotalAmount: String(r.subtotalAmount),
        lineTotal: String(r.lineTotal),
        originName: r.originName,
        stockStatus: r.stockStatus,
      })),
    };
  });
}

export async function getQuotation(pool, authStaff, quotationId) {
  const companyId = Number(authStaff.company_id);
  const qid = Number(quotationId);
  if (!Number.isFinite(qid) || qid < 1) {
    const err = new Error('Invalid quotation id');
    err.status = 400;
    throw err;
  }
  const full = await quotationRepo.getQuotationByBusinessId(pool, companyId, qid);
  if (!full) {
    const err = new Error('Quotation not found');
    err.status = 404;
    throw err;
  }
  return {
    quotation: mapMasterToApi(full.master),
    lines: (full.children || []).map(mapChildToApi),
  };
}

export async function listQuotations(pool, authStaff, query) {
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
  const rows = await quotationRepo.listQuotations(
    pool,
    companyId,
    branchId,
    query.limit,
    query.offset,
    { excludeInvoiced: query.excludeInvoiced === 'true' || query.excludeInvoiced === true },
  );
  return rows.map((row) => ({
    quotationId: Number(row.quotation_id),
    branchId: Number(row.branch_id),
    quotationNo: row.quotation_no,
    quotationDate: row.quotation_date,
    customerRefNo: row.customer_ref_no,
    customerRefDate: row.customer_ref_date,
    customerId: row.customer_id != null ? Number(row.customer_id) : null,
    customerName: row.customer_name,
    quotationAmount: row.quotation_amount != null ? String(row.quotation_amount) : '0',
    quotationStatus: row.quotation_status,
    recordStatus: row.record_status,
    discountAmount: row.discount_amount != null ? String(row.discount_amount) : '0',
    roundOffAdjustment: row.round_off_adjustment != null ? String(row.round_off_adjustment) : '0',
  }));
}
