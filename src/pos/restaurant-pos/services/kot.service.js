import { withTransaction } from '../../../config/db.js';
import * as kotRepo from '../repositories/kot.repository.js';
import * as branchRepo from '../../../shared/repositories/branch.repository.js';
import { auditStaffId } from '../lib/staffAudit.js';

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

/** KOT header customer: empty → null; 0 = walk-in (valid); positive = customer id. */
function parseCustomerId(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

function itemDgvChildId(it) {
  const raw = it.dgvKOTChildID ?? it.dgvKotChildID ?? it.DgvKOTChildID ?? '';
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 1) return 0;
  return n;
}

function mapRowToFlutterLine(row) {
  const kmId = row.kot_master_id;
  const prefix = row.kot_prefix ?? '';
  const kotNo = row.kot_number;
  return {
    KotMasterID: String(kmId),
    kotMasterID: String(kmId),
    KOTPrefix: prefix,
    KotPrefix: prefix,
    KOTNumber: String(kotNo),
    KotNumber: String(kotNo),
    kotNumber: String(kotNo),
    AreaID: row.area_id != null ? String(row.area_id) : '',
    areaID: row.area_id != null ? String(row.area_id) : '',
    AreaName: row.area_name ?? '',
    areaName: row.area_name ?? '',
    TableID: row.table_id != null ? String(row.table_id) : '',
    tableID: row.table_id != null ? String(row.table_id) : '',
    ChairNo: row.chair_no != null ? String(row.chair_no) : '0',
    chairNo: row.chair_no != null ? String(row.chair_no) : '0',
    KotChildID: String(row.kot_child_id),
    kotChildID: String(row.kot_child_id),
    KOTChildID: String(row.kot_child_id),
    ProductID: row.product_id != null ? String(row.product_id) : '',
    productID: row.product_id != null ? String(row.product_id) : '',
    Qty: String(row.qty),
    qty: String(row.qty),
    UnitPrice: String(row.unit_price),
    unitPrice: String(row.unit_price),
    Tax1RateC: String(row.tax_1_rate ?? 0),
    tax1RateC: String(row.tax_1_rate ?? 0),
    Tax1AmountC: String(row.tax_1_amount ?? 0),
    tax1AmountC: String(row.tax_1_amount ?? 0),
    LineTotal: String(row.line_total ?? 0),
    lineTotal: String(row.line_total ?? 0),
    ShortDescription: row.short_description ?? '',
    BarCode: row.barcode ?? '',
    Barcode: row.barcode ?? '',
    GroupID: row.group_id != null ? String(row.group_id) : '0',
    groupID: row.group_id != null ? String(row.group_id) : '0',
    Modifier: row.modifier ?? '',
    Remarks: row.modifier ?? '',
    KOTDisplayStatus: row.kot_display_status ?? 'PENDING',
    kotDisplayStatus: row.kot_display_status ?? 'PENDING',
    Androidprint: row.android_printed ? 'PRINTED' : 'PENDING',
    AndroidPrint: row.android_printed ? 'PRINTED' : 'PENDING',
    UniqueProductID: '0',
    ItemCode: '',
    DescriptionArabic: '',
  };
}

export async function buildKotDetailsPayload(executor, companyId, kotMasterId) {
  const rows = await kotRepo.listKotDetailRows(executor, companyId, kotMasterId);
  const data = rows.map(mapRowToFlutterLine);
  return { success: true, data };
}

async function areaKotPrefix(client, companyId, branchId, areaId) {
  if (areaId == null || areaId < 1) return '';
  const { rows } = await client.query(
    `SELECT kot_prefix FROM core.area_master
     WHERE company_id = $1 AND branch_id = $2 AND area_id = $3`,
    [companyId, branchId, areaId]
  );
  const p = rows[0]?.kot_prefix;
  return p != null ? String(p).trim() : '';
}

/**
 * Legacy POS payload: mfAreaId, mfTableID, mfChairNo, mfCustomerID, StationID, Items[], lblSubTotalAmt, lblTax1Total, lblBillTotal,
 * optional CurrentKOTID, mfKotPrefix, mfKotNo for append.
 */
