import { withTransaction } from '../../../config/db.js';
import * as kotRepo from '../repositories/kot.repository.js';
import { requireChiefCashierOrAdmin } from './adminApproval.service.js';

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

/** KOT header customer: empty/0 → null (no customer); positive = customer id. */
function parseCustomerId(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function itemDgvChildId(it) {
  const raw =
    it.dgvKOTChildID ??
    it.DgvKOTChildID ??
    it.KotChildID ??
    it.KOTChildID ??
    it.kotChildID ??
    it.kotChildId ??
    '';
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 1) return 0;
  return n;
}

function strId(v, fallback = '') {
  return v != null && v !== '' ? String(v) : fallback;
}

function normalizeSupplyType(raw) {
  const u = String(raw ?? '')
    .replace(/_/g, ' ')
    .toUpperCase()
    .trim();
  if (u === 'DELIVERY') return 'DELIVERY';
  if (u === 'PARCEL' || u === 'TAKEAWAY' || u === 'TAKE AWAY') return 'PARCEL';
  if (u === 'DINE IN' || u === 'DINEIN') return 'DINE IN';
  return u;
}

function kotPrintStatus(raw) {
  if (raw === true || raw === 1) return 'PRINTED';
  const u = String(raw ?? '').trim().toUpperCase();
  if (u === 'PRINTED' || u === 'T' || u === 'TRUE' || u === '1') return 'PRINTED';
  return 'PENDING';
}

function closedKotStatus(status) {
  const s = String(status ?? '').trim().toUpperCase();
  return ['SETTLED', 'CANCELLED', 'COMPLETED', 'SUBMIT'].includes(s);
}

/** Mainfrm.SaveBilDetailsToHoldTable: .Remarks = txtRemarks.Text (KOTMaster header). */
function pickHeaderRemarks(body) {
  const raw =
    body?.txtRemarks ??
    body?.HeaderRemarks ??
    body?.headerRemarks ??
    body?.KotRemarks ??
    body?.Remarks ??
    body?.remarks ??
    body?.comments ??
    '';
  return String(raw ?? '').slice(0, 250);
}

function childFieldsFromItem(it) {
  const qty = num(it.Qty ?? it.qty, 1);
  const rate = num(it.UnitPrice ?? it.unitPrice, 0);
  const itemDiscount = num(it.ItemDisc ?? it.ItemDiscount ?? it.itemDiscount, 0);
  const taxP = num(it.TaxPerc ?? it.taxPerc ?? it.Tax1RateC ?? it.tax1RateC ?? it.Tax1Rate, 0);
  const st = num(it.SubTotal ?? it.SubTotalC, qty * rate - itemDiscount);
  const taxA = num(it.TaxAmount ?? it.taxAmount ?? it.Tax1AmountC ?? it.tax1AmountC, st * (taxP / 100));
  const lt = num(it.LineTotal ?? it.lineTotal, st + taxA);
  return {
    productId: parseLong(it.ProductID ?? it.productID),
    barcode: it.BarCode != null ? String(it.BarCode).slice(0, 50) : it.Barcode != null ? String(it.Barcode).slice(0, 50) : null,
    shortDescription: (it.ItemName ?? it.itemName ?? it.ShortDescription ?? '').toString().slice(0, 200) || 'Item',
    qty,
    packQty: num(it.PackQty ?? it.packQty, 1),
    unitCost: num(it.UnitCost ?? it.unitCost, 0),
    unitPrice: rate,
    amount: st,
    itemDiscount,
    subTotal: st,
    lineTotal: lt,
    tax1Amount: taxA,
    tax2Amount: 0,
    tax3Amount: 0,
    tax1Rate: taxP,
    tax2Rate: 0,
    tax3Rate: 0,
    groupId: parseLong(it.dgvGrpID ?? it.GroupID ?? it.groupID) ?? null,
    modifier: (it.Modifir ?? it.Modifier ?? it.modifier ?? '').toString().slice(0, 200),
    kotDisplayStatus: (it.KOTDisplayStatus ?? it.kotDisplayStatus ?? 'PENDING').toString().slice(0, 50),
  };
}

function mapRowToFlutterLine(row) {
  const kmId = row.kot_master_id;
  const prefix = row.kot_prefix ?? '';
  const kotNo = row.kot_number;
  const itemDisc = row.item_discount ?? 0;
  const supply = normalizeSupplyType(row.supply_type);
  return {
    KotMasterID: String(kmId),
    kotMasterID: String(kmId),
    KOTPrefix: prefix,
    KotPrefix: prefix,
    KOTNumber: String(kotNo),
    KotNumber: String(kotNo),
    kotNumber: String(kotNo),
    KotStatus: row.kot_status ?? '',
    KOTStatus: row.kot_status ?? '',
    AreaID: strId(row.area_id),
    areaID: strId(row.area_id),
    AreaName: row.area_name ?? '',
    areaName: row.area_name ?? '',
    SupplyType: supply,
    supplyType: supply,
    TableID: strId(row.table_id),
    tableID: strId(row.table_id),
    TableName: row.table_name ?? '',
    tableName: row.table_name ?? '',
    ChairNo: row.chair_no != null ? String(row.chair_no) : '0',
    chairNo: row.chair_no != null ? String(row.chair_no) : '0',
    CustomerID: strId(row.customer_id),
    customerID: strId(row.customer_id),
    CustomerName: row.customer_name ?? '',
    customerName: row.customer_name ?? '',
    WaiterID: strId(row.waiter_id),
    waiterID: strId(row.waiter_id),
    WaiterName: row.waiter_name ?? '',
    waiterName: row.waiter_name ?? '',
    BillDiscount: String(row.bill_discount ?? 0),
    billDiscount: String(row.bill_discount ?? 0),
    DiscountType: Number(row.discount_type) === 2 ? 2 : 0,
    discountType: Number(row.discount_type) === 2 ? 2 : 0,
    NofCustomer: String(row.nof_customer ?? 0),
    nofCustomer: String(row.nof_customer ?? 0),
    HeaderRemarks: row.remarks ?? '',
    headerRemarks: row.remarks ?? '',
    txtRemarks: row.remarks ?? '',
    KotRemarks: row.remarks ?? '',
    kotRemarks: row.remarks ?? '',
    RoundOffAdj: String(row.round_off_adj ?? 0),
    Amount: String(row.amount ?? 0),
    SubTotalM: String(row.sub_total_m ?? 0),
    Tax1AmountM: String(row.tax1_amount_m ?? 0),
    KotChildID: String(row.kot_child_id),
    kotChildID: String(row.kot_child_id),
    KOTChildID: String(row.kot_child_id),
    dgvKOTChildID: String(row.kot_child_id),
    ProductID: strId(row.product_id),
    productID: strId(row.product_id),
    Qty: String(row.qty),
    qty: String(row.qty),
    UnitPrice: String(row.unit_price),
    unitPrice: String(row.unit_price),
    UnitCost: String(row.unit_cost ?? 0),
    PackQty: String(row.pack_qty ?? 1),
    ItemDiscount: String(itemDisc),
    ItemDisc: String(itemDisc),
    itemDiscount: String(itemDisc),
    SubTotal: String(row.sub_total ?? 0),
    SubTotalC: String(row.sub_total ?? 0),
    Tax1RateC: String(row.tax_1_rate ?? 0),
    tax1RateC: String(row.tax_1_rate ?? 0),
    TaxPerc: String(row.tax_1_rate ?? 0),
    Tax1AmountC: String(row.tax_1_amount ?? 0),
    tax1AmountC: String(row.tax_1_amount ?? 0),
    TaxAmount: String(row.tax_1_amount ?? 0),
    LineTotal: String(row.line_total ?? 0),
    lineTotal: String(row.line_total ?? 0),
    ShortDescription: row.short_description ?? '',
    ItemName: row.short_description ?? '',
    BarCode: row.barcode ?? '',
    Barcode: row.barcode ?? '',
    GroupID: row.group_id != null ? String(row.group_id) : '0',
    groupID: row.group_id != null ? String(row.group_id) : '0',
    Modifier: row.modifier ?? '',
    Modifir: row.modifier ?? '',
    Remarks: row.modifier ?? '',
    KOTDisplayStatus: row.kot_display_status ?? 'PENDING',
    kotDisplayStatus: row.kot_display_status ?? 'PENDING',
    Androidprint: kotPrintStatus(row.android_printed),
    AndroidPrint: kotPrintStatus(row.android_printed),
    UniqueProductID: '0',
    ItemCode: '',
    DescriptionArabic: '',
  };
}

