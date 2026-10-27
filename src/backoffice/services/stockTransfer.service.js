import { withTransaction } from '../../config/db.js';
import * as repo from '../repositories/stockTransfer.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as stockRepo from '../../shared/repositories/stock.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';
import { auditUserName } from '../../shared/lib/auditUser.js';

// product_log_entry.transaction_type for both legs; the sign of qty tells
// out (-) of the source from in (+) to the destination.
const TRANSACTION_TYPE = 'TRANSFER';

function httpError(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  if (extra) Object.assign(err, extra);
  return err;
}

function num(v, d = 0) {
  if (v == null || v === '') return d;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : d;
}

function posInt(v) {
  const n = Math.trunc(num(v, 0));
  return n > 0 ? n : null;
}

function str(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function companyOf(authStaff) {
  const companyId = Number(authStaff.company_id ?? authStaff.companyId);
  if (!Number.isFinite(companyId) || companyId < 1) throw httpError(400, 'Invalid company on session');
  return companyId;
}

function staffIdOf(authStaff) {
  const n = Number(authStaff?.staff_id ?? authStaff?.id);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

function parseDate(v) {
  if (!v) return new Date();
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw httpError(400, 'Invalid transferDate');
  return d;
}

/** Inventory cost basis: average cost, falling back to last purchase cost. */
function costOf(inv) {
  if (!inv) return 0;
  const avg = num(inv.average_cost, 0);
  return avg > 0 ? avg : num(inv.last_purchase_cost, 0);
}

function mapMaster(row) {
  if (!row) return null;
  return {
    transferId: Number(row.transfer_id),
    transferNo: row.transfer_no,
    transferDate: row.transfer_date,
    fromBranchId: Number(row.transfer_from_branch_id),
    fromBranchCode: row.from_branch_code ?? '',
    fromBranchName: row.from_branch_name ?? '',
    toBranchId: Number(row.transfer_to_branch_id),
    toBranchCode: row.to_branch_code ?? '',
    toBranchName: row.to_branch_name ?? '',
    totalAmount: num(row.total_amount, 0),
    notes: row.remarks ?? '',
    postStatus: row.post_status,
    transferStatus: row.transfer_status,
    lineCount: row.line_count != null ? Number(row.line_count) : undefined,
    createdAt: row.created_at,
    createdBy: row.created_by ?? '',
    postedAt: row.posted_at ?? null,
    postedBy: row.posted_by ?? '',
    cancelledAt: row.cancelled_at ?? null,
    cancelledBy: row.cancelled_by ?? '',
    cancelReason: row.cancel_reason ?? '',
  };
}

function mapLine(row) {
  return {
    transferDetailId: Number(row.transfer_detail_id),
    productId: Number(row.product_id),
    productCode: row.product_code ?? '',
    barcode: row.barcode ?? '',
    productName: row.product_name ?? '',
    unitName: row.unit_name ?? '',
    qty: num(row.qty, 0),
    averageCost: num(row.average_cost, 0),
    lineTotal: num(row.line_total, 0),
    lineNotes: row.line_notes ?? '',
  };
}

function normalizeLines(rawLines) {
  if (!Array.isArray(rawLines) || !rawLines.length) throw httpError(400, 'At least one line is required');
  const seen = new Set();
  return rawLines.map((l, i) => {
    const productId = posInt(l.productId);
    if (!productId) throw httpError(400, `Line ${i + 1}: productId is required`);
    if (seen.has(productId)) throw httpError(400, `Line ${i + 1}: product is already on another line`);
    seen.add(productId);
    const qty = round3(num(l.qty, 0));
    if (!(qty > 0)) throw httpError(400, `Line ${i + 1}: qty must be greater than 0`);
    return { productId, qty, lineNotes: str(l.lineNotes ?? l.notes, 250) };
  });
}

async function assertBranches(conn, companyId, fromBranchId, toBranchId) {
  if (!fromBranchId) throw httpError(400, 'fromBranchId is required');
  if (!toBranchId) throw httpError(400, 'toBranchId is required');
  if (fromBranchId === toBranchId) throw httpError(400, 'From and To branch must be different');
  if (!await branchRepo.branchBelongsToCompany(conn, companyId, fromBranchId)) {
    throw httpError(400, 'Invalid source branch for this company');
  }
  if (!await branchRepo.branchBelongsToCompany(conn, companyId, toBranchId)) {
    throw httpError(400, 'Invalid destination branch for this company');
  }
}

async function loadFull(conn, companyId, transferId) {
  const master = await repo.getMaster(conn, companyId, transferId);
  if (!master) throw httpError(404, 'Transfer not found');
  const lines = await repo.getDetails(conn, companyId, Number(master.branch_id), transferId);
  return { transfer: mapMaster(master), lines: lines.map(mapLine) };
}

/** Writes the detail lines with the source branch's current cost (refreshed again on post). */
async function writeLines(client, { companyId, fromBranchId, transferId, lines, actor }) {
  let total = 0;
  for (const L of lines) {
    const inv = await repo.getInventoryRow(client, companyId, fromBranchId, L.productId);
    const cost = costOf(inv);
    const lineTotal = round2(cost * L.qty);
    total += lineTotal;
    await repo.insertDetail(client, {
      companyId,
      branchId: fromBranchId,
      transferDetailId: await repo.nextTransferDetailId(client, companyId),
      transferId,
      productId: L.productId,
      qty: L.qty,
      averageCost: round2(cost),
      lineTotal,
      lineNotes: L.lineNotes,
      actor,
    });
  }
  return round2(total);
}

export async function listTransfers(pool, query, authStaff) {
  const companyId = companyOf(authStaff);
  const all = String(query.scope || '').toLowerCase() === 'all';
  const status = str(query.status, 20)?.toUpperCase() || null;
  const rows = await repo.listMasters(pool, companyId, {
    branchId: all ? null : posInt(query.branchId),
    status,
    limit: query.limit,
  });
  return rows.map(mapMaster);
}

export async function getTransfer(pool, rawId, authStaff) {
  const companyId = companyOf(authStaff);
  const transferId = posInt(rawId);
  if (!transferId) throw httpError(400, 'Invalid transfer id');
  return loadFull(pool, companyId, transferId);
}

/** GET /stock — available qty + cost of one product at a branch (entry screen helper). */
export async function getStockAtBranch(pool, query, authStaff) {
  const companyId = companyOf(authStaff);
  const branchId = posInt(query.fromBranchId ?? query.branchId);
  const productId = posInt(query.productId);
  if (!branchId || !productId) throw httpError(400, 'fromBranchId and productId are required');
  const inv = await repo.getInventoryRow(pool, companyId, branchId, productId);
  return {
    branchId,
    productId,
    qtyOnHand: inv ? num(inv.qty_on_hand, 0) : 0,
    averageCost: costOf(inv),
    hasInventoryRow: !!inv,
  };
}

export async function createTransfer(pool, body, authStaff) {
  const companyId = companyOf(authStaff);
  const fromBranchId = posInt(body.fromBranchId);
  const toBranchId = posInt(body.toBranchId);
  const lines = normalizeLines(body.lines);
  const transferDate = parseDate(body.transferDate);
  const remarks = str(body.notes ?? body.remarks, 250);
  const actor = auditUserName(authStaff);

  return withTransaction(async (client) => {
    await assertBranches(client, companyId, fromBranchId, toBranchId);
    const transferId = await repo.nextTransferId(client, companyId);
    const transferNo = await nextDocNo(client, {
      companyId,
      branchId: fromBranchId,
      sequenceCode: 'TRANSFER',
      fiscalYear: transferDate.getFullYear(),
    });
    await repo.insertMaster(client, {
      companyId, transferId, transferNo, fromBranchId, toBranchId,
      transferDate, totalAmount: 0, remarks, actor,
    });
    const total = await writeLines(client, { companyId, fromBranchId, transferId, lines, actor });
    await repo.updateDraftMaster(client, {
      companyId, transferId, toBranchId, transferDate, totalAmount: total, remarks, actor,
    });
    return loadFull(client, companyId, transferId);
  });
}

export async function updateTransfer(pool, rawId, body, authStaff) {
  const companyId = companyOf(authStaff);
  const transferId = posInt(rawId);
  if (!transferId) throw httpError(400, 'Invalid transfer id');
  const lines = normalizeLines(body.lines);
  const transferDate = parseDate(body.transferDate);
  const remarks = str(body.notes ?? body.remarks, 250);
  const actor = auditUserName(authStaff);

  return withTransaction(async (client) => {
    const master = await repo.getMaster(client, companyId, transferId, { forUpdate: true });
    if (!master) throw httpError(404, 'Transfer not found');
    if (master.post_status !== 'DRAFT') throw httpError(409, `Transfer is ${master.post_status} — only drafts can be edited`);
    const fromBranchId = Number(master.transfer_from_branch_id);
    const reqFrom = posInt(body.fromBranchId);
    if (reqFrom && reqFrom !== fromBranchId) {
      throw httpError(400, 'Source branch cannot be changed after the transfer is created');
    }
    const toBranchId = posInt(body.toBranchId) ?? Number(master.transfer_to_branch_id);
    await assertBranches(client, companyId, fromBranchId, toBranchId);

    await repo.deleteDetails(client, companyId, Number(master.branch_id), transferId);
    const total = await writeLines(client, { companyId, fromBranchId, transferId, lines, actor });
    await repo.updateDraftMaster(client, {
      companyId, transferId, toBranchId, transferDate, totalAmount: total, remarks, actor,
    });
    return loadFull(client, companyId, transferId);
  });
}

/**
 * Post: one transaction — per line, cost = source average cost now; stock out
 * of the source (-qty) and into the destination (+qty) via applyStockMovement,
 * each leg writing an ops.product_log_entry row. Blocks if the source would go
 * negative.
 */
export async function postTransfer(pool, rawId, authStaff) {
  const companyId = companyOf(authStaff);
  const transferId = posInt(rawId);
  if (!transferId) throw httpError(400, 'Invalid transfer id');
  const actor = auditUserName(authStaff);
  const staffId = staffIdOf(authStaff);

  return withTransaction(async (client) => {
    const master = await repo.getMaster(client, companyId, transferId, { forUpdate: true });
    if (!master) throw httpError(404, 'Transfer not found');
    if (master.post_status !== 'DRAFT') throw httpError(409, `Transfer is already ${master.post_status}`);
    const docBranchId = Number(master.branch_id);
    const fromBranchId = Number(master.transfer_from_branch_id);
    const toBranchId = Number(master.transfer_to_branch_id);
    await assertBranches(client, companyId, fromBranchId, toBranchId);

    const lines = await repo.getDetails(client, companyId, docBranchId, transferId);
    if (!lines.length) throw httpError(400, 'Transfer has no lines');

    const shortages = [];
    const plan = [];
    for (const line of lines) {
      const productId = Number(line.product_id);
      const qty = num(line.qty, 0);
      const inv = await repo.getInventoryRow(client, companyId, fromBranchId, productId, { forUpdate: true });
      const available = inv ? num(inv.qty_on_hand, 0) : 0;
      if (available < qty) {
        shortages.push({
          productId,
          productName: line.product_name || line.product_code || `Product ${productId}`,
          available,
          required: qty,
        });
      }
      plan.push({ line, productId, qty, cost: round2(costOf(inv)) });
    }
    if (shortages.length) {
      const list = shortages.map((s) => `${s.productName} (available ${s.available}, need ${s.required})`).join('; ');
      throw httpError(409, `Insufficient stock at source branch: ${list}`, { code: 'INSUFFICIENT_STOCK', shortages });
    }

    let total = 0;
    for (const { line, productId, qty, cost } of plan) {
      const lineTotal = round2(cost * qty);
      total += lineTotal;
      await repo.setDetailCost(client, companyId, docBranchId, Number(line.transfer_detail_id), cost, lineTotal);

      await stockRepo.applyStockMovement(client, {
        companyId, branchId: fromBranchId, productId,
        transactionType: TRANSACTION_TYPE, transactionId: transferId,
        qty: -qty, unitCost: cost, unitPrice: 0, createdBy: staffId,
      });

      await repo.ensureInventoryRow(client, companyId, fromBranchId, toBranchId, productId, actor);
      await repo.updateAverageCostOnReceive(client, companyId, toBranchId, productId, qty, cost);
      await stockRepo.applyStockMovement(client, {
        companyId, branchId: toBranchId, productId,
        transactionType: TRANSACTION_TYPE, transactionId: transferId,
        qty, unitCost: cost, unitPrice: 0, createdBy: staffId,
        requireInventoryRow: true,
      });
    }

    await repo.setPosted(client, companyId, docBranchId, transferId, round2(total), actor);
    return loadFull(client, companyId, transferId);
  });
}

/**
 * Cancel. Draft → just marked CANCELLED. Posted → reversed (stock back from the
 * destination into the source at the posted line cost) in one transaction.
 * If the destination no longer holds the qty the reversal is blocked unless
 * body.force is true (stock may then go negative there).
 */
export async function cancelTransfer(pool, rawId, body, authStaff) {
  const companyId = companyOf(authStaff);
  const transferId = posInt(rawId);
  if (!transferId) throw httpError(400, 'Invalid transfer id');
  const reason = str(body?.reason, 250);
  const force = body?.force === true;
  const actor = auditUserName(authStaff);
  const staffId = staffIdOf(authStaff);

  return withTransaction(async (client) => {
    const master = await repo.getMaster(client, companyId, transferId, { forUpdate: true });
    if (!master) throw httpError(404, 'Transfer not found');
    if (master.post_status === 'CANCELLED') throw httpError(409, 'Transfer is already cancelled');
    const docBranchId = Number(master.branch_id);
    const warnings = [];

    if (master.post_status === 'POSTED') {
      if (!reason) throw httpError(400, 'A reason is required to reverse a posted transfer');
      const fromBranchId = Number(master.transfer_from_branch_id);
      const toBranchId = Number(master.transfer_to_branch_id);
      const lines = await repo.getDetails(client, companyId, docBranchId, transferId);

      const shortages = [];
      for (const line of lines) {
        const inv = await repo.getInventoryRow(client, companyId, toBranchId, Number(line.product_id), { forUpdate: true });
        const available = inv ? num(inv.qty_on_hand, 0) : 0;
        if (available < num(line.qty, 0)) {
          shortages.push({
            productId: Number(line.product_id),
            productName: line.product_name || line.product_code || `Product ${line.product_id}`,
            available,
            required: num(line.qty, 0),
          });
        }
      }
      if (shortages.length) {
        const list = shortages.map((s) => `${s.productName} (available ${s.available}, need ${s.required})`).join('; ');
        if (!force) {
          throw httpError(409, `Destination branch no longer holds the transferred stock: ${list}`, {
            code: 'NEGATIVE_STOCK', shortages,
          });
        }
        warnings.push(`Stock went negative at destination: ${list}`);
      }

      for (const line of lines) {
        const productId = Number(line.product_id);
        const qty = num(line.qty, 0);
        const cost = num(line.average_cost, 0);
        await stockRepo.applyStockMovement(client, {
          companyId, branchId: toBranchId, productId,
          transactionType: TRANSACTION_TYPE, transactionId: transferId,
          qty: -qty, unitCost: cost, unitPrice: 0, createdBy: staffId,
        });
        await repo.updateAverageCostOnReceive(client, companyId, fromBranchId, productId, qty, cost);
        await stockRepo.applyStockMovement(client, {
          companyId, branchId: fromBranchId, productId,
          transactionType: TRANSACTION_TYPE, transactionId: transferId,
          qty, unitCost: cost, unitPrice: 0, createdBy: staffId,
        });
      }
    }

    await repo.setCancelled(client, companyId, docBranchId, transferId, reason, actor);
    const full = await loadFull(client, companyId, transferId);
    return warnings.length ? { ...full, warnings } : full;
  });
}
