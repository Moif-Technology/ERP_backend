/**
 * Salon POS settlement.
 *
 * Turns an open ops.salon_job_master into a bill: ops.sales_master +
 * ops.sales_child + ops.sales_payment_split, then marks the job SETTLED and
 * links the two together (migration 105).
 *
 * What this does that restaurant settlement does not:
 *   - every bill line carries stylist_id and line_type, so per-stylist
 *     commission is answerable from ops.sales_child alone;
 *   - a missing stylist on the request is filled in from the job line rather
 *     than written as NULL, because the job already knows who did the work;
 *   - the job row is locked FOR UPDATE for the whole transaction, so two tills
 *     cannot both pass the "not settled yet" check and produce two bills.
 *
 * The request body is the restaurant-shaped `orderData` the Flutter client
 * already builds (kotId, items[], subTotal, netAmount, paidAmount, …). Salon
 * keys are accepted alongside the legacy ones — `jobId` for `kotId`,
 * `stylistId` for `waiterId`, `chairId` for `tableId` — so the client can be
 * migrated key by key without a flag day.
 */
import { withTransaction } from '../../../config/db.js';
import * as salesRepo from '../repositories/sales.repository.js';
import { auditUserName } from '../../../shared/lib/auditUser.js';

const PAYMENT_TOLERANCE = 0.02;