export async function buildKotDetailsPayload(executor, companyId, kotMasterId) {
  const rows = await kotRepo.listKotDetailRows(executor, companyId, kotMasterId);
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const id = Number(row.kot_child_id);
    if (Number.isFinite(id) && id > 0) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    unique.push(row);
  }
  const data = unique.map(mapRowToFlutterLine);
  return { success: true, data };
}

async function areaKotPrefix(client, companyId, stationId, areaId) {
  const area = await kotRepo.findArea(client, companyId, stationId, areaId);
  const p = area?.kot_prefix;
  return p != null ? String(p).trim() : '';
}

/**
 * Legacy POS payload: mfAreaId, mfTableID, mfChairNo, mfCustomerID, StationID, Items[], lblSubTotalAmt, lblTax1Total, lblBillTotal,
 * optional CurrentKOTID, mfKotPrefix, mfKotNo for append.
 *
 * Mirrors Mainfrm.SaveBilDetailsToHoldTable + KOTChildInsert:
 *   new KOT  → insert master + insert every grid row
 *   existing → update master header, insert rows with dgvKOTChildID=0, update the rest
 */
export async function saveKot(pool, body, authStaff, access = null) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const stationId = num(body.StationID ?? body.branchId ?? authStaff.station_id ?? authStaff.branch_id, 0);
  if (stationId < 1) {
    const err = new Error('StationID / branchId is required');
    err.status = 400;
    throw err;
  }
  const { rows: stnRows } = await pool.query(
    `SELECT 1 FROM core.station_master WHERE company_id = $1 AND station_id = $2 AND is_deleted = FALSE LIMIT 1`,
    [companyId, stationId]
  );
  if (!stnRows.length) {
    const err = new Error('Invalid station for this company');
    err.status = 400;
    throw err;
  }

  const items = Array.isArray(body.Items) ? body.Items : Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    const err = new Error('Enter Atleast One Item details...........');
    err.status = 400;
    throw err;
  }

  const currentKotId = num(body.CurrentKOTID ?? body.currentKOTID ?? body.currentKotId, 0);
  const isAppend = currentKotId > 0;
  const canSaveWithoutArea =
    isAppend ||
    access?.meta?.source === 'legacy-fallback' ||
    access?.features?.['pos.kot.save_without_area'] === true;

  const areaId = num(body.mfAreaId ?? body.AreaID ?? body.areaId, 0);
  if (areaId < 1 && !canSaveWithoutArea) {
    const err = new Error('Please Select An Area...........');
    err.status = 400;
    throw err;
  }

  const tableId = num(body.mfTableID ?? body.TableID ?? body.tableId, 0);
  const chairNo = num(body.mfChairNo ?? body.ChairNo ?? body.chairNo, 0);
  const customerId = parseCustomerId(body.mfCustomerID ?? body.CustomerID ?? body.customerId);
  const waiterFromBody = parseLong(body.mfWaiterID ?? body.WaiterID ?? body.waiterId);
  const waiterId =
    waiterFromBody ??
    (authStaff.staff_id != null ? Number(authStaff.staff_id) : null) ??
    (authStaff.id != null ? Number(authStaff.id) : null);

  const lblSub = num(body.lblSubTotalAmt, 0);
  const lblTax1 = num(body.lblTax1Total, 0);
  const lblTotal = num(body.lblBillTotal, 0);
  const billDiscount = num(body.txtDiscount ?? body.BillDiscount ?? body.billDiscount, 0);
  const discountType = Number(body.DiscountType ?? body.discountType) === 2 ? 2 : 0;
  const nofCustomer = num(body.txtNoofCustomer ?? body.NofCustomer ?? body.nofCustomer, 0);
  const remarks = pickHeaderRemarks(body);

  const waiterMandatory = num(body.ISWaiterMandatory ?? body.ISWaiterMandotory, 0) === 1;
  const auditBy = parseLong(authStaff.staff_id) ?? parseLong(authStaff.id) ?? null;

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.kot_save:${companyId}`,
    ]);

    const area = areaId > 0 ? await kotRepo.findArea(client, companyId, stationId, areaId) : null;
    const supplyType = normalizeSupplyType(area?.supply_type);

    if (supplyType === 'DELIVERY' && customerId == null) {
      const err = new Error('Select a Customer...........');
      err.status = 400;
      throw err;
    }

    if (supplyType === 'DINE IN' && waiterMandatory) {
      if (!(waiterId > 0)) {
        const err = new Error('Select a Waiter. . . .');
        err.status = 400;
        throw err;
      }
    }

    const tableCreationType = area?.table_creation_type != null ? Number(area.table_creation_type) : 0;
    if (areaId > 0 && tableCreationType === 0) {
      if (tableId <= 0) {
        const err = new Error('Please Select A Table...........');
        err.status = 400;
        throw err;
      }
      if (chairNo < 0) {
        const err = new Error('Please Select A Chair...........');
        err.status = 400;
        throw err;
      }
    }

    const conflict = await kotRepo.findActiveTableChairConflict(client, {
      companyId,
      stationId,
      areaId,
      tableId,
      chairNo,
      excludeKotMasterId: isAppend ? currentKotId : 0,
    });
    if (conflict) {
      const kotRef = `${conflict.kot_prefix ?? ''}${conflict.kot_number ?? ''}`;
      const tableDisplay = (conflict.table_name || 'This table').trim();
      const waiterName = (conflict.waiter_name || 'Unknown').trim();
      const chairPart = chairNo > 0 ? ` (Chair ${chairNo})` : '';
      const err = new Error(
        `${tableDisplay}${chairPart} already has an active order (${kotRef}) under waiter : ${waiterName}.  select another table/chair.`
      );
      err.status = 409;
      throw err;
    }

    let kotMasterId;
    let newKotChildIds = [];
    let prefix = (body.mfKotPrefix ?? area?.kot_prefix ?? '').toString().trim();

    const tax1RateM = num(body.gvTax1Percentage ?? body.Tax1RateM ?? body.tax1RateM, 0);
    const headerCommon = {
      customerId,
      areaId: areaId > 0 ? areaId : 0,
      tableId: tableId > 0 ? tableId : 0,
      chairNo,
      waiterId: Number.isFinite(waiterId) && waiterId > 0 ? waiterId : null,
      billDiscount,
      discountType,
      amount: lblTotal,
      subTotalM: lblSub,
      tax1AmountM: lblTax1,
      tax1RateM,
      roundOffAdj: num(body.lblRound, 0),
      nofCustomer,
      remarks,
    };

    async function persistChild(it, masterId) {
      const fields = childFieldsFromItem(it);
      const existingId = itemDgvChildId(it);
      if (existingId > 0 && isAppend) {
        await kotRepo.updateKotChild(client, {
          companyId,
          kotChildId: existingId,
          kotMasterId: masterId,
          ...fields,
          modifiedBy: auditBy,
        });
        return existingId;
      }
      const kotChildId = await kotRepo.nextKotChildId(client, companyId);
      await kotRepo.insertKotChild(client, {
        companyId,
        branchId,
        stationId,
        kotChildId,
        kotMasterId: masterId,
        ...fields,
        createdBy: auditBy,
        modifiedBy: auditBy,
      });
      newKotChildIds.push(kotChildId);
      return kotChildId;
    }

    if (isAppend) {
      const master = await kotRepo.findKotMaster(client, companyId, currentKotId);
      if (!master) {
        const err = new Error('KOT not found');
        err.status = 404;
        throw err;
      }
      const masterStation = Number(master.station_id) || 0;
      const masterBranch = Number(master.branch_id) || 0;
      if (
        masterStation !== stationId &&
        masterBranch !== stationId &&
        masterBranch !== branchId
      ) {
        const err = new Error('KOT belongs to a different branch');
        err.status = 400;
        throw err;
      }
      if (closedKotStatus(master.kot_status)) {
        const err = new Error('KOT already settled');
        err.status = 400;
        throw err;
      }
      kotMasterId = currentKotId;
      if (!prefix) prefix = master.kot_prefix ?? '';

      await kotRepo.updateKotMasterHeader(client, {
        companyId,
        kotMasterId,
        kotPrefix: prefix.slice(0, 50),
        ...headerCommon,
        modifiedBy: auditBy,
      });

      const seenChildIds = new Set();
      for (const it of items) {
        const existingId = itemDgvChildId(it);
        if (existingId > 0) {
          if (seenChildIds.has(existingId)) continue;
          seenChildIds.add(existingId);
        }
        await persistChild(it, kotMasterId);
      }

      await kotRepo.updateKotMasterTotals(client, companyId, kotMasterId, auditBy, tax1RateM);
    } else {
      kotMasterId = await kotRepo.nextKotMasterId(client, companyId);

      if (!prefix) {
        prefix = await areaKotPrefix(client, companyId, stationId, areaId);
      }
      const kotNumber = await kotRepo.nextKotNumber(client, companyId, stationId, prefix);

      await kotRepo.insertKotMaster(client, {
        companyId,
        branchId,
        stationId,
        kotMasterId,
        kotNumber,
        kotPrefix: prefix.slice(0, 50),
        kotStatus: 'HOLD',
        ...headerCommon,
        tax2AmountM: 0,
        tax3AmountM: 0,
        tax2RateM: 0,
        tax3RateM: 0,
        createdBy: auditBy,
        modifiedBy: auditBy,
      });

      const seenChildIds = new Set();
      for (const it of items) {
        const existingId = itemDgvChildId(it);
        if (existingId > 0) {
          if (seenChildIds.has(existingId)) continue;
          seenChildIds.add(existingId);
        }
        await persistChild(it, kotMasterId);
      }

      await kotRepo.updateKotMasterTotals(client, companyId, kotMasterId, auditBy, tax1RateM);
    }

    const kotDetails = await buildKotDetailsPayload(client, companyId, kotMasterId);

    return {
      ok: true,
      msg: 'KOT saved successfully.',
      CurrentKOTID: String(kotMasterId),
      KotPrefix: prefix,
      KotNumber: kotDetails.data?.[0]?.KotNumber ?? '',
      newKotChildIds: newKotChildIds.map(String),
      kotDetails,
    };
  });
}

export async function listKots(pool, authStaff, query = {}) {
  const companyId = Number(authStaff.company_id);
  const stationId = Number(authStaff.station_id ?? authStaff.branch_id);
  const areaId = query.areaId != null ? Number(query.areaId) : null;
  const kotNumberSearch = query.search ?? query.jobNo ?? null;
  const supplyType = query.supplyType ?? query.SupplyType ?? null;
  const joinListRaw = query.joinList ?? query.forJoin ?? query.JoinList;
  const joinList =
    joinListRaw === true ||
    joinListRaw === 1 ||
    String(joinListRaw ?? '').toLowerCase() === '1' ||
    String(joinListRaw ?? '').toLowerCase() === 'true';
  const kotExactRaw = query.kotExact ?? query.KotExact;
  const kotExact =
    joinList ||
    kotExactRaw === true ||
    kotExactRaw === 1 ||
    String(kotExactRaw ?? '').toLowerCase() === '1' ||
    String(kotExactRaw ?? '').toLowerCase() === 'true';

  const rows = await kotRepo.listOpenKots(pool, companyId, stationId, {
    areaId,
    kotNumberSearch,
    supplyType,
    joinList,
    kotExact,
  });
  const data = rows.map((r) => {
    const net = Number(r.amount ?? 0) - Number(r.bill_discount ?? 0);
    const supply = normalizeSupplyType(r.supply_type);
    return {
      kotMasterID: String(r.kot_master_id),
      KotMasterID: String(r.kot_master_id),
      KotNumber: String(r.kot_number),
      KotPrefix: r.kot_prefix ?? '',
      KotStatus: r.kot_status ?? '',
      KotTime: r.kot_time ? r.kot_time.toISOString() : null,
      Amount: String(r.amount ?? 0),
      BillDiscount: String(r.bill_discount ?? 0),
      NetAmount: String(net),
      ChairNo: String(r.chair_no ?? 0),
      AreaID: r.area_id != null ? String(r.area_id) : '',
      AreaName: r.area_name ?? '',
      TableID: r.table_id != null ? String(r.table_id) : '',
      TableName: r.table_name ?? '',
      TableNo: r.table_no != null ? String(r.table_no) : '',
      SupplyType: supply,
      CustomerID: r.customer_id != null ? String(r.customer_id) : '',
      CustomerName: r.customer_name ?? '',
      WaiterID: r.waiter_id != null ? String(r.waiter_id) : '',
      WaiterName: r.waiter_name ?? '',
      NofCustomer: String(r.nof_customer ?? 0),
      Remarks: r.remarks ?? '',
      remarks: r.remarks ?? '',
      txtRemarks: r.remarks ?? '',
      HeaderRemarks: r.remarks ?? '',
    };
  });
  return { ok: true, data };
}

export async function getKot(pool, authStaff, kotMasterIdRaw) {
  const companyId = Number(authStaff.company_id);
  const kotMasterId = Number(kotMasterIdRaw);
  if (!Number.isFinite(kotMasterId) || kotMasterId < 1) {
    const err = new Error('Invalid kotMasterId');
    err.status = 400;
    throw err;
  }
  const master = await kotRepo.findKotMaster(pool, companyId, kotMasterId);
  if (!master) {
    const err = new Error('KOT not found');
    err.status = 404;
    throw err;
  }
  return buildKotDetailsPayload(pool, companyId, kotMasterId);
}

function bad(message, status = 400, code = null) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

async function loadOpenKot(client, companyId, kotMasterId) {
  if (!Number.isFinite(kotMasterId) || kotMasterId < 1) {
    throw bad('Please Select A KOT.......', 400, 'NO_KOT');
  }
  const master = await kotRepo.findKotMaster(client, companyId, kotMasterId);
  if (!master) throw bad('KOT not found', 404, 'NOT_FOUND');
  if (closedKotStatus(master.kot_status)) {
    throw bad('KOT already settled', 400, 'KOT_CLOSED');
  }
  return master;
}

function remainingAmount(children, removeIds) {
  let amount = 0;
  for (const row of children) {
    if (removeIds.has(Number(row.kot_child_id))) continue;
    amount += Number(row.line_total ?? 0);
  }
  return amount;
}

/**
 * btnBillCancel_Click:
 *   admin gate → confirm (UI) → KotStatus='CANCELLED' → print (client) → delete KOTMaster
 */
export async function cancelKot(pool, authStaff, kotMasterIdRaw, body = {}) {
  const companyId = Number(authStaff.company_id);
  const kotMasterId = Number(kotMasterIdRaw);
  const auditBy = parseLong(authStaff.staff_id) ?? parseLong(authStaff.id);

  await requireChiefCashierOrAdmin(authStaff, body);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.kot_cancel:${companyId}:${kotMasterId}`,
    ]);

    const master = await loadOpenKot(client, companyId, kotMasterId);
    const kotRef = `${master.kot_prefix ?? ''}${master.kot_number ?? ''}`;

    await kotRepo.updateKotStatus(client, companyId, kotMasterId, 'CANCELLED', auditBy);
    const deleted = await kotRepo.deleteKotMaster(client, companyId, kotMasterId);
    if (!(deleted > 0)) {
      throw bad('Unable To Cancel KOT', 500, 'DELETE_FAILED');
    }

    return {
      ok: true,
      msg: 'KOT Cancelled...............',
      CurrentKOTID: 0,
      kotMasterId,
      kotRef,
    };
  });
}

