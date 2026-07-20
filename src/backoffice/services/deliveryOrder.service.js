import { withTransaction } from '../../config/db.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as deliveryOrderRepo from '../repositories/deliveryOrder.repository.js';
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

function parseOptionalQuotationId(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function mapMasterToApi(row) {
  if (!row) return null;
  return {
    deliveryOrderId: Number(row.delivery_order_id),
    branchId: Number(row.branch_id),
    deliveryOrderNo: row.delivery_order_no,
    deliveryOrderDate: row.delivery_order_date,
    quotationNo: row.quotation_no,
    quotationId: row.quotation_id != null ? Number(row.quotation_id) : null,
    customerLpoNo: row.customer_lpo_no,
    customerId: row.customer_id != null ? Number(row.customer_id) : null,
    customerName: row.customer_name,
    salesmanId: row.salesman_id != null ? Number(row.salesman_id) : null,
    counterNo: row.counter_no != null ? String(row.counter_no) : null,
    discount: row.discount != null ? String(row.discount) : '0',
    subTotal: row.sub_total != null ? String(row.sub_total) : '0',
    taxableAmount: row.taxable_amount != null ? String(row.taxable_amount) : '0',
    tax1Amount: row.tax_1_amount != null ? String(row.tax_1_amount) : '0',
    tax1Rate: row.tax_1_rate != null ? String(row.tax_1_rate) : '0',
    totalAmount: row.total_amount != null ? String(row.total_amount) : '0',
    roundOffAdjustment: row.round_off_adjustment != null ? String(row.round_off_adjustment) : '0',
    remarks: row.remarks,
    deliveryBy: row.delivery_by,
    postStatus: row.post_status,
    recordStatus: row.record_status,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
  };
}

function mapChildToApi(row) {
  return {
    deliveryOrderChildId: Number(row.delivery_order_child_id),
    productId: Number(row.product_id),
    serialNo: row.serial_no,
    barcode: row.barcode,
    shortDescription: row.short_description,
    packetDetails: row.packet_details,
    unitName: row.unit_name,
    qty: row.qty != null ? String(row.qty) : '0',
    unitPrice: row.unit_price != null ? String(row.unit_price) : '0',
    itemDiscount: row.item_discount != null ? String(row.item_discount) : '0',
    subtotalAmount: row.subtotal_amount != null ? String(row.subtotal_amount) : '0',
    lineTotal: row.line_total != null ? String(row.line_total) : '0',
    tax1Amount: row.tax_1_amount != null ? String(row.tax_1_amount) : '0',
    tax1Rate: row.tax_1_rate != null ? String(row.tax_1_rate) : '0',
    quotationId: row.quotation_id != null ? Number(row.quotation_id) : null,
  };
}

async function prepareDeliveryOrderDocument(pool, body, authStaff) {
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

  const deliveryOrderDate = parseDateOrNow(body.deliveryOrderDate);
  const headerDiscount = parseMoney(body.discountAmount ?? body.discount, 0);
  const roundOff = parseMoney(body.roundOff, 0);
  const remarks = sliceOrNull(body.remarks, 500);
  const customerLpoNo = sliceOrNull(body.customerLpoNo ?? body.customerLpo, 50);
  const deliveryBy = sliceOrNull(body.deliveryBy, 100);
  const quotationNoText = sliceOrNull(body.quotationNo, 50);
  let quotationIdOpt = parseOptionalQuotationId(body.quotationId);
  const salesmanIdOpt =
    body.salesmanId != null && body.salesmanId !== ''
      ? (() => {
          const n = Number(body.salesmanId);
          return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
        })()
      : null;
  const counterStr = body.counterNo != null ? String(body.counterNo).trim() : '';
  const counterNo =
    counterStr !== '' && Number.isFinite(Number(counterStr)) ? Number(counterStr) : null;

  const customerIdOpt = parseOptionalCustomerId(body.customerId);
  if (customerIdOpt == null) {
    const err = new Error('Customer is required');
    err.status = 400;
    throw err;
  }
  let customerName = sliceOrNull(body.customerName, 200);

  const cust = await quotationRepo.findCustomerForQuotation(pool, companyId, customerIdOpt);
  if (!cust) {
    const err = new Error('Customer not found');
    err.status = 400;
    throw err;
  }
  if (!customerName) customerName = sliceOrNull(cust.customer_name, 200) || null;

  let resolvedQuotationNo = quotationNoText;
  if (quotationIdOpt != null) {
    const qh = await deliveryOrderRepo.getQuotationHeaderForLink(pool, companyId, quotationIdOpt);
    if (!qh) {
      const err = new Error('Quotation not found');
      err.status = 400;
      throw err;
    }
    if (!resolvedQuotationNo) resolvedQuotationNo = sliceOrNull(qh.quotation_no, 50);
  } else {
    quotationIdOpt = null;
  }

  const staffPk = actorStaffPk(authStaff);
  if (staffPk == null) {
    const err = new Error('Invalid staff on session');
    err.status = 400;
    throw err;
  }

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
    const tax1Rate = parseMoney(L.taxPercent ?? L.tax1Rate ?? L.tax_1_rate, 0);
    const sub = Math.round((qty * unitPrice - itemDiscount) * 100) / 100;
    if (sub < 0) {
      const err = new Error(`Line ${i + 1}: invalid amounts`);
      err.status = 400;
      throw err;
    }
    const tax1Amount = Math.round(sub * (tax1Rate / 100) * 100) / 100;
    const lineTotal = Math.round((sub + tax1Amount) * 100) / 100;
    const lineQid = parseOptionalQuotationId(L.quotationId);
    if (lineQid != null && lineQid !== quotationIdOpt) {
      const qrow = await deliveryOrderRepo.getQuotationHeaderForLink(pool, companyId, lineQid);
      if (!qrow) {
        const err = new Error(`Line ${i + 1}: quotation not found`);
        err.status = 400;
        throw err;
      }
    }
    const shortDesc =
      sliceOrNull(L.shortDescription ?? L.description, 500) ||
      sliceOrNull(prow.short_name || prow.product_name, 500) ||
      '';
    normalizedLines.push({
      productId,
      serialNo: sliceOrNull(L.serialNo ?? L.ownRefNo ?? L.locationCode, 100),
      barcode: sliceOrNull(L.barcode ?? prow.barcode, 100),
      shortDescription: shortDesc,
      packetDetails: sliceOrNull(L.packetDetails ?? L.packet_details, 200),
      unitName: sliceOrNull(L.unitName ?? L.unit_name ?? prow.unit_name, 50),
      groupId:
        L.groupId != null && L.groupId !== ''
          ? (() => {
              const g = Number(L.groupId);
              return Number.isFinite(g) && g >= 1 ? Math.floor(g) : null;
            })()
          : null,
      qty,
      unitPrice,
      itemDiscount,
      tax1Rate,
      tax1Amount,
      subtotalAmount: sub,
      lineTotal,
      lineQuotationId: lineQid ?? quotationIdOpt,
    });
  }

  const linesSubtotal = normalizedLines.reduce((s, L) => s + L.subtotalAmount, 0);
  const linesTax = normalizedLines.reduce((s, L) => s + L.tax1Amount, 0);
  const subRounded = Math.round(linesSubtotal * 100) / 100;
  const taxRounded = Math.round(linesTax * 100) / 100;
  const disc = Math.min(Math.max(headerDiscount, 0), subRounded);
  const taxableAfterDisc = Math.round((subRounded - disc) * 100) / 100;
  const effTaxRate =
    subRounded > 0.0001 ? Math.round((taxRounded / subRounded) * 10000) / 100 : 0;
  const headerTax =
    subRounded > 0.0001
      ? Math.round(taxableAfterDisc * (taxRounded / subRounded) * 100) / 100
      : 0;
  const net = Math.round((taxableAfterDisc + headerTax + roundOff) * 100) / 100;

  return {
    companyId,
    branchId,
    deliveryOrderDate,
    headerDiscount: disc,
    roundOff,
    remarks,
    customerLpoNo,
    deliveryBy,
    quotationIdOpt,
    resolvedQuotationNo,
    salesmanIdOpt,
    counterNo,
    customerIdOpt,
    customerName,
    staffPk,
    normalizedLines,
    subRounded,
    taxableAfterDisc,
    headerTax,
    effTaxRate,
    net,
  };
}