function num(v, d = 0) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function parseLong(v) {
  const n = num(v, 0);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function str(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function conflict(message, code) {
  const err = new Error(message);
  err.status = 409;
  if (code) err.code = code;
  return err;
}

function itemsFromBody(body) {
  const raw = body.items ?? body.Items;
  return Array.isArray(raw) ? raw : [];
}

/** CASH unless the client explicitly said card. Mirrors restaurant's mapping. */
function normalisePaymentMode(v) {
  const s = String(v ?? 'CASH').trim().toUpperCase();
  return s.includes('CREDIT') || s.includes('CARD') ? 'CREDITCARD' : 'CASH';
}

function normaliseLineType(v) {
  return String(v ?? '').trim().toUpperCase() === 'SERVICE' ? 'SERVICE' : 'PRODUCT';
}

/**
 * Validate and normalise the money on the request.
 * Kept separate so the arithmetic rules are readable in one place.
 */
function readTotals(body) {
  const net = num(body.netAmount, 0);
  const paid = num(body.paidAmount, 0);

  if (net <= 0) throw badRequest('netAmount must be greater than 0', 'BAD_NET');
  if (paid + PAYMENT_TOLERANCE < net) {
    throw badRequest('paidAmount must be at least netAmount', 'UNDERPAID');
  }

  const subTotal = num(body.subTotal ?? body.subTotalM, 0);
  return {
    net,
    paid,
    subTotal,
    discountAmount: num(body.discountAmount, 0),
    taxableAmount: num(body.taxableAmount, subTotal),
    tax1: num(body.tax1Amount ?? body.tax1AmountM, 0),
    tax2: num(body.tax2AmountM ?? body.tax2Amount, 0),
    tax3: num(body.tax3AmountM ?? body.tax3Amount, 0),
    tax1Rate: num(body.tax1RateM ?? body.tax1Rate, 0),
    tax2Rate: num(body.tax2RateM ?? body.tax2Rate, 0),
    tax3Rate: num(body.tax3RateM ?? body.tax3Rate, 0),
    roundOffAdj: num(body.roundOffAdj, 0),
    balancePaid: Math.max(0, paid - net),
  };
}

/**
 * Resolve one request item against the job it came from.
 *
 * `jobLinesByLineId` / `jobLinesByProductId` come from ops.salon_job_child.
 * Preference order for the stylist and the line type is: what the client sent,
 * then the matching job line, then the job's primary stylist. A SERVICE line
 * that still has no stylist after all that is rejected rather than written —
 * ops.salon_job_child already refuses such a row (chk_salon_service_needs_
 * stylist), and letting the bill disagree with the job would silently lose the
 * commission record.
 */
function resolveLine(item, ctx) {
  const { jobLinesByLineId, jobLinesByProductId, primaryStylistId } = ctx;

  const productId = parseLong(item.productId ?? item.ProductID ?? item.product_id);
  if (productId == null) return null;

  const jobLineId = parseLong(item.lineId ?? item.LineID ?? item.kotChildID ?? item.kotChildId ?? item.KotChildID);
  const jobLine = (jobLineId != null ? jobLinesByLineId.get(jobLineId) : null)
    ?? jobLinesByProductId.get(productId)
    ?? null;

  const qty = num(item.qty ?? item.Qty, 0);
  if (qty <= 0) throw badRequest(`Invalid qty for product ${productId}`, 'BAD_QTY');

  const unitPrice = num(item.unitPrice ?? item.UnitPrice, 0);
  const discount = num(item.discount ?? item.Discount ?? item.itemDisc ?? item.ItemDisc, 0);
  const subTotal = num(item.subTotalC ?? item.SubTotalC ?? item.subTotal ?? item.SubTotal, 0)
    || (qty * unitPrice - discount);

  const tax1 = num(item.tax1AmountC ?? item.Tax1AmountC ?? item.tax1Amount, 0);
  const tax2 = num(item.tax2AmountC ?? item.Tax2AmountC, 0);
  const tax3 = num(item.tax3AmountC ?? item.Tax3AmountC, 0);

  const lineType = item.lineType ?? item.LineType
    ? normaliseLineType(item.lineType ?? item.LineType)
    : normaliseLineType(jobLine?.line_type);

  const stylistId = parseLong(item.stylistId ?? item.StylistID ?? item.stylistID)
    ?? (jobLine?.stylist_id != null ? Number(jobLine.stylist_id) : null)
    ?? primaryStylistId;

  if (lineType === 'SERVICE' && stylistId == null) {
    throw badRequest(
      `Service line for product ${productId} has no stylist. Assign a stylist before settling.`,
      'SERVICE_NEEDS_STYLIST'
    );
  }

  return {
    jobLineId: jobLine?.line_id != null ? Number(jobLine.line_id) : jobLineId,
    productId,
    shortDescription: str(item.shortDescription ?? item.ShortDescription ?? item.itemName ?? item.ItemName, 200) ?? 'Item',
    groupId: parseLong(item.groupId ?? item.GroupID ?? item.dgvGrpID),
    qty,
    unitPrice,
    unitCost: num(item.unitCost ?? item.UnitCost, 0),
    packQty: num(item.packQty ?? item.PackQty, 1) || 1,
    discountAmount: discount,
    subtotalAmount: subTotal,
    tax1Amount: tax1,
    tax2Amount: tax2,
    tax3Amount: tax3,
    tax1Rate: num(item.tax1RateC ?? item.Tax1RateC ?? item.taxPerc ?? item.TaxPerc, 0),
    tax2Rate: num(item.tax2RateC ?? item.Tax2RateC, 0),
    tax3Rate: num(item.tax3RateC ?? item.Tax3RateC, 0),
    lineTotal: num(item.lineTotal ?? item.LineTotal, 0) || (subTotal + tax1 + tax2 + tax3),
    stylistId,
    lineType,
    modifier: item.modifier != null ? String(item.modifier).slice(0, 2000) : null,
  };
}

export async function settleSale(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId = Number(authStaff.branch_id);

  const stationId = parseLong(body.stationId ?? body.StationID ?? authStaff.station_id ?? authStaff.branch_id);
  if (stationId == null) throw badRequest('stationId is required', 'NO_STATION');

  const jobId = parseLong(body.jobId ?? body.kotId ?? body.JobID ?? body.kotMasterId);
  if (jobId == null) throw badRequest('jobId is required', 'NO_JOB');

  const items = itemsFromBody(body);
  if (!items.length) throw badRequest('items array is required', 'NO_ITEMS');

  const totals = readTotals(body);
  const paymentMode = normalisePaymentMode(body.paymentMode);
  const auditBy = auditUserName(authStaff);
  const staffPk = parseLong(authStaff.id) ?? parseLong(authStaff.staff_id);
  const counterNo = num(body.counterNo, 1);

  return withTransaction(async (client) => {
    // Serialise settlements per company: nextSalesId / nextBillNo are MAX+1.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.salon_sales_settle:${companyId}`,
    ]);

    const job = await salesRepo.findJobForSettlement(client, companyId, jobId);
    if (!job) {
      const err = new Error(`Job ${jobId} not found`);
      err.status = 404;
      err.code = 'JOB_NOT_FOUND';
      throw err;
    }
    if (Number(job.station_id ?? job.branch_id) !== stationId) {
      throw badRequest('Job belongs to a different station', 'WRONG_STATION');
    }
    if (String(job.job_status).toUpperCase() === 'SETTLED' || job.sales_id != null) {
      throw conflict('Job is already settled', 'ALREADY_SETTLED');
    }
    if (String(job.job_status).toUpperCase() === 'CANCELLED') {
      throw conflict('Job was cancelled and cannot be settled', 'JOB_CANCELLED');
    }

    const jobLines = await salesRepo.listJobLinesForSettlement(client, companyId, jobId);
    const jobLinesByLineId = new Map(jobLines.map((l) => [Number(l.line_id), l]));
    // Fallback lookup for clients that send no line id. First line wins for a
    // repeated product; that only affects which stylist is inherited, and the
    // client can always be explicit by sending lineId.
    const jobLinesByProductId = new Map();
    for (const l of jobLines) {
      const pid = Number(l.product_id);
      if (!jobLinesByProductId.has(pid)) jobLinesByProductId.set(pid, l);
    }

    const primaryStylistId = job.primary_stylist_id != null ? Number(job.primary_stylist_id) : null;
    const lines = items
      .map((it) => resolveLine(it, { jobLinesByLineId, jobLinesByProductId, primaryStylistId }))
      .filter(Boolean);

    if (!lines.length) throw badRequest('No valid line items (productId required)', 'NO_VALID_ITEMS');

    const salesId = await salesRepo.nextSalesId(client, companyId);
    const billNo = await salesRepo.nextBillNo(client, companyId, stationId);

    await salesRepo.insertSalesMaster(client, {
      companyId,
      salesId,
      branchId,
      stationId,
      salonJobId: jobId,
      counterNo,
      billNo,
      customerId: parseLong(body.customerId) ?? (job.customer_id != null ? Number(job.customer_id) : null),
      paymentMode,
      creditCardNo: paymentMode === 'CREDITCARD' ? str(body.creditCardNo, 50) : null,
      amount: totals.net,
      cashAmount: paymentMode === 'CASH' ? totals.paid : 0,
      creditCardAmount: paymentMode === 'CREDITCARD' ? totals.paid : 0,
      paidAmount: totals.paid,
      balancePaid: totals.balancePaid,
      discountAmount: totals.discountAmount,
      subtotalAmount: totals.subTotal,
      taxableAmount: totals.taxableAmount,
      tax1Amount: totals.tax1,
      tax2Amount: totals.tax2,
      tax3Amount: totals.tax3,
      tax1Rate: totals.tax1Rate,
      tax2Rate: totals.tax2Rate,
      tax3Rate: totals.tax3Rate,
      roundOffAdj: totals.roundOffAdj,
      stylistId: parseLong(body.stylistId ?? body.waiterId) ?? primaryStylistId,
      chairId: parseLong(body.chairId ?? body.tableId) ?? (job.chair_id != null ? Number(job.chair_id) : null),
      areaId: parseLong(body.areaId) ?? (job.area_id != null ? Number(job.area_id) : null),
      noOfCustomers: Math.max(0, Math.trunc(num(body.noOfCustomer ?? body.noOfCustomers, 0))),
      staffId: staffPk,
      remarks: str(body.comments ?? body.remarks, 200),
      createdBy: auditBy,
      modifiedBy: auditBy,
    });

    for (const line of lines) {
      const salesChildId = await salesRepo.nextSalesChildId(client, companyId);
      await salesRepo.insertSalesChild(client, {
        companyId,
        salesChildId,
        salesId,
        branchId,
        stationId,
        ...line,
        createdBy: auditBy,
        modifiedBy: auditBy,
      });
    }

    await salesRepo.insertSalesPaymentSplit(client, {
      companyId,
      salesId,
      payerNo: 1,
      payMode: paymentMode === 'CREDITCARD' ? 'CARD' : 'CASH',
      billAmount: totals.paid,
      branchId,
      counterId: counterNo,
      staffId: staffPk,
      refNo: str(body.paymentRefNo, 100),
    });

    // The job was locked FOR UPDATE above, so this cannot lose a race; a zero
    // row count here would mean the row changed underneath us anyway.
    const settled = await salesRepo.markJobSettled(client, companyId, jobId, salesId, staffPk);
    if (!settled) throw conflict('Job is already settled', 'ALREADY_SETTLED');

    return {
      ok: true,
      success: true,
      salesId: String(salesId),
      billNo: String(billNo),
      jobId: String(jobId),
      jobNo: job.job_no ?? '',
      balancePaid: String(totals.balancePaid),
      lines: lines.length,
      message: 'Settlement saved.',
    };
  });
}
