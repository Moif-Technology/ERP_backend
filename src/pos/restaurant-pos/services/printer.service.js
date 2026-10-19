/**
 * POS printer configuration + print-job lifecycle.
 *
 * Config and jobs are scoped to (company_id, station_id) taken from the
 * POS-scoped token (authStaff) — the client body is never trusted for tenant or
 * station identity.
 *
 * Routing: each KOT line carries the product's location_code (kitchen location).
 * We match it, case-insensitively, against a printer's kitchen_loc. Unmatched
 * lines go to the station's explicit fallback printer if one is configured;
 * otherwise they are reported UNROUTED and surfaced to the cashier. There is no
 * silent wrong-printer fallback.
 *
 * Printed marker: ops.kot_child.print_count (0 = never sent to the kitchen,
 * +1 per dispatch). batch_no / batch_print_status are course firing, not ours.
 *
 * Duplicate prevention: every job has a dedupe_key unique per company. Two tills
 * racing the same set of KOT lines generate the same key, so only the first INSERT
 * wins (ops.print_job UNIQUE (company_id, dedupe_key)). Claiming is a single
 * atomic UPDATE … WHERE status = 'PENDING'.
 *
 * Honesty about outcomes: a successful dispatch means the job was handed to the
 * OS spooler / socket (status SENT). It is NOT proof paper came out. Only an
 * explicit client confirmation moves a job to CONFIRMED. An uncertain transport
 * result (timeout, lost socket) becomes UNKNOWN and is never auto-retried — the
 * cashier decides whether to reprint (a new, marked job).
 */
import { createHash } from 'node:crypto';
import { withTransaction } from '../../../config/db.js';
import * as printerRepo from '../repositories/printer.repository.js';

// ── Pure helpers (unit-tested without a DB) ────────────────────────────────

export const JOB_TYPES = Object.freeze([
  'KOT_NEW', 'KOT_DELTA', 'KOT_CANCEL', 'KOT_QTY', 'KOT_REPRINT', 'BILL', 'TEST',
]);

export const JOB_STATUSES = Object.freeze([
  'PENDING', 'CLAIMED', 'SENT', 'CONFIRMED', 'FAILED', 'UNKNOWN', 'UNROUTED',
]);

/** Transitions the client may request. UNKNOWN is terminal: no auto-retry. */
const ALLOWED_TRANSITIONS = Object.freeze({
  PENDING: ['CLAIMED', 'SENT', 'FAILED', 'UNKNOWN', 'UNROUTED'],
  CLAIMED: ['SENT', 'FAILED', 'UNKNOWN'],
  SENT: ['CONFIRMED', 'FAILED', 'UNKNOWN'],
  CONFIRMED: [],
  FAILED: [],
  UNKNOWN: [],
  UNROUTED: [],
});

export function canTransition(from, to) {
  const f = String(from ?? '').toUpperCase();
  const t = String(to ?? '').toUpperCase();
  if (!JOB_STATUSES.includes(t)) return false;
  return (ALLOWED_TRANSITIONS[f] ?? []).includes(t);
}

/** A dispatch that reached the spooler/socket. Advances the printed marker. */
export function isDispatchedStatus(status) {
  const s = String(status ?? '').toUpperCase();
  return s === 'SENT' || s === 'CONFIRMED';
}

export function normalizeLoc(s) {
  return String(s ?? '').trim().toLowerCase();
}

/**
 * Build the duplicate-dispatch guard key. Same KOT lines + printer + job type
 * always yields the same key, so a retry or a racing till is deduped. A reprint
 * passes a nonce so it is deliberately a new, separate job.
 */
export function buildDedupeKey({ jobType, kotMasterId, childIds = [], printerId = 0, nonce = '' }) {
  // KOT_NEW and KOT_DELTA both auto-print pending lines — share one key so the
  // same lines can never auto-print twice (first save = NEW, re-save = DELTA).
  const kind = jobType === 'KOT_NEW' || jobType === 'KOT_DELTA' ? 'KOT_AUTO' : String(jobType ?? '');
  const ids = [...new Set(childIds.map(Number))].sort((a, b) => a - b).join(',');
  const parts = [
    kind,
    String(kotMasterId ?? ''),
    // hashed: a big KOT's id list would bloat the unique index
    createHash('sha1').update(ids).digest('hex').slice(0, 16),
    String(printerId ?? 0),
  ];
  if (nonce) parts.push(String(nonce));
  return parts.join(':');
}

