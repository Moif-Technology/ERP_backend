import { withTransaction } from '../../../config/db.js';
import * as kotRepo from '../repositories/kot.repository.js';

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
    NofCustomer: String(row.nof_customer ?? 0),
    nofCustomer: String(row.nof_customer ?? 0),
    HeaderRemarks: row.remarks ?? '',
    txtRemarks: row.remarks ?? '',
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
  const nofCustomer = num(body.txtNoofCustomer ?? body.NofCustomer ?? body.nofCustomer, 0);
  const remarks =
    body.txtRemarks != null && String(body.txtRemarks).trim() !== ''
      ? String(body.txtRemarks).slice(0, 250)
      : '';

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

    const headerCommon = {
      customerId,
      areaId: areaId > 0 ? areaId : 0,
      tableId: tableId > 0 ? tableId : 0,
      chairNo,
      waiterId: Number.isFinite(waiterId) && waiterId > 0 ? waiterId : null,
      billDiscount,
      amount: lblTotal,
      subTotalM: lblSub,
      tax1AmountM: lblTax1,
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

      await kotRepo.updateKotMasterTotals(client, companyId, kotMasterId, auditBy);
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
        tax1RateM: 0,
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

      await kotRepo.updateKotMasterTotals(client, companyId, kotMasterId, auditBy);
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

  const rows = await kotRepo.listOpenKots(pool, companyId, stationId, {
    areaId,
    kotNumberSearch,
    supplyType,
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
      SupplyType: supply,
      CustomerID: r.customer_id != null ? String(r.customer_id) : '',
      CustomerName: r.customer_name ?? '',
      WaiterID: r.waiter_id != null ? String(r.waiter_id) : '',
      WaiterName: r.waiter_name ?? '',
      NofCustomer: String(r.nof_customer ?? 0),
      Remarks: r.remarks ?? '',
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