/**
 * ItemRemovefrm.btnremove_Click + deleteItemClearTable:
 *   admin gate → cannot remove last/all → ItemClearTable insert → DELETE KOTChild → recalc amount
 */
export async function cancelKotItems(pool, authStaff, kotMasterIdRaw, body = {}) {
  const companyId = Number(authStaff.company_id);
  const kotMasterId = Number(kotMasterIdRaw);
  const auditBy = parseLong(authStaff.staff_id) ?? parseLong(authStaff.id);
  const cashierId = parseLong(authStaff.staff_id) ?? parseLong(authStaff.id);
  const counterNo = num(body.gvCounterNo ?? body.counterNo, Number(authStaff.station_id) || 1);

  const approval = await requireChiefCashierOrAdmin(authStaff, body);

  const requested = Array.isArray(body.kotChildIds ?? body.items)
    ? (body.kotChildIds ?? body.items)
    : [];
  const removeIds = new Set(
    requested
      .map((v) => {
        if (v && typeof v === 'object') return Number(v.kotChildId ?? v.KotChildID ?? v.dgvKOTChildID);
        return Number(v);
      })
      .filter((n) => Number.isFinite(n) && n > 0),
  );

  if (!removeIds.size) {
    throw bad('Select an Item. . .', 400, 'NO_SELECTION');
  }

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.kot_cancel:${companyId}:${kotMasterId}`,
    ]);

    const master = await loadOpenKot(client, companyId, kotMasterId);
    const children = await kotRepo.listKotChildren(client, companyId, kotMasterId);
    if (!children.length) {
      throw bad('NO Item for KOT', 400, 'NO_ITEMS');
    }
    if (children.length === 1) {
      throw bad('Only one item Remains in KOT.You have to make BILL CANCEL.......', 400, 'LAST_ITEM');
    }

    const byId = new Map(children.map((r) => [Number(r.kot_child_id), r]));
    const toRemove = [];
    for (const id of removeIds) {
      const row = byId.get(id);
      if (!row) throw bad('Select an Item. . .', 400, 'NO_SELECTION');
      toRemove.push(row);
    }
    if (toRemove.length >= children.length) {
      throw bad('All Items Cannot Remove..Make Cancel Bill. . .', 400, 'ALL_ITEMS');
    }

    const branchId = await kotRepo.resolveItemClearBranchId(
      client,
      companyId,
      master.station_id ?? authStaff.station_id,
      master.branch_id ?? authStaff.branch_id,
    );

    for (const row of toRemove) {
      await kotRepo.insertItemClear(client, {
        companyId,
        branchId,
        productId: row.product_id,
        cashierId,
        supervisorId: approval.supervisorId,
        counterNo,
        billNo: kotMasterId,
        barcode: row.barcode ?? '',
        description: String(row.short_description ?? '').replace(/['",]/g, ':'),
        groupId: row.group_id,
        qty: row.qty,
        unitCost: row.unit_cost,
        unitPrice: row.unit_price,
        lineTotal: row.line_total,
      });
      await kotRepo.deleteKotChild(
        client,
        companyId,
        kotMasterId,
        Number(row.kot_child_id),
        row.product_id,
      );
    }

    const amount = remainingAmount(children, removeIds);
    const discountType = Number(masterDiscountType(await kotRepo.findKotMaster(client, companyId, kotMasterId)));
    let discountReset = false;
    if (discountType === 0) {
      await kotRepo.resetKotDiscount(client, companyId, kotMasterId, amount, auditBy);
      discountReset = true;
    } else {
      await kotRepo.updateKotAmount(client, companyId, kotMasterId, amount, auditBy);
    }
    await kotRepo.updateKotMasterTotals(client, companyId, kotMasterId, auditBy);

    const kotDetails = await buildKotDetailsPayload(client, companyId, kotMasterId);
    return {
      ok: true,
      msg: discountReset ? 'Discount Reset....... ' : 'Item cancelled',
      discountReset,
      CurrentKOTID: String(kotMasterId),
      kotMasterId,
      kotDetails,
    };
  });
}

function masterDiscountType(master) {
  if (!master) return 0;
  const raw = master.discount_type ?? master.DiscountType;
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function qtyChangeAmounts(row, newQty) {
  const unitPrice = num(row.unit_price, 0);
  const oldQty = num(row.qty, 0);
  const oldGross = unitPrice * oldQty;
  const discPerc = oldGross > 0 ? (num(row.item_discount, 0) / oldGross) * 100 : 0;
  const taxRate = num(row.tax_1_rate, 0);
  const itemDiscount = roundMoney(unitPrice * newQty * (discPerc / 100));
  const subTotal = roundMoney(unitPrice * newQty - itemDiscount);
  const tax1Amount = roundMoney(subTotal * (taxRate / 100));
  return {
    itemDiscount,
    subTotal,
    tax1Amount,
    lineTotal: roundMoney(subTotal + tax1Amount),
  };
}

/**
 * ItemRemovefrm.btnDone_Click + InsertItemClearTable:
 *   admin → Invalid Qty if <= 0 → ItemClear of reduced qty → UPDATE KOTChild amounts
 */
export async function updateKotItemQty(pool, authStaff, kotMasterIdRaw, body = {}) {
  const companyId = Number(authStaff.company_id);
  const kotMasterId = Number(kotMasterIdRaw);
  const auditBy = parseLong(authStaff.staff_id) ?? parseLong(authStaff.id);
  const cashierId = parseLong(authStaff.staff_id) ?? parseLong(authStaff.id);
  const counterNo = num(body.gvCounterNo ?? body.counterNo, Number(authStaff.station_id) || 1);
  const kotChildId = Number(body.kotChildId ?? body.KotChildID ?? body.dgvKOTChildID);
  const newQty = num(body.qty ?? body.Qty ?? body.newQty ?? body.txtNewQty, 0);

  const approval = await requireChiefCashierOrAdmin(authStaff, body);

  if (!Number.isFinite(kotChildId) || kotChildId < 1) {
    throw bad('Select an Item. . .', 400, 'NO_SELECTION');
  }
  if (!(newQty > 0)) {
    throw bad('Invalid Qty. . .', 400, 'INVALID_QTY');
  }

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.kot_cancel:${companyId}:${kotMasterId}`,
    ]);

    const master = await loadOpenKot(client, companyId, kotMasterId);
    const children = await kotRepo.listKotChildren(client, companyId, kotMasterId);
    const row = children.find((r) => Number(r.kot_child_id) === kotChildId);
    if (!row) throw bad('Select an Item. . .', 400, 'NO_SELECTION');

    const oldQty = num(row.qty, 0);
    if (oldQty > newQty) {
      const branchId = await kotRepo.resolveItemClearBranchId(
        client,
        companyId,
        master.station_id ?? authStaff.station_id,
        master.branch_id ?? authStaff.branch_id,
      );
      const diff = roundMoney(oldQty - newQty);
      await kotRepo.insertItemClear(client, {
        companyId,
        branchId,
        productId: row.product_id,
        cashierId,
        supervisorId: approval.supervisorId,
        counterNo,
        billNo: kotMasterId,
        barcode: row.barcode ?? '',
        description: String(row.short_description ?? '').replace(/['",]/g, ':'),
        groupId: row.group_id,
        qty: diff,
        unitCost: row.unit_cost,
        unitPrice: row.unit_price,
        lineTotal: roundMoney(num(row.unit_price, 0) * diff),
      });
    }

    const amounts = qtyChangeAmounts(row, newQty);
    await kotRepo.updateKotChildQty(client, {
      companyId,
      kotMasterId,
      kotChildId,
      qty: newQty,
      itemDiscount: amounts.itemDiscount,
      subTotal: amounts.subTotal,
      tax1Amount: amounts.tax1Amount,
      lineTotal: amounts.lineTotal,
      modifiedBy: auditBy,
    });
    await kotRepo.updateKotMasterTotals(client, companyId, kotMasterId, auditBy);

    const kotDetails = await buildKotDetailsPayload(client, companyId, kotMasterId);
    return {
      ok: true,
      msg: 'Quantity Change',
      CurrentKOTID: String(kotMasterId),
      kotMasterId,
      kotDetails,
    };
  });
}