/**
 * Group KOT lines to printers by location_code → kitchen_loc.
 * @param {Array<{productId:number, locationCode:string}>} items
 * @param {Array<{printerId:number, kitchenLoc:string, isFallback:boolean, isActive:boolean, counterNo:number}>} printers
 * @returns {{ groups: Array<{printerId:number, kitchenLoc:string, byFallback:boolean, items:Array}>, unrouted: Array }}
 */
export function resolveRouting(items, printers) {
  const active = (printers ?? []).filter((p) => p.isActive !== false && Number(p.counterNo || 0) !== 99);
  const byLoc = new Map();
  for (const p of active) {
    if (p.isFallback) continue;
    const key = normalizeLoc(p.kitchenLoc);
    if (key && !byLoc.has(key)) byLoc.set(key, p);
  }
  const fallback = active.find((p) => p.isFallback) ?? null;

  const groups = new Map(); // printerId -> group
  const unrouted = [];

  const push = (printer, item, byFallback) => {
    const id = printer.printerId;
    if (!groups.has(id)) {
      groups.set(id, { printerId: id, kitchenLoc: printer.kitchenLoc, byFallback, items: [] });
    }
    groups.get(id).items.push(item);
  };

  for (const item of items ?? []) {
    const match = byLoc.get(normalizeLoc(item.locationCode));
    if (match) push(match, item, false);
    else if (fallback) push(fallback, item, true);
    else unrouted.push(item);
  }

  return { groups: [...groups.values()], unrouted };
}

// ── Auth scope ──────────────────────────────────────────────────────────────

function scope(authStaff) {
  const companyId = Number(authStaff?.company_id);
  const stationId = Number(authStaff?.station_id ?? authStaff?.branch_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Company is required.');
    err.status = 401;
    throw err;
  }
  if (!Number.isFinite(stationId) || stationId < 1) {
    const err = new Error('This device is not registered to a station.');
    err.status = 400;
    throw err;
  }
  return { companyId, stationId, auditBy: Number(authStaff?.staff_id ?? authStaff?.id) || null };
}

function bad(message, status = 400, code = null) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

// ── Config CRUD ───────────────────────────────────────────────────────────

export async function listPrinters(pool, authStaff) {
  const { companyId, stationId } = scope(authStaff);
  const rows = await printerRepo.listPrinters(pool, companyId, stationId);
  return { ok: true, data: rows.map(mapPrinterRow) };
}

export async function savePrinter(pool, authStaff, body = {}) {
  const { companyId, stationId, auditBy } = scope(authStaff);
  const counterNo = Math.trunc(Number(body.counterNo ?? body.counter_no ?? 0)) || 0;
  const printerName = String(body.printerName ?? body.printer_name ?? '').trim().slice(0, 200);
  const transport = normalizeTransport(body.transport);
  const paperMm = Number(body.paperMm ?? body.paper_mm) === 58 ? 58 : 80;
  const kitchenLoc = String(body.kitchenLoc ?? body.kitchen_loc ?? '').trim().slice(0, 100);
  const address = String(body.address ?? '').trim().slice(0, 200);
  const isFallback = body.isFallback === true || body.is_fallback === true;
  const isDefault = body.isDefault === true || body.is_default === true;
  const isActive = body.isActive !== false && body.is_active !== false;

  // sunmi (built-in) and browser (print dialog) need no name or address.
  if (counterNo !== 99 && !['default', 'sunmi', 'browser'].includes(transport) && !printerName && !address) {
    throw bad('Enter a printer name or address.');
  }
  if ((transport === 'escpos_tcp') && !address) {
    throw bad('ESC/POS network printer needs host:port in Address.');
  }

  return withTransaction(async (client) => {
    // Advisory lock keeps the one-fallback-per-station index from racing.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.pos_printer:${companyId}:${stationId}`,
    ]);
    if (isFallback) {
      await printerRepo.clearFallback(client, companyId, stationId, Number(body.printerId ?? 0) || 0);
    }
    if (isDefault) {
      await printerRepo.clearDefault(client, companyId, stationId, counterNo);
    }
    const row = await printerRepo.upsertPrinter(client, {
      companyId, stationId, counterNo, kitchenLoc, printerName,
      transport, address, paperMm, isFallback, isDefault, isActive, auditBy,
    });
    return { ok: true, data: mapPrinterRow(row) };
  });
}