async function insertChildren(client, prep, deliveryOrderId) {
  const lineResults = [];
  for (const L of prep.normalizedLines) {
    const deliveryOrderChildId = await deliveryOrderRepo.nextDeliveryOrderChildId(client, prep.companyId);
    await deliveryOrderRepo.insertDeliveryOrderChild(client, {
      companyId: prep.companyId,
      branchId: prep.branchId,
      deliveryOrderChildId,
      deliveryOrderId,
      productId: L.productId,
      serialNo: L.serialNo,
      barcode: L.barcode,
      shortDescription: L.shortDescription,
      packetDetails: L.packetDetails,
      unitName: L.unitName,
      groupId: L.groupId,
      qty: L.qty,
      unitPrice: L.unitPrice,
      itemDiscount: L.itemDiscount,
      tax1Amount: L.tax1Amount,
      tax2Amount: 0,
      tax3Amount: 0,
      tax1Rate: L.tax1Rate,
      tax2Rate: 0,
      tax3Rate: 0,
      subtotalAmount: L.subtotalAmount,
      lineTotal: L.lineTotal,
      quotationId: L.lineQuotationId,
      recordStatus: 'ACTIVE',
      postStatus: 'UNPOSTED',
      createdBy: prep.staffPk,
      modifiedBy: prep.staffPk,
    });
    lineResults.push({
      deliveryOrderChildId,
      productId: L.productId,
      barcode: L.barcode,
      shortDescription: L.shortDescription,
      unitName: L.unitName,
      qty: L.qty,
      unitPrice: L.unitPrice,
      itemDiscount: L.itemDiscount,
      tax1Amount: L.tax1Amount,
      tax1Rate: L.tax1Rate,
      subtotalAmount: L.subtotalAmount,
      lineTotal: L.lineTotal,
      quotationId: L.lineQuotationId,
    });
  }
  return lineResults;
}

