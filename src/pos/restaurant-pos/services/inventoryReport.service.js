/**
 * RptInventoryfrm.btnReport_Click → ProductInventory.rpt
 * Pack-qty split matches UniqueMultiProductID / PackQty Desc / remainder Mod.
 */
import * as repo from '../repositories/inventoryReport.repository.js';

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function money(v) {
  return Math.round(num(v) * 100) / 100;
}

function asBool(v) {
  if (v === true || v === 1) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function reportDate() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** VB Int(abs / pack) then negate — trunc toward zero, then remainder Mod. */
function productWiseQty(balQty, packQty) {
  const pack = num(packQty, 0);
  if (pack === 0) return { qty: num(balQty, 0), remainder: 0 };
  const bal = num(balQty, 0);
  if (bal < 0) {
    const qty = -Math.trunc((-bal) / pack);
    return { qty, remainder: bal % pack };
  }
  return { qty: Math.trunc(bal / pack), remainder: bal % pack };
}

function splitPackQty(rawRows, costType, supplierWise) {
  const useLast = String(costType ?? '') === 'LastPurchaseCost';
  const rows = [];
  let uniqueId = null;
  let balQty = 0;

  for (const r of rawRows) {
    const uid = num(r.unique_multi_product_id, 0);
    const onHand = num(r.qty_on_hand, 0);
    if (uniqueId !== uid) {
      uniqueId = uid;
      balQty = onHand;
    }
    const packQty = num(r.pack_qty, 1) || 1;
    const split = productWiseQty(balQty, packQty);
    balQty = split.remainder;

    const unitCost = money(useLast ? r.last_purchase_cost : r.average_cost);
    const unitPrice = money(r.unit_price);
    const qty = split.qty;
    const subSubGroup = supplierWise
      ? String(r.supplier_name ?? '')
      : String(r.sub_sub_group_name ?? '');

    rows.push({
      productId: num(r.product_id, 0),
      uniqueProductId: uid,
      barcode: String(r.barcode ?? ''),
      description: String(r.product_name ?? ''),
      shortDescription: String(r.short_name ?? ''),
      brand: String(r.brand_name ?? ''),
      groupName: String(r.group_name ?? ''),
      subGroup: String(r.sub_group_name ?? ''),
      subSubGroup,
      supplierName: String(r.supplier_name ?? ''),
      unitCost,
      unitPrice,
      packQty,
      qty: onHand,
      productWiseQty: qty,
      amount: money(qty * unitCost),
      location: String(r.location_code ?? ''),
    });
  }
  return rows;
}

/**
 * Stock is per physical branch. On POS, that must be the enrolled till's
 * station_master.branch_id — not the cashier's home branch — so Shop B
 * never lists Shop A inventory (VB used StationID on ProductChild).
 */
async function resolveInventoryScope(pool, authStaff, query = {}) {
  const companyId = num(authStaff?.company_id, 0);
  const stationId = num(authStaff?.station_id, 0) || num(query?.stationId, 0);
  let branchId = 0;
  let branchName = '';
  let stationName = '';
  let stationType = String(authStaff?.station_type || '').trim();

  if (companyId > 0 && stationId > 0) {
    const { rows } = await pool.query(
      `SELECT sm.branch_id,
              COALESCE(sm.station_name, '') AS station_name,
              COALESCE(sm.station_type, '') AS station_type,
              COALESCE(bm.branch_name, '') AS branch_name
         FROM core.station_master sm
         LEFT JOIN core.branch_master bm
           ON bm.company_id = sm.company_id AND bm.branch_id = sm.branch_id
        WHERE sm.company_id = $1
          AND sm.station_id = $2
          AND sm.is_deleted = FALSE
        LIMIT 1`,
      [companyId, stationId],
    );
    if (rows[0]) {
      branchId = num(rows[0].branch_id, 0);
      branchName = String(rows[0].branch_name || '').trim();
      stationName = String(rows[0].station_name || '').trim();
      stationType = String(rows[0].station_type || stationType).trim();
    }
  }

  if (branchId < 1) branchId = num(authStaff?.branch_id, 0);

  const heading4 = [branchName, stationName].filter(Boolean).join('  ·  ');
  return { companyId, branchId, stationId, stationType, heading4 };
}

export async function loadLookups(pool, authStaff, query = {}) {
  const scope = await resolveInventoryScope(pool, authStaff, query);
  if (scope.companyId < 1 || scope.branchId < 1) {
    const err = new Error('Company / branch missing');
    err.status = 400;
    throw err;
  }
  const [lookups, groups] = await Promise.all([
    repo.listLookups(pool, scope.companyId, scope.branchId),
    repo.listCatalogueGroups(pool, scope.companyId, scope.branchId, scope.stationType),
  ]);
  return { ...lookups, groups };
}

export async function buildInventoryReport(pool, query, authStaff) {
  const scope = await resolveInventoryScope(pool, authStaff, query);
  const { companyId, branchId } = scope;
  if (companyId < 1 || branchId < 1) {
    const err = new Error('Company / branch missing');
    err.status = 400;
    throw err;
  }

  const costType = String(query.costType ?? '') === 'LastPurchaseCost'
    ? 'LastPurchaseCost'
    : 'AverageCost';
  const groupWise = asBool(query.groupWise);
  const supplierWise = asBool(query.supplierWise);
  const hidePrice = asBool(query.hidePrice);

  const catalogueGroups = await repo.listCatalogueGroups(
    pool,
    companyId,
    branchId,
    scope.stationType,
  );
  const catalogueGroupIds = catalogueGroups.map((g) => g.id);

  const [raw, headings] = await Promise.all([
    repo.listInventoryStock(pool, companyId, branchId, query, catalogueGroupIds),
    repo.companyHeadings(pool, companyId, authStaff),
  ]);

  const rows = splitPackQty(raw, costType, supplierWise);
  const totals = rows.reduce(
    (acc, r) => {
      acc.count += 1;
      acc.qty += num(r.productWiseQty, 0);
      acc.amount += num(r.amount, 0);
      return acc;
    },
    { count: 0, qty: 0, amount: 0 },
  );
  totals.amount = money(totals.amount);

  const heading3 = `Inventory Report As On ${reportDate()} With ${
    costType === 'LastPurchaseCost' ? 'Last Purchase Cost' : 'Average Cost'
  }`;

  return {
    ok: true,
    reportTitle: 'Product INVENTORY',
    heading1: headings.heading1,
    heading2: headings.heading2,
    heading3,
    heading4: scope.heading4 || headings.heading4,
    costType,
    groupWise,
    supplierWise,
    hidePrice,
    rows,
    totals,
  };
}

function isoDate(raw, fallback) {
  const s = String(raw ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return fallback;
}

function headingDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')}/${months[d.getMonth()]}/${d.getFullYear()}`;
}

/**
 * RptProductMovementRpt — stock ledger from ops.product_log_entry.
 * Opening = on-hand now − period (In − Out) − qty posted after To date.
 * Closing = Opening + In − Out.
 */
export async function buildMovementReport(pool, query, authStaff) {
  const scope = await resolveInventoryScope(pool, authStaff, query);
  const { companyId, branchId } = scope;
  if (companyId < 1 || branchId < 1) {
    const err = new Error('Company / branch missing');
    err.status = 400;
    throw err;
  }

  const today = new Date().toISOString().slice(0, 10);
  let dateFrom = isoDate(query.dateFrom ?? query.fromDate ?? query.from, today);
  let dateTo = isoDate(query.dateTo ?? query.toDate ?? query.to, today);
  if (dateFrom > dateTo) {
    const tmp = dateFrom;
    dateFrom = dateTo;
    dateTo = tmp;
  }

  const catalogueGroups = await repo.listCatalogueGroups(
    pool,
    companyId,
    branchId,
    scope.stationType,
  );
  const catalogueGroupIds = catalogueGroups.map((g) => g.id);
  const filters = { name: query.name ?? query.productName ?? query.q ?? '' };

  const [rawItems, rawLines, headings] = await Promise.all([
    repo.listStockMovementSummary(
      pool,
      companyId,
      branchId,
      dateFrom,
      dateTo,
      filters,
      catalogueGroupIds,
    ),
    repo.listStockMovementLines(
      pool,
      companyId,
      branchId,
      dateFrom,
      dateTo,
      filters,
      catalogueGroupIds,
    ),
    repo.companyHeadings(pool, companyId, authStaff),
  ]);

  const items = rawItems.map((r) => {
    const onHand = money(r.qty_on_hand);
    const inQty = money(r.in_qty);
    const outQty = money(r.out_qty);
    const afterNet = money(r.after_net);
    const opening = money(onHand - (inQty - outQty) - afterNet);
    const closing = money(opening + inQty - outQty);
    return {
      productId: num(r.product_id, 0),
      barcode: String(r.barcode ?? ''),
      description: String(r.product_name ?? ''),
      groupName: String(r.group_name ?? ''),
      opening,
      inQty,
      outQty,
      closing,
    };
  });

  const lines = rawLines.map((r) => {
    const qty = money(r.qty);
    const balance = money(r.balance_qty);
    const opening = money(balance - qty);
    return {
      logId: num(r.product_log_id, 0),
      productId: num(r.product_id, 0),
      barcode: String(r.barcode ?? ''),
      description: String(r.product_name ?? ''),
      groupName: String(r.group_name ?? ''),
      date: r.transaction_date,
      type: String(r.type_label ?? r.transaction_type ?? ''),
      documentNo: String(r.document_no ?? ''),
      opening,
      inQty: qty > 0 ? qty : 0,
      outQty: qty < 0 ? money(Math.abs(qty)) : 0,
      closing: balance,
    };
  });

  const totals = items.reduce(
    (acc, r) => {
      acc.count += 1;
      acc.inQty += r.inQty;
      acc.outQty += r.outQty;
      acc.opening += r.opening;
      acc.closing += r.closing;
      return acc;
    },
    { count: 0, opening: 0, inQty: 0, outQty: 0, closing: 0 },
  );
  totals.opening = money(totals.opening);
  totals.inQty = money(totals.inQty);
  totals.outQty = money(totals.outQty);
  totals.closing = money(totals.closing);

  return {
    ok: true,
    reportTitle: 'Product Movement',
    heading1: headings.heading1,
    heading2: headings.heading2,
    heading3: `Product Movement Details From: ${headingDate(dateFrom)} To: ${headingDate(dateTo)}`,
    heading4: scope.heading4 || headings.heading4,
    dateFrom,
    dateTo,
    name: String(filters.name || '').trim(),
    items,
    lines,
    totals,
  };
}