/** ItemRemovefrm.btnNoOfCust_Click */
export async function updateKotCovers(pool, authStaff, kotMasterIdRaw, body = {}) {
  const companyId = Number(authStaff.company_id);
  const kotMasterId = Number(kotMasterIdRaw);
  const auditBy = parseLong(authStaff.staff_id) ?? parseLong(authStaff.id);
  const nofCustomer = Math.trunc(num(body.nofCustomer ?? body.NofCustomer ?? body.covers, 0));
  if (nofCustomer <= 0) {
    throw bad('Invalid Qty. . .', 400, 'INVALID_COVERS');
  }

  return withTransaction(async (client) => {
    await loadOpenKot(client, companyId, kotMasterId);
    await kotRepo.updateKotNofCustomer(client, companyId, kotMasterId, nofCustomer, auditBy);
    return { ok: true, nofCustomer, CurrentKOTID: String(kotMasterId) };
  });
}

function areaChangeJoinable(status) {
  const s = String(status ?? '').trim().toUpperCase();
  return s !== 'CANCELLED' && s !== 'COMPLETED';
}

function tableDisplay(row) {
  if (!row) return '';
  const tno = String(row.table_no ?? '').trim();
  const tname = String(row.table_name ?? '').trim();
  if (tno && tname) return `T${tno} - ${tname}`;
  if (tno) return `T${tno}`;
  if (tname) return tname;
  return `TableID ${row.table_id}`;
}