/**
 * Creates a delivery order. Number from core.document_sequence (sequence_code `DELIVERY`).
 */
export async function createDeliveryOrder(pool, body, authStaff) {
  const prep = await prepareDeliveryOrderDocument(pool, body, authStaff);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.delivery_order_id:${prep.companyId}`,
    ]);
    const deliveryOrderId = await deliveryOrderRepo.nextDeliveryOrderId(client, prep.companyId);

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.delivery_order_child_id:${prep.companyId}`,
    ]);

    const deliveryOrderNo = await nextDocNo(client, {
      companyId: prep.companyId,
      branchId: prep.branchId,
      sequenceCode: 'DELIVERY',
      fiscalYear: new Date().getFullYear(),
    });
    const noMatch = String(deliveryOrderNo).match(/^(.*?)(\d+)$/);
    const docPrefix = noMatch ? noMatch[1] : 'DO-';
    const seqNum = noMatch ? Number(noMatch[2]) : 0;

    await deliveryOrderRepo.insertDeliveryOrderMaster(client, {
      companyId: prep.companyId,
      deliveryOrderId,
      branchId: prep.branchId,
      deliveryOrderNo,
      deliveryOrderDate: prep.deliveryOrderDate,
      quotationNo: prep.resolvedQuotationNo,
      quotationId: prep.quotationIdOpt,
      customerLpoNo: prep.customerLpoNo,
      customerId: prep.customerIdOpt,
      customerName: prep.customerName,
      salesmanId: prep.salesmanIdOpt,
      counterNo: prep.counterNo,
      discount: prep.headerDiscount,
      subTotal: prep.subRounded,
      taxableAmount: prep.taxableAfterDisc,
      tax1Amount: prep.headerTax,
      tax2Amount: 0,
      tax3Amount: 0,
      tax1Rate: prep.effTaxRate,
      tax2Rate: 0,
      tax3Rate: 0,
      roundOffAdjustment: prep.roundOff,
      totalAmount: prep.net,
      postStatus: 'UNPOSTED',
      remarks: prep.remarks,
      printCount: 0,
      deliveryBy: prep.deliveryBy,
      receivedBy: null,
      recordStatus: 'ACTIVE',
      prefix: docPrefix,
      deliveryOrderNoNumeric: seqNum,
      createdBy: prep.staffPk,
      modifiedBy: prep.staffPk,
      createdByStaffId: prep.staffPk,
    });

    const lineResults = await insertChildren(client, prep, deliveryOrderId);

    return {
      deliveryOrder: {
        deliveryOrderId,
        branchId: prep.branchId,
        deliveryOrderNo,
        deliveryOrderDate: prep.deliveryOrderDate.toISOString(),
        quotationNo: prep.resolvedQuotationNo,
        quotationId: prep.quotationIdOpt,
        customerLpoNo: prep.customerLpoNo,
        customerId: prep.customerIdOpt,
        customerName: prep.customerName,
        salesmanId: prep.salesmanIdOpt,
        counterNo: prep.counterNo != null ? String(prep.counterNo) : null,
        totalAmount: String(prep.net),
        discount: String(prep.headerDiscount),
        subTotal: String(prep.subRounded),
        taxableAmount: String(prep.taxableAfterDisc),
        tax1Amount: String(prep.headerTax),
        tax1Rate: String(prep.effTaxRate),
        roundOff: String(prep.roundOff),
        roundOffAdjustment: String(prep.roundOff),
        remarks: prep.remarks,
        deliveryBy: prep.deliveryBy,
        postStatus: 'UNPOSTED',
      },
      lines: lineResults,
    };
  });
}

