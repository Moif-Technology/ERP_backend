/**
 * Salon job business logic.
 *
 * A salon job is the analogue of a restaurant KOT: open it against a chair,
 * append lines while the client is being served, settle it at the end.
 * Salon-specific rules that do NOT exist in restaurant:
 *   - a line is PRODUCT (retail) or SERVICE (labour)
 *   - a SERVICE line must name the stylist who performed it
 *   - the job carries a primary stylist that new lines inherit (decision D4)
 */
import { withTransaction } from '../../../config/db.js';
import { nextDocNo } from '../../../shared/services/docSequence.service.js';
import * as jobRepo from '../repositories/job.repository.js';

const SERVICE = 'SERVICE';
const PRODUCT = 'PRODUCT';

function num(v, d = 0) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function parseLong(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

/**
 * Walk-in customer.
 *
 * Restaurant treats 0 as "walk-in (valid)" and writes it, but ops.kot_master has
 * an FK to biz.customer_master and no customer_id = 0 row exists — so that path
 * fails on save. Salon is walk-in-first, so 0 and '' both become NULL, which the
 * nullable column accepts cleanly.
 */
function parseCustomerId(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function normaliseLineType(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === SERVICE || s === 'SVC') return SERVICE;
  return PRODUCT;
}

/**
 * Services live in core.product_master as product_type = 'SERVICE' (decision D1).
 * Matched case-insensitively on purpose: product_type is free-text VARCHAR(50)
 * and migration 104 deliberately does NOT rewrite existing tenant values.
 */
function lineTypeFromProductType(productType) {
  return String(productType ?? '').trim().toUpperCase() === SERVICE ? SERVICE : PRODUCT;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

/**
 * Resolve one incoming cart item into a row ready for insert.
 * `defaultStylistId` is the job-level primary stylist that lines inherit.
 */
function buildLine(item, ctx) {
  const {
    companyId, branchId, stationId, jobId, lineId, defaultStylistId, createdBy,
  } = ctx;

  const productId = parseLong(item.ProductID ?? item.productId ?? item.productID);
  if (productId == null) {
    throw badRequest('Each item needs a ProductID', 'LINE_NO_PRODUCT');
  }

  // Explicit lineType wins; otherwise infer from the catalogue's product_type.
  const lineType = item.LineType ?? item.lineType
    ? normaliseLineType(item.LineType ?? item.lineType)
    : lineTypeFromProductType(item.ProductType ?? item.productType);

  // Per-line stylist overrides the job default; absent, the line inherits it.
  const stylistId = parseLong(item.StylistID ?? item.stylistId) ?? defaultStylistId;

  if (lineType === SERVICE && stylistId == null) {
    const name = item.ShortDescription ?? item.shortDescription ?? `product ${productId}`;
    throw badRequest(
      `Service line "${name}" has no stylist. Every SERVICE line needs stylistId on the ` +
      `item, or a job-level primaryStylistId to inherit from. Pick a stylist and retry.`,
      'SERVICE_LINE_NO_STYLIST'
    );
  }

  const qty        = num(item.Qty ?? item.qty, 1);
  const unitPrice  = num(item.UnitPrice ?? item.unitPrice, 0);
  const discount   = num(item.ItemDiscount ?? item.itemDiscount, 0);
  const tax1Rate   = num(item.Tax1RateC ?? item.tax1RateC ?? item.Tax1Rate, 0);
  const gross      = qty * unitPrice;
  const subTotal   = num(item.SubTotal ?? item.subTotal, gross - discount);
  const tax1Amount = num(item.Tax1AmountC ?? item.tax1AmountC, 0);
  const lineTotal  = num(item.LineTotal ?? item.lineTotal, subTotal + tax1Amount);

  // Duration: per-line override, else the catalogue default. Only meaningful on
  // SERVICE lines — it drives the in-progress timer and the overrun cue.
  const duration = lineType === SERVICE
    ? (parseLong(item.DurationMinutes ?? item.durationMinutes)
       ?? parseLong(item.DefaultDurationMinutes ?? item.defaultDurationMinutes))
    : null;

  return {
    companyId,
    branchId,
    stationId,
    jobId,
    lineId,
    lineType,
    stylistId: lineType === SERVICE ? stylistId : (stylistId ?? null),
    durationMinutes: duration,
    serviceStatus: lineType === SERVICE ? 'WAITING' : null,
    productId,
    barcode: String(item.BarCode ?? item.Barcode ?? item.barcode ?? '').slice(0, 50),
    shortDescription: String(item.ShortDescription ?? item.shortDescription ?? '').slice(0, 200),
    groupId: parseLong(item.GroupID ?? item.groupId) ?? 0,
    qty,
    unitPrice,
    unitCost: num(item.UnitCost ?? item.unitCost, 0),
    amount: gross,
    itemDiscount: discount,
    subTotal,
    lineTotal,
    tax1Amount,
    tax1Rate,
    remarks: item.Remarks ?? item.remarks ?? null,
    createdBy,
  };
}

/**
 * Create a job, or append lines to an existing open one.
 *
 * Body: { StationID, ChairID, AreaID, CustomerID, PrimaryStylistID, Items[],
 *         CurrentJobID? (append), Remarks?, BillDiscount?, RoundOffAdj? }
 */
export async function saveJob(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const createdBy = authStaff.staff_id != null ? Number(authStaff.staff_id) : null;

  const stationId = num(
    body.StationID ?? body.stationId ?? authStaff.station_id ?? authStaff.branch_id, 0
  );
  if (stationId < 1) throw badRequest('StationID is required', 'NO_STATION');

  const items = Array.isArray(body.Items ?? body.items) ? (body.Items ?? body.items) : [];
  if (!items.length) throw badRequest('Items array is required', 'NO_ITEMS');

  const station = await jobRepo.assertSalonStation(pool, companyId, stationId);
  if (!station) throw badRequest('Invalid station for this company', 'BAD_STATION');
  if (station.station_type !== 'SALON_POS') {
    throw badRequest(
      `Station ${stationId} is a ${station.station_type}, not a SALON_POS terminal.`,
      'NOT_SALON_STATION'
    );
  }

  const chairId          = parseLong(body.ChairID ?? body.chairId ?? body.TableID);
  const areaId           = parseLong(body.AreaID ?? body.areaId);
  const customerId       = parseCustomerId(body.CustomerID ?? body.customerId);
  const primaryStylistId = parseLong(body.PrimaryStylistID ?? body.primaryStylistId);
  const appendJobId      = parseLong(body.CurrentJobID ?? body.currentJobId);

  return withTransaction(async (client) => {
    // Serialise id allocation. Unlike restaurant's per-company lock, this is
    // global for the table so two tenants saving at once cannot interleave.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      'ops.salon_job_save',
    ]);

    let jobId;
    let jobNo;
    let effectiveStylist = primaryStylistId;

    if (appendJobId != null) {
      const existing = await jobRepo.findJobMaster(client, companyId, appendJobId);
      if (!existing) {
        const err = new Error(`Job ${appendJobId} not found`);
        err.status = 404;
        throw err;
      }
      if (existing.job_status === 'SETTLED') {
        const err = new Error(`Job ${existing.job_no} is already settled and cannot take new lines`);
        err.status = 409;
        throw err;
      }
      jobId = appendJobId;
      jobNo = existing.job_no;
      // Falling back to the stored stylist keeps append working when the client
      // omits it (it only sends the stylist when opening the job).
      effectiveStylist = primaryStylistId ?? (existing.primary_stylist_id != null
        ? Number(existing.primary_stylist_id) : null);
    } else {
      if (chairId != null) {
        const busy = await jobRepo.findOpenJobByChair(client, companyId, chairId);
        if (busy) {
          const err = new Error(
            `Chair already has open job ${busy.job_no}. Settle it, or append to it with CurrentJobID.`
          );
          err.status = 409;
          err.code = 'CHAIR_OCCUPIED';
          throw err;
        }
      }

      jobId = await jobRepo.nextJobId(client, companyId);
      jobNo = await nextDocNo(client, {
        companyId,
        branchId,
        sequenceCode: 'SALON_JOB', // NEVER resets — see docSequence.service.js
      });

      await jobRepo.insertJobMaster(client, {
        companyId,
        branchId,
        stationId,
        jobId,
        jobNo,
        jobStatus: 'OPEN',
        customerId,
        chairId,
        areaId,
        primaryStylistId: effectiveStylist,
        startTime: new Date(),
        appointmentId: parseLong(body.AppointmentID ?? body.appointmentId),
        billDiscount: num(body.BillDiscount ?? body.billDiscount, 0),
        subTotal: 0,
        tax1Amount: 0,
        tax1Rate: num(body.Tax1Rate ?? body.tax1Rate, 0),
        roundOffAdj: num(body.RoundOffAdj ?? body.roundOffAdj, 0),
        amount: 0,
        remarks: body.Remarks ?? body.remarks ?? null,
        createdBy,
      });
    }

    let lineId = await jobRepo.nextLineId(client, companyId, jobId);
    const inserted = [];

    for (const item of items) {
      const row = buildLine(item, {
        companyId,
        branchId,
        stationId,
        jobId,
        lineId,
        defaultStylistId: effectiveStylist,
        createdBy,
      });
      await jobRepo.insertJobChild(client, row);
      inserted.push(lineId);
      lineId += 1;
    }

    const totals = await jobRepo.refreshJobTotals(client, companyId, jobId, createdBy);
    const lines  = await jobRepo.listJobLines(client, companyId, jobId);

    return {
      ok: true,
      success: true,
      jobId: String(jobId),
      jobNo,
      currentJobId: String(jobId),
      newLineIds: inserted.map(String),
      totals,
      data: lines.map(mapLineForClient),
    };
  });
}