export async function saveKot(pool, body, authStaff, access = null) {
  const companyId = Number(authStaff.company_id);
  const branchId = num(body.StationID ?? body.branchId ?? authStaff.branch_id, 0);
  if (branchId < 1) {
    const err = new Error('StationID / branchId is required');
    err.status = 400;
    throw err;
  }
  const okBranch = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!okBranch) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  const items = Array.isArray(body.Items) ? body.Items : [];
  if (!items.length) {
    const err = new Error('Items array is required');
    err.status = 400;
    throw err;
  }

  const currentKotId = num(body.CurrentKOTID ?? body.currentKOTID, 0);
  const isAppend = currentKotId > 0;
  const canSaveWithoutArea =
    isAppend ||
    access?.meta?.source === 'legacy-fallback' ||
    access?.features?.['pos.kot.save_without_area'] === true;

  const areaId = num(body.mfAreaId, 0);
  if (areaId < 1 && !canSaveWithoutArea) {
    const err = new Error('mfAreaId is required');
    err.status = 400;
    throw err;
  }

  const tableId = num(body.mfTableID, 0);
  const chairNo = num(body.mfChairNo, 0);
  const customerId = parseCustomerId(body.mfCustomerID);
  const waiterId = authStaff.staff_id != null ? Number(authStaff.staff_id) : null;

  const lblSub = num(body.lblSubTotalAmt, 0);
  const lblTax1 = num(body.lblTax1Total, 0);
  const lblTotal = num(body.lblBillTotal, 0);
  const billDiscount = num(body.txtDiscount, 0);
  const nofCustomer = num(body.txtNoofCustomer, 0);
  const remarks =
    body.txtRemarks != null && String(body.txtRemarks).trim() !== ''
      ? String(body.txtRemarks).slice(0, 250)
      : '';

  const auditBy = auditStaffId(authStaff);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.kot_save:${companyId}`,
    ]);

    let kotMasterId;
    let newKotChildIds = [];

    if (isAppend) {
      const master = await kotRepo.findKotMaster(client, companyId, currentKotId);
      if (!master) {
        const err = new Error('KOT not found');
        err.status = 404;
        throw err;
      }
      if (Number(master.branch_id) !== branchId) {
        const err = new Error('KOT belongs to a different branch');
        err.status = 400;
        throw err;
      }
      kotMasterId = currentKotId;

      for (const it of items) {
        if (itemDgvChildId(it) > 0) continue;

        const kotChildId = await kotRepo.nextKotChildId(client, companyId);
        const qty = num(it.Qty ?? it.qty, 1);
        const rate = num(it.UnitPrice ?? it.unitPrice, 0);
        const taxP = num(it.TaxPerc ?? it.taxPerc, 0);
        const st = num(it.SubTotal, qty * rate);
        const taxA = num(it.TaxAmount ?? it.taxAmount, st * (taxP / 100));
        const lt = num(it.LineTotal, st + taxA);

        await kotRepo.insertKotChild(client, {
          companyId,
          branchId,
          kotChildId,
          kotMasterId,
          productId: parseLong(it.ProductID ?? it.productID),
          barcode: it.BarCode != null ? String(it.BarCode).slice(0, 50) : null,
          shortDescription: (it.ItemName ?? it.itemName ?? '').toString().slice(0, 200) || 'Item',
          qty,
          packQty: num(it.PackQty, 1),
          unitCost: num(it.UnitCost, 0),
          unitPrice: rate,
          amount: st,
          itemDiscount: num(it.ItemDisc, 0),
          subTotal: st,
          lineTotal: lt,
          tax1Amount: taxA,
          tax2Amount: 0,
          tax3Amount: 0,
          tax1Rate: taxP,
          tax2Rate: 0,
          tax3Rate: 0,
          groupId: parseLong(it.dgvGrpID ?? it.GroupID) ?? null,
          modifier: it.Modifir != null ? String(it.Modifir).slice(0, 200) : null,
          kotDisplayStatus: (it.KOTDisplayStatus ?? 'PENDING').toString().slice(0, 50),
          createdBy: auditBy,
          modifiedBy: auditBy,
        });
        newKotChildIds.push(kotChildId);
      }

      await kotRepo.updateKotMasterTotals(client, companyId, kotMasterId, auditBy);
    } else {
      kotMasterId = await kotRepo.nextKotMasterId(client, companyId);

      let prefix = (body.mfKotPrefix ?? '').toString().trim();
      if (!prefix) {
        prefix = await areaKotPrefix(client, companyId, branchId, areaId);
      }
      const kotNumber = await kotRepo.nextKotNumber(client, companyId, branchId, prefix);

      await kotRepo.insertKotMaster(client, {
        companyId,
        branchId,
        kotMasterId,
        kotNumber,
        kotPrefix: prefix.slice(0, 50),
        kotStatus: 'OPEN',
        customerId,
        areaId,
        // Legacy schemas often use NOT NULL 0 for "no table" instead of NULL.
        tableId: tableId > 0 ? tableId : 0,
        chairNo,
        waiterId: Number.isFinite(waiterId) && waiterId > 0 ? waiterId : null,
        billDiscount,
        amount: lblTotal,
        subTotalM: lblSub,
        tax1AmountM: lblTax1,
        tax2AmountM: 0,
        tax3AmountM: 0,
        tax1RateM: 0,
        tax2RateM: 0,
        tax3RateM: 0,
        roundOffAdj: num(body.lblRound, 0),
        nofCustomer,
        remarks,
        createdBy: auditBy,
        modifiedBy: auditBy,
      });

      for (const it of items) {
        const kotChildId = await kotRepo.nextKotChildId(client, companyId);
        const qty = num(it.Qty ?? it.qty, 1);
        const rate = num(it.UnitPrice ?? it.unitPrice, 0);
        const taxP = num(it.TaxPerc ?? it.taxPerc, 0);
        const st = num(it.SubTotal, qty * rate);
        const taxA = num(it.TaxAmount ?? it.taxAmount, st * (taxP / 100));
        const lt = num(it.LineTotal, st + taxA);

        await kotRepo.insertKotChild(client, {
          companyId,
          branchId,
          kotChildId,
          kotMasterId,
          productId: parseLong(it.ProductID ?? it.productID),
          barcode: it.BarCode != null ? String(it.BarCode).slice(0, 50) : null,
          shortDescription: (it.ItemName ?? it.itemName ?? '').toString().slice(0, 200) || 'Item',
          qty,
          packQty: num(it.PackQty, 1),
          unitCost: num(it.UnitCost, 0),
          unitPrice: rate,
          amount: st,
          itemDiscount: num(it.ItemDisc, 0),
          subTotal: st,
          lineTotal: lt,
          tax1Amount: taxA,
          tax2Amount: 0,
          tax3Amount: 0,
          tax1Rate: taxP,
          tax2Rate: 0,
          tax3Rate: 0,
          groupId: parseLong(it.dgvGrpID ?? it.GroupID) ?? null,
          modifier: it.Modifir != null ? String(it.Modifir).slice(0, 200) : null,
          kotDisplayStatus: (it.KOTDisplayStatus ?? 'PENDING').toString().slice(0, 50),
          createdBy: auditBy,
          modifiedBy: auditBy,
        });
        newKotChildIds.push(kotChildId);
      }

      await kotRepo.updateKotMasterTotals(client, companyId, kotMasterId, auditBy);
    }

    const kotDetails = await buildKotDetailsPayload(client, companyId, kotMasterId);

    return {
      ok: true,
      msg: 'KOT saved successfully.',
      CurrentKOTID: String(kotMasterId),
      newKotChildIds: newKotChildIds.map(String),
      kotDetails,
    };
  });
}

export async function listKots(pool, authStaff, query = {}) {
  const companyId = Number(authStaff.company_id);
  const branchId = Number(authStaff.branch_id);
  const areaId = query.areaId != null ? Number(query.areaId) : null;
  const kotNumberSearch = query.search ?? null;

  const rows = await kotRepo.listOpenKots(pool, companyId, branchId, { areaId, kotNumberSearch });
  const data = rows.map((r) => ({
    kotMasterID: String(r.kot_master_id),
    KotMasterID: String(r.kot_master_id),
    KotNumber: String(r.kot_number),
    KotPrefix: r.kot_prefix ?? '',
    KotTime: r.kot_time ? r.kot_time.toISOString() : null,
    Amount: String(r.amount ?? 0),
    ChairNo: String(r.chair_no ?? 0),
    AreaName: r.area_name ?? '',
    TableName: r.table_name ?? '',
    SupplyType: r.supply_type ?? '',
  }));
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