/**
 * Updates an unposted delivery order (header + replace all lines).
 */
export async function updateDeliveryOrder(pool, deliveryOrderIdRaw, body, authStaff) {
  const deliveryOrderId = Number(deliveryOrderIdRaw);
  if (!Number.isFinite(deliveryOrderId) || deliveryOrderId < 1) {
    const err = new Error('Invalid delivery order id');
    err.status = 400;
    throw err;
  }

  const prep = await prepareDeliveryOrderDocument(pool, body, authStaff);
  const existing = await deliveryOrderRepo.getDeliveryOrderByBusinessId(
    pool,
    prep.companyId,
    deliveryOrderId,
  );
  if (!existing) {
    const err = new Error('Delivery order not found');
    err.status = 404;
    throw err;
  }
  const postStatus = String(existing.master.post_status || 'UNPOSTED').toUpperCase();
  if (postStatus === 'POSTED') {
    const err = new Error('Posted delivery order cannot be updated');
    err.status = 409;
    throw err;
  }
  if (Number(existing.master.branch_id) !== Number(prep.branchId)) {
    const err = new Error('Branch cannot be changed on update');
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.delivery_order_child_id:${prep.companyId}`,
    ]);

    const updated = await deliveryOrderRepo.updateDeliveryOrderMaster(client, {
      companyId: prep.companyId,
      deliveryOrderId,
      deliveryOrderDate: prep.deliveryOrderDate,
      quotationNo: prep.resolvedQuotationNo,
      quotationId: prep.quotationIdOpt,
      customerLpoNo: prep.customerLpoNo,
      customerId: prep.customerIdOpt,
      customerName: prep.customerName,
      salesmanId: prep.salesmanIdOpt,
      counterNo: prep.counterNo,
      discount: prep.headerDiscount,
      subTotal: prep.subRounded,
      taxableAmount: prep.taxableAfterDisc,
      tax1Amount: prep.headerTax,
      tax2Amount: 0,
      tax3Amount: 0,
      tax1Rate: prep.effTaxRate,
      tax2Rate: 0,
      tax3Rate: 0,
      roundOffAdjustment: prep.roundOff,
      totalAmount: prep.net,
      remarks: prep.remarks,
      deliveryBy: prep.deliveryBy,
      modifiedBy: prep.staffPk,
    });
    if (!updated) {
      const err = new Error('Delivery order could not be updated (posted or missing)');
      err.status = 409;
      throw err;
    }

    await deliveryOrderRepo.deleteDeliveryOrderChildren(client, prep.companyId, deliveryOrderId);
    const lineResults = await insertChildren(client, prep, deliveryOrderId);

    return {
      deliveryOrder: {
        deliveryOrderId,
        branchId: prep.branchId,
        deliveryOrderNo: existing.master.delivery_order_no,
        deliveryOrderDate: prep.deliveryOrderDate.toISOString(),
        quotationNo: prep.resolvedQuotationNo,
        quotationId: prep.quotationIdOpt,
        customerLpoNo: prep.customerLpoNo,
        customerId: prep.customerIdOpt,
        customerName: prep.customerName,
        salesmanId: prep.salesmanIdOpt,
        counterNo: prep.counterNo != null ? String(prep.counterNo) : null,
        totalAmount: String(prep.net),
        discount: String(prep.headerDiscount),
        subTotal: String(prep.subRounded),
        taxableAmount: String(prep.taxableAfterDisc),
        tax1Amount: String(prep.headerTax),
        tax1Rate: String(prep.effTaxRate),
        roundOff: String(prep.roundOff),
        roundOffAdjustment: String(prep.roundOff),
        remarks: prep.remarks,
        deliveryBy: prep.deliveryBy,
        postStatus: existing.master.post_status || 'UNPOSTED',
      },
      lines: lineResults,
    };
  });
}

export async function getDeliveryOrder(pool, authStaff, deliveryOrderId) {
  const companyId = Number(authStaff.company_id);
  const did = Number(deliveryOrderId);
  if (!Number.isFinite(did) || did < 1) {
    const err = new Error('Invalid delivery order id');
    err.status = 400;
    throw err;
  }
  const full = await deliveryOrderRepo.getDeliveryOrderByBusinessId(pool, companyId, did);
  if (!full) {
    const err = new Error('Delivery order not found');
    err.status = 404;
    throw err;
  }
  return {
    deliveryOrder: mapMasterToApi(full.master),
    lines: (full.children || []).map(mapChildToApi),
  };
}

export async function listDeliveryOrders(pool, authStaff, query) {
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
  const rows = await deliveryOrderRepo.listDeliveryOrders(
    pool,
    companyId,
    branchId,
    query.limit,
    query.offset,
    { excludeInvoiced: query.excludeInvoiced === 'true' || query.excludeInvoiced === true },
  );
  return rows.map((row) => ({
    deliveryOrderId: Number(row.delivery_order_id),
    branchId: Number(row.branch_id),
    deliveryOrderNo: row.delivery_order_no,
    deliveryOrderDate: row.delivery_order_date,
    customerId: row.customer_id != null ? Number(row.customer_id) : null,
    customerName: row.customer_name,
    totalAmount: row.total_amount != null ? String(row.total_amount) : '0',
    postStatus: row.post_status,
    recordStatus: row.record_status,
    discount: row.discount != null ? String(row.discount) : '0',
    roundOffAdjustment: row.round_off_adjustment != null ? String(row.round_off_adjustment) : '0',
    quotationNo: row.quotation_no,
    invoiceStatus: row.invoice_status || null,
  }));
}
