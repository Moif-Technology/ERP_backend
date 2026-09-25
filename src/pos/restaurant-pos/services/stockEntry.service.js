/**
 * Restaurant POS stock adjustment / damage / additional stock.
 * VB: StockAdjustmentfrm + StockAdjustmentList (ePos EntryType ADJ / DAMAGE / EXTRA).
 *
 * Qty (ePos):
 *   ADJ  AdjQty = (PhysicalPacks * PackQty + EnteredQty) - PresentQty
 *        PhysicalQty stored in base units (PhysicalPacks * PackQty)
 *   DMG  user types AdjQty (packs); PhysicalQty = Present − Adj*Pack
 *        posted stock delta is negative (Reason Damage → AdjQty * -1)
 *   ASE  user types AdjQty (packs); PhysicalQty = Present + Adj*Pack
 *        posted stock delta is positive
 */
import { withTransaction } from '../../../config/db.js';
import * as boRepo from '../../../backoffice/repositories/stockEntry.repository.js';
import * as boService from '../../../backoffice/services/stockEntry.service.js';
import * as stockRepo from '../../../shared/repositories/stock.repository.js';

const DOC = { ADJ: 'ADJ', DMG: 'DMG', ASE: 'ASE' };
const REASON = { ADJ: 'Opening Stock', DMG: 'Damage', ASE: 'EXTRA' };

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round3(v) {
  return Math.round(num(v, 0) * 1000) / 1000;
}