/**
 * One job line in the shape the Flutter POS reads.
 *
 * The salon-specific keys (JobID, LineID, StylistID, …) are the real contract.
 * The Kot* keys below them are compatibility aliases for the screens this app
 * inherited from restaurant POS and that were never rewritten — settlement is
 * the important one: right_panel.dart reads `firstRow['KotMasterID']` to decide
 * which ticket it is billing, and with no such key it resolved to 0 and refused
 * to settle with "Settlement requires a saved KOT". Same for TableID, which the
 * settlement payload reads for the chair.
 *
 * Emit both spellings rather than renaming the Dart: the aliases are cheap, and
 * every one of those screens would otherwise need to change in lockstep.
 */
function mapLineForClient(row) {
  return {
    JobID: String(row.job_id),
    jobID: String(row.job_id),
    JobNo: row.job_no ?? '',

    // Compatibility aliases — see the note above.
    KotMasterID: String(row.job_id),
    kotMasterID: String(row.job_id),
    KotChildID:  String(row.line_id),
    kotChildID:  String(row.line_id),
    KOTNumber:   row.job_no ?? '',
    KotNumber:   row.job_no ?? '',
    KOTStatus:   row.job_status ?? '',
    KotStatus:   row.job_status ?? '',
    TableID:     row.chair_id != null ? String(row.chair_id) : '',
    tableId:     row.chair_id != null ? String(row.chair_id) : '',
    CustomerID:  row.customer_id != null ? String(row.customer_id) : '',
    customerId:  row.customer_id != null ? String(row.customer_id) : '',
    WaiterID:    row.primary_stylist_id != null ? String(row.primary_stylist_id) : '',
    waiterId:    row.primary_stylist_id != null ? String(row.primary_stylist_id) : '',

    LineID: String(row.line_id),
    lineID: String(row.line_id),
    LineType: row.line_type,
    lineType: row.line_type,
    StylistID: row.stylist_id != null ? String(row.stylist_id) : '',
    stylistID: row.stylist_id != null ? String(row.stylist_id) : '',
    StylistName: row.stylist_name ?? '',
    stylistName: row.stylist_name ?? '',
    DurationMinutes: row.duration_minutes != null ? String(row.duration_minutes) : '',
    ServiceStatus: row.service_status ?? '',
    serviceStatus: row.service_status ?? '',
    ChairID: row.chair_id != null ? String(row.chair_id) : '',
    AreaID: row.area_id != null ? String(row.area_id) : '',
    ProductID: row.product_id != null ? String(row.product_id) : '',
    productID: row.product_id != null ? String(row.product_id) : '',
    ShortDescription: row.short_description ?? '',
    BarCode: row.barcode ?? '',
    GroupID: row.group_id != null ? String(row.group_id) : '0',
    Qty: String(row.qty),
    qty: String(row.qty),
    UnitPrice: String(row.unit_price),
    unitPrice: String(row.unit_price),
    ItemDiscount: String(row.item_discount ?? 0),
    SubTotal: String(row.sub_total ?? 0),
    Tax1RateC: String(row.tax_1_rate ?? 0),
    Tax1AmountC: String(row.tax_1_amount ?? 0),
    LineTotal: String(row.line_total ?? 0),
    lineTotal: String(row.line_total ?? 0),
    Remarks: row.remarks ?? '',
  };
}