export async function deletePrinter(pool, authStaff, printerIdRaw) {
  const { companyId, stationId } = scope(authStaff);
  const printerId = Number(printerIdRaw);
  if (!Number.isFinite(printerId) || printerId < 1) throw bad('Invalid printer id.');
  const removed = await printerRepo.deletePrinter(pool, companyId, stationId, printerId);
  if (!removed) throw bad('Printer not found.', 404);
  return { ok: true };
}

function normalizeTransport(t) {
  const u = String(t ?? 'default').trim().toLowerCase();
  const ok = ['default', 'windows', 'escpos_tcp', 'escpos_bt', 'escpos_usb', 'sunmi', 'browser'];
  return ok.includes(u) ? u : 'default';
}

function mapPrinterRow(r) {
  return {
    printerId: Number(r.printer_id),
    counterNo: Number(r.counter_no),
    kitchenLoc: r.kitchen_loc ?? '',
    printerName: r.printer_name ?? '',
    transport: r.transport ?? 'default',
    address: r.address ?? '',
    paperMm: Number(r.paper_mm) || 80,
    isFallback: r.is_fallback === true,
    isDefault: r.is_default === true,
    isActive: r.is_active === true,
  };
}

// ── Print-job creation (routing + dedupe) ───────────────────────────────────

/**
 * Create print jobs for a KOT. The caller renders each returned job and reports
 * its outcome via updateJobStatus. Duplicate jobs (same lines/printer) are
 * skipped by the unique dedupe key, except reprints (unique nonce each time).
 */
export async function createKotJobs(pool, authStaff, body = {}) {
  const { companyId, stationId, auditBy } = scope(authStaff);
  const kotMasterId = Number(body.kotMasterId ?? body.CurrentKOTID ?? body.kotId);
  const jobType = String(body.jobType ?? 'KOT_NEW').toUpperCase();
  if (!JOB_TYPES.includes(jobType) || jobType === 'BILL' || jobType === 'TEST') {
    throw bad('Invalid KOT job type.');
  }
  if (!Number.isFinite(kotMasterId) || kotMasterId < 1) throw bad('Invalid KOT.');
  const isReprint = jobType === 'KOT_REPRINT' || body.isReprint === true;
  // Reprints and change/cancel slips print the full ticket; a normal save prints
  // only lines never sent to the kitchen (print_count = 0).
  const onlyPending = jobType === 'KOT_NEW' || jobType === 'KOT_DELTA';
  const nonce = isReprint ? String(body.nonce ?? Date.now()) : '';

  return withTransaction(async (client) => {
    const header = await printerRepo.getKotHeader(client, companyId, stationId, kotMasterId);
    if (!header) throw bad('KOT not found.', 404);

    const lines = await printerRepo.getKotItemLocations(client, companyId, stationId, kotMasterId);
    const items = (onlyPending ? lines.filter((l) => !(Number(l.print_count) > 0)) : lines)
      .map((l) => ({
        productId: Number(l.product_id),
        locationCode: l.location_code ?? '',
        kotChildId: Number(l.kot_child_id),
        name: l.short_description ?? '',
        qty: Number(l.qty) || 0,
        modifier: l.modifier ?? '',
      }));

    if (!items.length) {
      return { ok: true, header: mapHeader(header), jobs: [], skipped: [], unrouted: [], nothingToPrint: true };
    }

    const printers = (await printerRepo.listPrinters(client, companyId, stationId)).map(mapPrinterRow);
    const printerById = new Map(printers.map((p) => [p.printerId, p]));
    const { groups, unrouted } = resolveRouting(items, printers);

    const created = [];
    const skipped = [];
    for (const g of groups) {
      const cfg = printerById.get(g.printerId);
      if (cfg) {
        g.printerName = cfg.printerName;
        g.transport = cfg.transport;
        g.address = cfg.address;
        g.paperMm = cfg.paperMm;
      }
      const childIds = g.items.map((it) => it.kotChildId);
      const dedupeKey = buildDedupeKey({ jobType, kotMasterId, childIds, printerId: g.printerId, nonce });
      const row = await printerRepo.insertJob(client, {
        companyId, stationId, jobType, kotMasterId, printerId: g.printerId,
        dedupeKey, isReprint, auditBy,
        payload: { kotChildIds: childIds, byFallback: g.byFallback },
      });
      if (row) created.push(mapJobRow(row, g, header));
      else skipped.push({ printerId: g.printerId, reason: 'duplicate', kitchenLoc: g.kitchenLoc });
    }

    return {
      ok: true,
      header: mapHeader(header),
      jobs: created,
      skipped,
      unrouted: unrouted.map((it) => ({ productId: it.productId, name: it.name, locationCode: it.locationCode })),
    };
  });
}