function isoDate(raw, fallback) {
  const s = String(raw ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

async function resolveStationScope(pool, authStaff, query = {}) {
  const companyId = num(authStaff?.company_id, 0);
  const stationId = num(authStaff?.station_id, 0) || num(query?.stationId, 0);
  let branchId = 0;
  if (companyId > 0 && stationId > 0) {
    const { rows } = await pool.query(
      `SELECT branch_id
         FROM core.station_master
        WHERE company_id = $1 AND station_id = $2 AND is_deleted = FALSE
        LIMIT 1`,
      [companyId, stationId],
    );
    branchId = num(rows[0]?.branch_id, 0);
  }
  if (branchId < 1) branchId = num(authStaff?.branch_id, 0);
  if (companyId < 1 || branchId < 1) {
    const err = new Error('Company / branch missing');
    err.status = 400;
    throw err;
  }
  return {
    companyId,
    branchId,
    stationId,
    staff: {
      ...authStaff,
      company_id: companyId,
      companyId,
      branch_id: branchId,
      branchId,
    },
  };
}

function normalizeDocType(raw) {
  const t = String(raw || '').trim().toUpperCase();
  if (t === 'DAMAGE' || t === 'DMG') return DOC.DMG;
  if (t === 'EXTRA' || t === 'ASE' || t === 'ADDITIONAL') return DOC.ASE;
  return DOC.ADJ;
}

function defaultReason(docType) {
  return REASON[docType] || REASON.ADJ;
}

/**
 * Compute stored line qtys from the till fields (VB SaveData + TextChanged).
 * adjQty is the signed stock delta that post will apply.
 */
export function computeLineQtys(docType, line) {
  const packQty = round3(num(line.packQty ?? line.pktQty, 1) || 1);
  const present = round3(line.systemQty ?? line.presentQty ?? line.qtyOnHand);
  const entered = round3(line.enteredQty);
  const adjEntered = round3(line.adjEntered ?? line.adjustQty ?? line.adjQty);
  const physicalPacks = round3(line.physicalPacks ?? line.physicalQty);

  if (docType === DOC.DMG) {
    if (adjEntered <= 0) {
      const err = new Error('Please Enter Qty');
      err.status = 400;
      throw err;
    }
    const base = round3(Math.abs(adjEntered) * packQty);
    // VB txtAdjQty_TextChanged: Physical = (EnteredQty or Present) − Adj*Pack
    const start = entered !== 0 ? entered : present;
    return {
      packQty,
      systemQty: present,
      enteredQty: entered,
      adjQty: round3(-base),
      physicalQty: round3(start - base),
      reason: String(line.reason || REASON.DMG),
    };
  }

  if (docType === DOC.ASE) {
    if (adjEntered <= 0) {
      const err = new Error('Please Enter Qty');
      err.status = 400;
      throw err;
    }
    const base = round3(Math.abs(adjEntered) * packQty);
    return {
      packQty,
      systemQty: present,
      enteredQty: entered,
      adjQty: base,
      physicalQty: round3(present + base),
      reason: String(line.reason || REASON.ASE),
    };
  }

  if (physicalPacks > 8000) {
    const err = new Error('Please Correct Physical Qty');
    err.status = 400;
    throw err;
  }
  const hasPhysical =
    (line.physicalPacks != null && line.physicalPacks !== '') ||
    (line.physicalQty != null && line.physicalQty !== '');
  if (!hasPhysical && adjEntered === 0) {
    const err = new Error('Please Enter Qty');
    err.status = 400;
    throw err;
  }
  const physicalBase = round3(physicalPacks * packQty);
  return {
    packQty,
    systemQty: present,
    enteredQty: entered,
    adjQty: round3(physicalBase + entered - present),
    physicalQty: physicalBase,
    reason: String(line.reason || REASON.ADJ),
  };
}

function mapSaveLines(docType, lines) {
  const out = [];
  for (const raw of lines || []) {
    const productId = num(raw.productId, 0);
    if (productId < 1) continue;
    const q = computeLineQtys(docType, raw);
    const cost = num(raw.lastPurchaseCost ?? raw.unitCost, 0);
    out.push({
      productId,
      barcode: raw.barcode || '',
      shortDescription: raw.shortDescription || raw.item || '',
      pktQty: q.packQty,
      pktDetails: raw.pktDetails || raw.packetDetails || '',
      systemQty: q.systemQty,
      adjQty: q.adjQty,
      enteredQty: q.enteredQty,
      physicalQty: q.physicalQty,
      reason: q.reason,
      lineTotal: round3(Math.abs(q.adjQty) * cost),
    });
  }
  if (!out.length) {
    const err = new Error('Please Enter Atleast One Product');
    err.status = 400;
    throw err;
  }
  return out;
}

export async function searchProducts(pool, query, authStaff) {
  const scope = await resolveStationScope(pool, authStaff, query);
  const q = String(query.q ?? query.barcode ?? query.name ?? '').trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const { rows } = await pool.query(
    `SELECT m.product_id,
            COALESCE(m.barcode, '') AS barcode,
            COALESCE(m.product_name, COALESCE(m.short_name, '')) AS short_description,
            COALESCE(m.pack_description, '') AS packet_details,
            COALESCE(i.pack_qty, m.pack_qty, 1) AS pack_qty,
            COALESCE(i.qty_on_hand, 0) AS qty_on_hand,
            COALESCE(i.last_purchase_cost, 0) AS last_purchase_cost,
            COALESCE(i.average_cost, 0) AS average_cost
       FROM core.product_master m
       LEFT JOIN core.product_inventory i
         ON i.company_id = m.company_id
        AND i.product_id = m.product_id
        AND i.branch_id = $2
      WHERE m.company_id = $1
        AND COALESCE(m.record_status, 'ACTIVE') = 'ACTIVE'
        AND UPPER(REPLACE(TRIM(COALESCE(m.stock_type, '')), '-', ' ')) <> 'NON INVENTORY'
        AND (
          COALESCE(m.barcode, '') ILIKE $3
          OR COALESCE(m.product_name, '') ILIKE $3
          OR COALESCE(m.short_name, '') ILIKE $3
        )
      ORDER BY
        CASE WHEN UPPER(COALESCE(m.barcode, '')) = UPPER($4) THEN 0 ELSE 1 END,
        COALESCE(m.product_name, '') ASC
      LIMIT 40`,
    [scope.companyId, scope.branchId, like, q],
  );
  return rows.map((r) => ({
    productId: num(r.product_id, 0),
    barcode: String(r.barcode ?? ''),
    shortDescription: String(r.short_description ?? ''),
    packetDetails: String(r.packet_details ?? ''),
    packQty: num(r.pack_qty, 1) || 1,
    qtyOnHand: num(r.qty_on_hand, 0),
    lastPurchaseCost: num(r.last_purchase_cost, 0),
    averageCost: num(r.average_cost, 0),
  }));
}

export async function draftEnteredQty(pool, query, authStaff) {
  const scope = await resolveStationScope(pool, authStaff, query);
  const productId = num(query.productId, 0);
  if (productId < 1) return { physicalQty: 0 };
  const row = await boRepo.getDraftEnteredQty(
    pool,
    scope.companyId,
    scope.branchId,
    productId,
  );
  return { physicalQty: num(row?.physical_qty, 0) };
}

export async function saveEntry(pool, body, authStaff) {
  const scope = await resolveStationScope(pool, authStaff, body);
  const docType = normalizeDocType(body.docType ?? body.entryType);
  const lines = mapSaveLines(docType, body.lines ?? body.items ?? []);
  return boService.saveEntry(
    pool,
    {
      entryId: body.entryId ?? null,
      entryNo: body.entryNo ?? '',
      docType,
      entryDate: body.entryDate ?? body.adjDate,
      remark: body.remark ?? body.remarks ?? '',
      lines,
    },
    scope.staff,
  );
}

export async function getEntry(pool, id, query, authStaff) {
  const scope = await resolveStationScope(pool, authStaff, query);
  return boService.getEntry(pool, id, scope.staff);
}

export async function listEntries(pool, query, authStaff) {
  const scope = await resolveStationScope(pool, authStaff, query);
  const docType = normalizeDocType(query.docType ?? query.entryType);
  const dateFrom = isoDate(query.dateFrom ?? query.fromDate, null);
  const dateTo = isoDate(query.dateTo ?? query.toDate, null);
  const params = [scope.companyId, scope.branchId, docType];
  let extra = '';
  if (dateFrom) {
    params.push(dateFrom);
    extra += ` AND entry_date >= $${params.length}::date`;
  }
  if (dateTo) {
    params.push(dateTo);
    extra += ` AND entry_date <= $${params.length}::date`;
  }
  const { rows } = await pool.query(
    `SELECT entry_id, entry_no, doc_type, entry_date, remark, post_status, created_at
       FROM ops.stock_entry_master
      WHERE company_id = $1 AND branch_id = $2 AND doc_type = $3
        ${extra}
      ORDER BY entry_id DESC
      LIMIT 500`,
    params,
  );
  return rows.map((r) => ({
    entryId: num(r.entry_id, 0),
    entryNo: String(r.entry_no ?? ''),
    docType: r.doc_type,
    entryDate: r.entry_date,
    remark: r.remark ?? '',
    postStatus: String(r.post_status ?? 'draft').toUpperCase() === 'POSTED' ? 'POSTED' : 'NOT POSTED',
    createdAt: r.created_at,
  }));
}

export async function postEntry(pool, id, query, authStaff) {
  const scope = await resolveStationScope(pool, authStaff, query);
  const entryId = num(id, 0);
  if (entryId < 1) {
    const err = new Error('entryId required');
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    const master = await boRepo.getMaster(client, scope.companyId, scope.branchId, entryId);
    if (!master) {
      const e = new Error('No Record Found for Posting........');
      e.status = 404;
      throw e;
    }
    if (String(master.post_status).toLowerCase() === 'posted') {
      const e = new Error('Already posted');
      e.status = 409;
      throw e;
    }
    const rows = await boRepo.getDetail(client, scope.companyId, scope.branchId, entryId);
    const createdBy = scope.staff.staff_id ?? scope.staff.staffId ?? authStaff?.id;
    for (const line of rows) {
      if (!line.product_id) continue;
      let adjQty = num(line.adj_qty, 0);
      const reason = String(line.reason || '').trim();
      // VB post: Damage reason always issues stock (negate if still stored positive).
      if (reason.toLowerCase() === 'damage' && adjQty > 0) adjQty = -adjQty;
      if (adjQty === 0) continue;
      await stockRepo.applyStockMovement(client, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        productId: Number(line.product_id),
        transactionType: master.doc_type,
        transactionId: entryId,
        qty: adjQty,
        unitCost: num(line.line_total, 0) && adjQty !== 0
          ? Math.abs(num(line.line_total, 0) / adjQty)
          : 0,
        unitPrice: 0,
        createdBy,
      });
    }
    const posted = await boRepo.postEntry(
      client,
      scope.companyId,
      scope.branchId,
      entryId,
      createdBy,
    );
    if (!posted) {
      const e = new Error('Already posted');
      e.status = 409;
      throw e;
    }
    return { entryId, postStatus: 'POSTED', message: 'Posted successfully  ....' };
  });
}

export async function deleteEntry(pool, id, query, authStaff) {
  const scope = await resolveStationScope(pool, authStaff, query);
  return boService.deleteEntry(pool, id, scope.staff);
}

export { defaultReason, normalizeDocType, DOC };