export async function getJob(pool, authStaff, jobIdRaw) {
  const companyId = Number(authStaff.company_id);
  const jobId = parseLong(jobIdRaw);
  if (jobId == null) throw badRequest('Invalid job id', 'BAD_JOB_ID');

  const master = await jobRepo.findJobMaster(pool, companyId, jobId);
  if (!master) {
    const err = new Error(`Job ${jobIdRaw} not found`);
    err.status = 404;
    throw err;
  }

  const lines = await jobRepo.listJobLines(pool, companyId, jobId);
  return {
    success: true,
    job: {
      JobID: String(master.job_id),
      JobNo: master.job_no,
      JobStatus: master.job_status,
      ChairID: master.chair_id != null ? String(master.chair_id) : '',
      AreaID: master.area_id != null ? String(master.area_id) : '',
      CustomerID: master.customer_id != null ? String(master.customer_id) : '',
      PrimaryStylistID: master.primary_stylist_id != null ? String(master.primary_stylist_id) : '',
      SubTotal: String(master.sub_total ?? 0),
      Tax1Amount: String(master.tax_1_amount ?? 0),
      Amount: String(master.amount ?? 0),
      Remarks: master.remarks ?? '',
    },
    data: lines.map(mapLineForClient),
  };
}

export async function listJobs(pool, authStaff, query = {}) {
  const companyId = Number(authStaff.company_id);
  // Default to the caller's own station so one terminal cannot enumerate
  // another's open jobs unless it explicitly asks for all.
  const stationId = query.all === 'true'
    ? null
    : (parseLong(query.stationId) ?? parseLong(authStaff.station_id) ?? null);

  const rows = await jobRepo.listOpenJobs(pool, companyId, {
    stationId,
    stylistId: parseLong(query.stylistId),
  });

  return {
    success: true,
    data: rows.map((r) => ({
      JobID: String(r.job_id),
      JobNo: r.job_no,
      JobStatus: r.job_status,
      ChairID: r.chair_id != null ? String(r.chair_id) : '',
      ChairName: r.chair_name ?? '',
      AreaID: r.area_id != null ? String(r.area_id) : '',
      CustomerID: r.customer_id != null ? String(r.customer_id) : '',
      CustomerName: r.customer_name ?? 'Walk-in',
      PrimaryStylistID: r.primary_stylist_id != null ? String(r.primary_stylist_id) : '',
      PrimaryStylistName: r.primary_stylist_name ?? '',
      Amount: String(r.amount ?? 0),
      StartTime: r.start_time ?? null,
      ServiceCount: Number(r.service_count ?? 0),
      ServiceDoneCount: Number(r.service_done_count ?? 0),
    })),
  };
}