/**
 * TableFloorRuntimeFrmAreaChange.UpdateKotTable:
 * occupied select → vacant confirm → UPDATE KOTMaster.TableId + AreaID (ChairNo kept).
 */
export async function changeKotTable(pool, authStaff, kotMasterIdRaw, body = {}) {
  const companyId = Number(authStaff.company_id);
  const stationId = Number(authStaff.station_id ?? authStaff.branch_id);
  const auditBy = parseLong(authStaff.staff_id) ?? parseLong(authStaff.id);
  const kotMasterId = Number(kotMasterIdRaw);
  const newTableId = Math.trunc(num(body.tableId ?? body.TableId ?? body.newTableId, 0));
  const newAreaId = Math.trunc(num(body.areaId ?? body.AreaID ?? body.newAreaId, 0));

  if (!Number.isFinite(kotMasterId) || kotMasterId < 1) {
    throw bad('Please Select A KOT.......', 400, 'NO_KOT');
  }
  if (newTableId < 1) throw bad('Select a vacant table.', 400, 'NO_TABLE');
  if (newAreaId < 1) throw bad('Select an area.', 400, 'NO_AREA');

  return withTransaction(async (client) => {
    const master = await kotRepo.findKotMaster(client, companyId, kotMasterId);
    if (!master) throw bad('KOT not found', 404, 'NOT_FOUND');
    if (Number(master.station_id) !== stationId) {
      throw bad('KOT not found', 404, 'NOT_FOUND');
    }
    if (!areaChangeJoinable(master.kot_status)) {
      throw bad(`KOT ${kotRefNo(master) || kotMasterId} is ${master.kot_status}`, 400, 'KOT_STATUS');
    }

    const destArea = await kotRepo.findArea(client, companyId, stationId, newAreaId);
    if (!destArea) throw bad('Invalid Area...', 404, 'AREA');
    if (Number(destArea.table_creation_type) !== 0) {
      throw bad('Select a Manual table area.', 400, 'AREA_TYPE');
    }

    const destTable = await kotRepo.findTable(client, companyId, stationId, newTableId);
    if (!destTable) throw bad('Table not Found. . .', 404, 'TABLE');
    if (Number(destTable.area_id) !== newAreaId) {
      throw bad('Table does not belong to this area.', 400, 'TABLE_AREA');
    }

    const occupying = await kotRepo.findActiveKotOnTable(
      client,
      companyId,
      stationId,
      newTableId,
      kotMasterId,
    );
    if (occupying) {
      throw bad('Table is occupied.', 400, 'TABLE_OCCUPIED');
    }

    const updated = await kotRepo.updateKotAreaTable(
      client,
      companyId,
      stationId,
      kotMasterId,
      newTableId,
      newAreaId,
      auditBy,
    );
    if (!updated) throw bad('Transfer failed.', 400, 'TRANSFER_FAILED');

    const fromArea = await kotRepo.findArea(client, companyId, stationId, master.area_id);
    const fromTable = await kotRepo.findTable(client, companyId, stationId, master.table_id);

    return {
      ok: true,
      CurrentKOTID: String(kotMasterId),
      KotMasterID: String(kotMasterId),
      AreaID: String(newAreaId),
      AreaName: destArea.area_name ?? '',
      TableID: String(newTableId),
      TableName: destTable.table_name ?? '',
      TableNo: destTable.table_no != null ? String(destTable.table_no) : '',
      FromAreaID: master.area_id != null ? String(master.area_id) : '',
      FromAreaName: fromArea?.area_name ?? '',
      FromTableID: master.table_id != null ? String(master.table_id) : '',
      FromTableDisplay: tableDisplay(fromTable),
      ToTableDisplay: tableDisplay(destTable),
      ChairNo: String(master.chair_no ?? 0),
    };
  });
}

