import { withTransaction } from '../../../config/db.js';
import * as salesRepo from '../repositories/sales.repository.js';
import * as kotRepo from '../repositories/kot.repository.js';
import * as branchRepo from '../../../shared/repositories/branch.repository.js';
import { auditStaffId } from '../lib/staffAudit.js';

function num(v, d = 0) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function nullableLong(v) {
  const n = num(v, 0);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

function str(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/** Flutter / legacy payloads use `items` or `Items`. */
function lineItemsFromBody(body) {
  const raw = body.items ?? body.Items;
  return Array.isArray(raw) ? raw : [];
}

function lineProductId(it) {
  return num(it.productId ?? it.ProductID ?? it.product_id, 0);
}

function lineQty(it) {
  return num(it.qty ?? it.Qty, 0);
}

function lineUnitPrice(it) {
  return num(it.unitPrice ?? it.UnitPrice, 0);
}

function lineUnitCost(it) {
  return num(it.unitCost ?? it.UnitCost, 0);
}

function linePackQty(it) {
  return num(it.packQty ?? it.PackQty, 1) || 1;
}

function lineDiscount(it) {
  return num(it.discount ?? it.Discount ?? it.itemDisc ?? it.ItemDisc, 0);
}

function lineSubTotalC(it) {
  return num(
    it.subTotalC ?? it.SubTotalC ?? it.subTotal ?? it.SubTotal,
    0
  );
}

function lineTax1AmountC(it) {
  return num(it.tax1AmountC ?? it.Tax1AmountC ?? it.tax1Amount ?? it.Tax1Amount, 0);
}

function lineTax2AmountC(it) {
  return num(it.tax2AmountC ?? it.Tax2AmountC, 0);
}

function lineTax3AmountC(it) {
  return num(it.tax3AmountC ?? it.Tax3AmountC, 0);
}

function lineTax1RateC(it) {
  return num(it.tax1RateC ?? it.Tax1RateC ?? it.taxPerc ?? it.TaxPerc, 0);
}

function lineTax2RateC(it) {
  return num(it.tax2RateC ?? it.Tax2RateC, 0);
}

function lineTax3RateC(it) {
  return num(it.tax3RateC ?? it.Tax3RateC, 0);
}

function lineTotal(it) {
  return num(it.lineTotal ?? it.LineTotal, 0);
}

function lineShortDescription(it) {
  const v =
    it.shortDescription ??
    it.ShortDescription ??
    it.itemName ??
    it.ItemName ??
    '';
  return str(v, 200);
}

function lineGroupId(it) {
  return nullableLong(it.groupId ?? it.GroupID ?? it.dgvGrpID);
}

function lineKotChildId(it) {
  return num(it.kotChildID ?? it.kotChildId ?? it.KotChildID, 0);
}

/**
 * POS settlement: persist ops.sales_master + sales_child + sales_payment_split;
 * mark ops.kot_master SETTLED and bill_id = sales_id (INDEXES).
 *
 * Body (Flutter orderData + paidAmount + paymentMode):
 * kotId, stationId, customerId, waiterId, tableId, areaId, noOfCustomer,
 * subTotal, discountAmount, taxableAmount, tax1Amount, tax2Amount, tax3Amount,
 * tax1RateM, tax2RateM, tax3RateM, roundOffAdj, netAmount,
 * paidAmount, paymentMode (CASH | CREDITCARD), counterNo,
 * items[{ productId, qty, unitPrice, unitCost, packQty, discount, subTotalC,
 *   tax1RateC, tax1AmountC, tax2AmountC, tax3AmountC, tax2RateC, tax3RateC,
 *   shortDescription, groupId, kotChildID?, modifier? }]
 */
export async function settleSale(pool, body, authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId = num(
    String(body.stationId ?? body.StationID ?? authStaff.branch_id ?? '').trim(),
    0
  );
  if (branchId < 1) {
    const err = new Error('stationId / branch is required');
    err.status = 400;
    throw err;
  }
  const okBranch = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!okBranch) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  const kotMasterId = num(body.kotId ?? body.kotMasterId ?? body.KotMasterID, 0);
  if (kotMasterId < 1) {
    const err = new Error('kotId is required');
    err.status = 400;
    throw err;
  }

  const net = num(body.netAmount, 0);
  const paid = num(body.paidAmount, 0);
  const tol = 0.02;
  if (net <= 0) {
    const err = new Error('netAmount must be > 0');
    err.status = 400;
    throw err;
  }
  if (paid + tol < net) {
    const err = new Error('paidAmount must be >= netAmount');
    err.status = 400;
    throw err;
  }

  const paymentModeRaw = str(body.paymentMode, 50) || 'CASH';
  const paymentMode = paymentModeRaw.toUpperCase().includes('CREDIT') ? 'CREDITCARD' : 'CASH';

  const items = lineItemsFromBody(body);
  if (!items.length) {
    const err = new Error('items array is required (send items or Items)');
    err.status = 400;
    throw err;
  }

  const auditBy = auditStaffId(authStaff);
  const staffPk = nullableLong(authStaff.staff_id) ?? nullableLong(authStaff.id);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `ops.sales_settle:${companyId}`,
    ]);

    const kot = await kotRepo.findKotMasterSettlement(client, companyId, kotMasterId);
    if (!kot) {
      const err = new Error('KOT not found');
      err.status = 404;
      throw err;
    }
    if (Number(kot.branch_id) !== branchId) {
      const err = new Error('KOT belongs to a different branch');
      err.status = 400;
      throw err;
    }
    const st = String(kot.kot_status ?? '').toUpperCase();
    if (st === 'SETTLED') {
      const err = new Error('KOT already settled');
      err.status = 409;
      throw err;
    }
    if (kot.bill_id != null && Number(kot.bill_id) > 0) {
      const err = new Error('KOT already linked to a bill');
      err.status = 409;
      throw err;
    }

    const salesId = await salesRepo.nextSalesId(client, companyId);
    const billNo = await salesRepo.nextBillNo(client, companyId, branchId);
    const counterNo = num(body.counterNo, 1);

    const subTotal = num(body.subTotal ?? body.subTotalM, 0);
    const discountAmount = num(body.discountAmount, 0);
    const taxableAmount = num(body.taxableAmount, subTotal);
    const tax1 = num(body.tax1Amount ?? body.tax1AmountM, 0);
    const tax2 = num(body.tax2AmountM, 0);
    const tax3 = num(body.tax3AmountM, 0);
    const tax1Rate = num(body.tax1RateM, 0);
    const tax2Rate = num(body.tax2RateM, 0);
    const tax3Rate = num(body.tax3RateM, 0);
    const roundOffAdj = num(body.roundOffAdj, 0);

    const cashAmount = paymentMode === 'CASH' ? paid : 0;
    const creditCardAmount = paymentMode === 'CREDITCARD' ? paid : 0;
    const balancePaid = Math.max(0, paid - net);

    const customerId = nullableLong(body.customerId);
    const waiterId = nullableLong(body.waiterId);
    const tableId = nullableLong(body.tableId);
    const areaId = nullableLong(body.areaId);
    const noOfCustomers = Math.max(0, Math.trunc(num(body.noOfCustomer ?? body.noOfCustomers, 0)));

    await salesRepo.insertSalesMaster(client, {
      companyId,
      salesId,
      branchId,
      kotMasterId,
      counterNo,
      billNo,
      customerId,
      paymentMode,
      creditCardNo: paymentMode === 'CREDITCARD' ? str(body.creditCardNo, 50) : null,
      amount: net,
      cashAmount,
      creditCardAmount,
      paidAmount: paid,
      balancePaid,
      discountAmount,
      subtotalAmount: subTotal,
      taxableAmount,
      tax1Amount: tax1,
      tax2Amount: tax2,
      tax3Amount: tax3,
      tax1Rate,
      tax2Rate,
      tax3Rate,
      roundOffAdj,
      waiterId,
      tableId,
      areaId,
      noOfCustomers,
      staffId: staffPk,
      remarks: str(body.comments ?? body.remarks, 200),
      createdBy: auditBy,
      modifiedBy: auditBy,
    });

    let lineNo = 0;
    for (const it of items) {
      const productId = lineProductId(it);
      if (productId < 1) continue;
      lineNo += 1;
      const qty = lineQty(it);
      if (qty <= 0) {
        const err = new Error(`Invalid qty for product ${productId}`);
        err.status = 400;
        throw err;
      }
      const unitPrice = lineUnitPrice(it);
      const unitCost = lineUnitCost(it);
      const packQty = linePackQty(it);
      const disc = lineDiscount(it);
      const subL = lineSubTotalC(it) || qty * unitPrice - disc;
      const t1 = lineTax1AmountC(it);
      const t2 = lineTax2AmountC(it);
      const t3 = lineTax3AmountC(it);
      const r1 = lineTax1RateC(it);
      const r2 = lineTax2RateC(it);
      const r3 = lineTax3RateC(it);
      const lt = lineTotal(it) || subL + t1 + t2 + t3;

      const kotChildIdRaw = lineKotChildId(it);
      const kotChildId = kotChildIdRaw > 0 ? Math.trunc(kotChildIdRaw) : null;

      const salesChildId = await salesRepo.nextSalesChildId(client, companyId);
      const desc = lineShortDescription(it) || 'Item';
      const groupId = lineGroupId(it);
      const modRaw = it.modifier ?? it.Modifier ?? it.Modifir;
      const modifier = modRaw != null ? String(modRaw).slice(0, 2000) : null;

      await salesRepo.insertSalesChild(client, {
        companyId,
        salesChildId,
        salesId,
        branchId,
        kotChildId,
        productId: Math.trunc(productId),
        shortDescription: desc,
        groupId,
        qty,
        unitPrice,
        unitCost,
        packQty,
        discountAmount: disc,
        lineTotal: lt,
        tax1Amount: t1,
        tax2Amount: t2,
        tax3Amount: t3,
        tax1Rate: r1,
        tax2Rate: r2,
        tax3Rate: r3,
        subtotalAmount: subL,
        modifier,
        createdBy: auditBy,
        modifiedBy: auditBy,
      });
    }

    if (lineNo < 1) {
      const err = new Error('No valid line items (productId required)');
      err.status = 400;
      throw err;
    }

    await salesRepo.insertSalesPaymentSplit(client, {
      companyId,
      salesId,
      payerNo: 1,
      payMode: paymentMode === 'CREDITCARD' ? 'CARD' : 'CASH',
      billAmount: paid,
      branchId,
      counterId: num(body.counterNo, 0),
      staffId: staffPk,
      refNo: str(body.paymentRefNo, 100),
    });

    await kotRepo.updateKotMasterSettled(client, companyId, kotMasterId, salesId, auditBy);

    console.log('[pos settlement] saved', {
      companyId,
      branchId,
      salesId,
      billNo,
      kotMasterId,
      lines: lineNo,
    });

    return {
      ok: true,
      salesId: String(salesId),
      billNo: String(billNo),
      balancePaid: String(balancePaid),
      message: 'Settlement saved.',
    };
  });
}