const SERVICE_STATUSES = new Set(['WAITING', 'IN_PROGRESS', 'DONE']);

export async function setLineServiceStatus(pool, authStaff, jobIdRaw, lineIdRaw, statusRaw) {
  const companyId = Number(authStaff.company_id);
  const modifiedBy = authStaff.staff_id != null ? Number(authStaff.staff_id) : null;

  const jobId  = parseLong(jobIdRaw);
  const lineId = parseLong(lineIdRaw);
  const status = String(statusRaw ?? '').trim().toUpperCase();

  if (jobId == null || lineId == null) throw badRequest('Invalid job or line id', 'BAD_IDS');
  if (!SERVICE_STATUSES.has(status)) {
    throw badRequest(
      `Invalid service status '${statusRaw}'. Expected one of: ${[...SERVICE_STATUSES].join(', ')}`,
      'BAD_SERVICE_STATUS'
    );
  }

  const ok = await jobRepo.updateLineServiceStatus(pool, companyId, jobId, lineId, status, modifiedBy);
  if (!ok) {
    const err = new Error(`No SERVICE line ${lineId} on job ${jobId}`);
    err.status = 404;
    throw err;
  }
  return { ok: true, jobId: String(jobId), lineId: String(lineId), serviceStatus: status };
}

/** Reassign one line to a different stylist (the "wrong stylist" correction path). */
export async function reassignLineStylist(pool, authStaff, jobIdRaw, lineIdRaw, stylistIdRaw) {
  const companyId = Number(authStaff.company_id);
  const modifiedBy = authStaff.staff_id != null ? Number(authStaff.staff_id) : null;

  const jobId     = parseLong(jobIdRaw);
  const lineId    = parseLong(lineIdRaw);
  const stylistId = parseLong(stylistIdRaw);

  if (jobId == null || lineId == null) throw badRequest('Invalid job or line id', 'BAD_IDS');
  if (stylistId == null) {
    throw badRequest('stylistId is required to reassign a line', 'NO_STYLIST');
  }

  const ok = await jobRepo.updateLineStylist(pool, companyId, jobId, lineId, stylistId, modifiedBy);
  if (!ok) {
    const err = new Error(`No line ${lineId} on job ${jobId}`);
    err.status = 404;
    throw err;
  }
  return { ok: true, jobId: String(jobId), lineId: String(lineId), stylistId: String(stylistId) };
}