function kotRefNo(row) {
  if (!row) return '';
  return `${row.kot_prefix ?? ''}${row.kot_number ?? ''}`;
}

function joinableStatus(status) {
  const s = String(status ?? '').trim().toUpperCase();
  return s !== 'CANCELLED' && s !== 'COMPLETED';
}

/**
 * KotJoinFrm.Join_Save_OldStyle:
 *   1) UPDATE target KOTMaster AreaID/TableID/NofCustomer (station scoped)
 *   2) UPDATE KOTChild SET KotMasterID = target WHERE KotMasterID IN delList
 *   3) DELETE other KOTMaster rows (station scoped)
 *   4) Recalc SubTotalM / Tax1AmountM / Amount from children
 */
export async function joinKots(pool, authStaff, body = {}) {
  const companyId = Number(authStaff.company_id);
  const stationId = Number(authStaff.station_id ?? authStaff.branch_id);
  const auditBy = parseLong(authStaff.staff_id) ?? parseLong(authStaff.id);
  const targetKotId = parseLong(body.targetKotId ?? body.TargetKotId ?? body.targetKotMasterId);
  const rawSources = Array.isArray(body.sourceKotIds)
    ? body.sourceKotIds
    : Array.isArray(body.SourceKotIds)
      ? body.SourceKotIds
      : [];
  const sourceKotIds = [
    ...new Set(rawSources.map((id) => parseLong(id)).filter((id) => id != null && id !== targetKotId)),
  ];
  const targetAreaId = Math.trunc(num(body.targetAreaId ?? body.TargetAreaId ?? body.areaId, 0));
  const targetTableId = Math.trunc(num(body.targetTableId ?? body.TargetTableId ?? body.tableId, 0));
  let finalPax = Math.trunc(num(body.finalPax ?? body.FinalPax ?? body.nofCustomer, 0));

  if (!targetKotId) {
    throw bad('Select minimum 2 KOTs to Join.', 400, 'JOIN_TARGET');
  }
  if (sourceKotIds.length < 1) {
    throw bad('Nothing to JOIN.', 400, 'JOIN_NONE');
  }
  if (sourceKotIds.length + 1 < 2) {
    throw bad('Select minimum 2 KOTs to Join.', 400, 'JOIN_MIN');
  }
  if (finalPax <= 0) finalPax = 1;

  try {
    return await withTransaction(async (client) => {
      const allIds = [targetKotId, ...sourceKotIds];
      const masters = await kotRepo.findKotMastersByIds(client, companyId, stationId, allIds);
      if (!masters.some((m) => Number(m.kot_master_id) === targetKotId)) {
        throw bad('JOIN Failed: Target KOT not found', 404, 'JOIN_TARGET_MISSING');
      }
      for (const id of allIds) {
        const row = masters.find((m) => Number(m.kot_master_id) === id);
        if (!row) {
          throw bad(`JOIN Failed: KOT ${id} not found`, 404, 'JOIN_MISSING');
        }
        if (!joinableStatus(row.kot_status)) {
          throw bad(`JOIN Failed: KOT ${kotRefNo(row) || id} is ${row.kot_status}`, 400, 'JOIN_STATUS');
        }
      }

      const updated = await kotRepo.updateKotMasterJoinTarget(
        client,
        companyId,
        stationId,
        targetKotId,
        targetAreaId,
        targetTableId,
        finalPax,
        auditBy,
      );
      if (!updated) {
        throw bad('JOIN Failed: Target KOT not found', 404, 'JOIN_TARGET_MISSING');
      }

      await kotRepo.reassignKotChildren(client, companyId, targetKotId, sourceKotIds, auditBy);
      await kotRepo.deleteKotMastersOnly(client, companyId, stationId, sourceKotIds);
      const totals = await kotRepo.updateKotMasterTotals(client, companyId, targetKotId, auditBy);

      return {
        ok: true,
        msg: 'Bill Joined Successfully.',
        CurrentKOTID: String(targetKotId),
        targetKotId,
        sourceKotIds,
        targetAreaId,
        targetTableId,
        finalPax,
        ...totals,
      };
    });
  } catch (err) {
    if (err.status) throw err;
    throw bad(`JOIN Failed: ${err.message}`, 500, 'JOIN_FAILED');
  }
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function rowDec(row, ...keys) {
  for (const key of keys) {
    if (row && row[key] != null && row[key] !== '') {
      const n = Number(row[key]);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

async function splitMoveChildRow(client, {
  companyId,
  sourceKotId,
  newKotId,
  sourceKotChildId,
  splitQty,
  splitSubTotal,
  splitTax1Amount,
  splitLineTotal,
  auditBy,
  stationId,
  branchId,
}) {
  if (!(sourceKotChildId > 0) || !(splitQty > 0)) {
    throw bad('Invalid split item qty.', 400, 'SPLIT_QTY');
  }
  const src = await kotRepo.findKotChild(client, companyId, sourceKotId, sourceKotChildId);
  if (!src) {
    throw bad(`Split item not found. KotChildID: ${sourceKotChildId}`, 400, 'SPLIT_ITEM');
  }
  const dbQty = Number(src.qty) || 0;
  if (dbQty <= 0) {
    throw bad(`Invalid source item qty. KotChildID: ${sourceKotChildId}`, 400, 'SPLIT_SRC_QTY');
  }
  if (splitQty > dbQty + 1e-9) {
    throw bad(`Split qty is greater than source qty. KotChildID: ${sourceKotChildId}`, 400, 'SPLIT_QTY_GT');
  }

  if (splitQty >= dbQty) {
    await kotRepo.moveKotChildToMaster(client, companyId, sourceKotChildId, sourceKotId, newKotId, auditBy);
    return;
  }

  const ratio = splitQty / dbQty;
  const splitAmount = round2(rowDec(src, 'amount') * ratio);
  const splitDiscount = round2(rowDec(src, 'item_discount') * ratio);
  const splitTax2Amount = round2(rowDec(src, 'tax_2_amount') * ratio);
  const splitTax3Amount = round2(rowDec(src, 'tax_3_amount') * ratio);
  let sub = Number(splitSubTotal) || 0;
  let tax1 = Number(splitTax1Amount) || 0;
  let line = Number(splitLineTotal) || 0;
  if (sub <= 0) sub = round2(rowDec(src, 'sub_total') * ratio);
  if (tax1 <= 0) tax1 = round2(rowDec(src, 'tax_1_amount') * ratio);
  if (line <= 0) line = round2(rowDec(src, 'line_total') * ratio);

  await kotRepo.updateKotChildSplitRemain(client, {
    companyId,
    kotMasterId: sourceKotId,
    kotChildId: sourceKotChildId,
    qty: dbQty - splitQty,
    amount: round2(rowDec(src, 'amount') - splitAmount),
    itemDiscount: round2(rowDec(src, 'item_discount') - splitDiscount),
    lineTotal: round2(rowDec(src, 'line_total') - line),
    subTotal: round2(rowDec(src, 'sub_total') - sub),
    tax1Amount: round2(rowDec(src, 'tax_1_amount') - tax1),
    tax2Amount: round2(rowDec(src, 'tax_2_amount') - splitTax2Amount),
    tax3Amount: round2(rowDec(src, 'tax_3_amount') - splitTax3Amount),
    modifiedBy: auditBy,
  });

  const newChildId = await kotRepo.nextKotChildId(client, companyId);
  await kotRepo.insertKotChild(client, {
    companyId,
    branchId: src.branch_id || branchId,
    stationId: src.station_id || stationId,
    kotChildId: newChildId,
    kotMasterId: newKotId,
    productId: src.product_id,
    barcode: src.barcode,
    shortDescription: src.short_description,
    qty: splitQty,
    packQty: src.pack_qty ?? 1,
    unitCost: src.unit_cost ?? 0,
    unitPrice: src.unit_price ?? 0,
    amount: splitAmount,
    itemDiscount: splitDiscount,
    subTotal: sub,
    lineTotal: line,
    tax1Amount: tax1,
    tax2Amount: splitTax2Amount,
    tax3Amount: splitTax3Amount,
    tax1Rate: src.tax_1_rate ?? 0,
    tax2Rate: src.tax_2_rate ?? 0,
    tax3Rate: src.tax_3_rate ?? 0,
    groupId: src.group_id,
    modifier: src.modifier ?? '',
    kotDisplayStatus: src.kot_display_status || 'PENDING',
    createdBy: auditBy,
    modifiedBy: auditBy,
  });
}

/**
 * KotSplitFrm.Split_Save_ToChair1_UsingKOTMasterClass + SplitMoveChildRow.
 */
export async function splitKot(pool, authStaff, body = {}) {
  const companyId = Number(authStaff.company_id);
  const stationId = Number(authStaff.station_id ?? authStaff.branch_id);
  const branchId = Number(authStaff.branch_id ?? stationId);
  const auditBy = parseLong(authStaff.staff_id) ?? parseLong(authStaff.id);
  const sourceKotId = parseLong(body.sourceKotId ?? body.SourceKotMasterID ?? body.sourceKotMasterId);
  const targetAreaId = Math.trunc(num(body.targetAreaId ?? body.TargetAreaId, 0));
  const targetTableId = Math.trunc(num(body.targetTableId ?? body.TargetTableId, 0));
  const targetChairNo = 1;
  let targetPax = Math.trunc(num(body.targetPax ?? body.TargetPax ?? body.nofCustomer, 0));
  const rawItems = Array.isArray(body.items) ? body.items : Array.isArray(body.Items) ? body.Items : [];

  if (!sourceKotId) throw bad('Invalid Source KOT.', 400, 'SPLIT_SOURCE');
  if (!rawItems.length) {
    throw bad('Please move at least one item to New KOT side.', 400, 'SPLIT_NO_ITEMS');
  }
  if (targetAreaId <= 0 || targetTableId <= 0) {
    throw bad('Please select a target table first.', 400, 'SPLIT_NO_TABLE');
  }
  if (targetPax <= 0) targetPax = 1;

  const moveItems = rawItems
    .map((it) => ({
      kotChildId: parseLong(it.kotChildId ?? it.KotChildID ?? it.SourceKotChildID),
      qty: num(it.qty ?? it.Qty, 0),
      subTotal: num(it.subTotal ?? it.SubTotalC ?? it.SubTotal, 0),
      tax1Amount: num(it.tax1Amount ?? it.Tax1AmountC ?? it.Tax1Amount, 0),
      lineTotal: num(it.lineTotal ?? it.LineTotal, 0),
    }))
    .filter((it) => it.kotChildId && it.qty > 0);

  if (!moveItems.length) throw bad('Please select items to split.', 400, 'SPLIT_NO_ITEMS');

  try {
    return await withTransaction(async (client) => {
      const source = await kotRepo.findKotMaster(client, companyId, sourceKotId);
      if (!source || Number(source.station_id) !== stationId) {
        throw bad('Source KOT not found.', 404, 'SPLIT_SOURCE_MISSING');
      }
      if (!joinableStatus(source.kot_status)) {
        throw bad(`Split failed: KOT is ${source.kot_status}`, 400, 'SPLIT_STATUS');
      }

      const area = await kotRepo.findArea(client, companyId, stationId, targetAreaId);
      if (!area) throw bad('Please select target table.', 400, 'SPLIT_AREA');
      const prefix = String(area.kot_prefix ?? '').trim().slice(0, 50);
      const kotNumber = await kotRepo.nextKotNumber(client, companyId, stationId, prefix);
      const newKotId = await kotRepo.nextKotMasterId(client, companyId);

      let subTot = 0;
      let vat = 0;
      let tot = 0;
      for (const it of moveItems) {
        subTot += it.subTotal;
        vat += it.tax1Amount;
        tot += it.lineTotal;
      }

      let customerId = parseCustomerId(source.customer_id);
      if (!(customerId > 0)) customerId = 1;

      await kotRepo.insertKotMaster(client, {
        companyId,
        branchId: Number(source.branch_id) || branchId,
        stationId,
        kotMasterId: newKotId,
        kotNumber,
        kotPrefix: prefix,
        kotStatus: source.kot_status || 'HOLD',
        customerId,
        areaId: targetAreaId,
        tableId: targetTableId,
        chairNo: targetChairNo,
        waiterId: parseLong(source.waiter_id),
        billDiscount: 0,
        discountType: Number(source.discount_type) === 2 ? 2 : 0,
        amount: tot,
        subTotalM: subTot,
        tax1AmountM: vat,
        tax2AmountM: 0,
        tax3AmountM: 0,
        tax1RateM: 0,
        tax2RateM: 0,
        tax3RateM: 0,
        roundOffAdj: 0,
        nofCustomer: Math.max(1, targetPax),
        remarks: '',
        createdBy: auditBy,
        modifiedBy: auditBy,
      });

      for (const it of moveItems) {
        await splitMoveChildRow(client, {
          companyId,
          sourceKotId,
          newKotId,
          sourceKotChildId: it.kotChildId,
          splitQty: it.qty,
          splitSubTotal: it.subTotal,
          splitTax1Amount: it.tax1Amount,
          splitLineTotal: it.lineTotal,
          auditBy,
          stationId,
          branchId: Number(source.branch_id) || branchId,
        });
      }

      await kotRepo.updateKotMasterTotals(client, companyId, sourceKotId, auditBy);
      await kotRepo.updateKotMasterTotals(client, companyId, newKotId, auditBy);

      const srcChildCount = await kotRepo.countKotChildren(client, companyId, sourceKotId);
      const sourceEmptyAfterSplit = srcChildCount <= 0;
      let orphanMasterDeleted = false;
      if (sourceEmptyAfterSplit) {
        const deleted = await kotRepo.deleteKotMastersOnly(client, companyId, stationId, [sourceKotId]);
        orphanMasterDeleted = deleted > 0;
      }

      const newKotNo = `${prefix}${kotNumber}`;
      return {
        ok: true,
        msg: `Bill Splitted Successfully. New KOT: ${newKotNo} (Chair 1)`,
        sourceKotId,
        newKotId,
        newKotNo,
        targetChairNo,
        sourceEmptyAfterSplit,
        orphanMasterDeleted,
      };
    });
  } catch (err) {
    if (err.status) throw err;
    throw bad(`Split failed: ${err.message}`, 500, 'SPLIT_FAILED');
  }
}