/** Atomically claim a PENDING job so only one dispatcher sends it. */
export async function claimJob(pool, authStaff, jobIdRaw, claimedBy) {
  const { companyId, stationId } = scope(authStaff);
  const jobId = Number(jobIdRaw);
  if (!Number.isFinite(jobId) || jobId < 1) throw bad('Invalid job id.');
  const row = await printerRepo.claimJob(pool, companyId, stationId, jobId, String(claimedBy ?? '').slice(0, 100));
  if (!row) throw bad('Job is not available to claim (already taken or finished).', 409, 'CLAIM_LOST');
  return { ok: true, claimed: true, jobId };
}

/**
 * Record a dispatch outcome. SENT/CONFIRMED advance the printed marker on the
 * job's children (print_count + 1) so the same lines are never re-dispatched automatically.
 * FAILED/UNKNOWN leave the marker alone, enabling a controlled manual reprint.
 */
export async function updateJobStatus(pool, authStaff, jobIdRaw, body = {}) {
  const { companyId, stationId, auditBy } = scope(authStaff);
  const jobId = Number(jobIdRaw);
  const toStatus = String(body.status ?? '').toUpperCase();
  const error = String(body.error ?? '').slice(0, 1000);
  if (!Number.isFinite(jobId) || jobId < 1) throw bad('Invalid job id.');
  if (!JOB_STATUSES.includes(toStatus)) throw bad('Invalid status.');

  return withTransaction(async (client) => {
    const job = await printerRepo.getJobForUpdate(client, companyId, stationId, jobId);
    if (!job) throw bad('Job not found.', 404);
    if (!canTransition(job.status, toStatus)) {
      throw bad(`Cannot move job from ${job.status} to ${toStatus}.`, 409, 'BAD_TRANSITION');
    }
    const updated = await printerRepo.setJobStatus(client, {
      companyId, stationId, jobId, status: toStatus, error, auditBy,
    });
    if (isDispatchedStatus(toStatus) && job.kot_master_id) {
      const childIds = Array.isArray(job.payload?.kotChildIds) ? job.payload.kotChildIds : [];
      if (childIds.length) {
        await printerRepo.markChildrenPrinted(client, companyId, job.kot_master_id, childIds);
      }
    }
    return { ok: true, job: mapJobRow(updated) };
  });
}

export async function listKotJobs(pool, authStaff, kotMasterIdRaw) {
  const { companyId, stationId } = scope(authStaff);
  const kotMasterId = Number(kotMasterIdRaw);
  if (!Number.isFinite(kotMasterId) || kotMasterId < 1) throw bad('Invalid KOT.');
  const rows = await printerRepo.listJobsForKot(pool, companyId, stationId, kotMasterId);
  return { ok: true, data: rows.map((r) => mapJobRow(r)) };
}

function mapHeader(h) {
  return {
    kotMasterId: Number(h.kot_master_id),
    kotNo: `${h.kot_prefix ?? ''}${h.kot_number ?? ''}`,
    kotPrefix: h.kot_prefix ?? '',
    kotNumber: h.kot_number != null ? String(h.kot_number) : '',
    kotStatus: h.kot_status ?? '',
    tableName: h.table_name ?? '',
    areaName: h.area_name ?? '',
    supplyType: h.supply_type ?? '',
    waiterName: h.waiter_name ?? '',
    nofCustomer: Number(h.nof_customer) || 0,
    remarks: h.remarks ?? '',
    kotTime: h.kot_time ? new Date(h.kot_time).toISOString() : null,
  };
}

function mapJobRow(r, group = null, header = null) {
  const payload = r.payload ?? {};
  return {
    printJobId: Number(r.print_job_id),
    jobType: r.job_type,
    kotMasterId: r.kot_master_id != null ? Number(r.kot_master_id) : null,
    printerId: r.printer_id != null ? Number(r.printer_id) : null,
    printerName: r.printer_name ?? group?.printerName ?? null,
    transport: r.transport ?? group?.transport ?? null,
    address: r.address ?? group?.address ?? null,
    paperMm: r.paper_mm != null ? Number(r.paper_mm) : group?.paperMm ?? 80,
    status: r.status,
    isReprint: r.is_reprint === true,
    byFallback: payload.byFallback === true || group?.byFallback === true,
    lastError: r.last_error ?? '',
    items: group?.items ?? payload.items ?? undefined,
    header: header ? mapHeader(header) : undefined,
  };
}
