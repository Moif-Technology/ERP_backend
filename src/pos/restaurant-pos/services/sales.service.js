import { withTransaction } from '../../../config/db.js';
import * as salesRepo from '../repositories/sales.repository.js';
import * as kotRepo from '../repositories/kot.repository.js';
import * as stockRepo from '../../../shared/repositories/stock.repository.js';
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

function isNonInventory(stockType) {
  return String(stockType || '')
    .replace(/-/g, ' ')
    .trim()
    .toUpperCase() === 'NON INVENTORY';
}

/**
 * Deduct on-hand for each settled line (ops.product_log_entry + qty_on_hand).
 * Skips NON INVENTORY. Allows negative on-hand so restaurant menu items
 * that start at 0 still move on sale.
 */
async function applyRestaurantSaleStockOut(client, {
  companyId,
  branchId,
  salesId,
  lines,
  createdBy,
}) {
  const productIds = [
    ...new Set(lines.map((L) => L.productId).filter((id) => Number.isFinite(id) && id > 0)),
  ];
  if (!productIds.length || branchId < 1) return 0;

  const skip = new Set();
  try {
    const { rows } = await client.query(
      `SELECT product_id, COALESCE(stock_type, '') AS stock_type
         FROM core.product_master
        WHERE company_id = $1
          AND product_id = ANY($2::bigint[])`,
      [companyId, productIds],
    );
    for (const r of rows) {
      if (isNonInventory(r.stock_type)) skip.add(Number(r.product_id));
    }
  } catch (err) {
    if (err.code !== '42703') throw err;
  }

  let moved = 0;
  for (const L of lines) {
    if (skip.has(L.productId) || L.qty === 0) continue;
    try {
      await client.query('SAVEPOINT pos_stock_out');
      await stockRepo.applyStockMovement(client, {
        companyId,
        branchId,
        productId: L.productId,
        transactionType: 'SALES',
        transactionId: salesId,
        qty: -L.qty,
        unitCost: L.unitCost,
        unitPrice: L.unitPrice,
        createdBy,
      });
      await client.query('RELEASE SAVEPOINT pos_stock_out');
      moved += 1;
    } catch (stockErr) {
      try {
        await client.query('ROLLBACK TO SAVEPOINT pos_stock_out');
      } catch {
        /* savepoint already gone */
      }
      if (stockErr.code === '42P01' || stockErr.code === '42703') {
        console.warn('[pos settlement] stock log schema mismatch — skipped', L.productId);
        continue;
      }
      if (stockErr.code === '23514') {
        const err = new Error(
          `Insufficient stock for "${L.shortDescription || L.productId}"`,
        );
        err.status = 400;
        throw err;
      }
      throw stockErr;
    }
  }
  return moved;
}

function round2(v) {
  return Math.round(num(v, 0) * 100) / 100;
}

function absN(v, d = 0) {
  return Math.abs(num(v, d));
}

/** True when this settlement is a sales return (refund). */
function detectSalesReturn(body, items) {
  if (body?.isReturn === true) return true;
  if (num(body.netAmount, 0) < 0) return true;
  const signed = items.map(lineQty).filter((q) => q !== 0);
  return signed.length > 0 && signed.every((q) => q < 0);
}

function splitSaleReturnItems(items) {
  const saleItems = [];
  const returnItems = [];
  for (const it of items) {
    const q = lineQty(it);
    if (q < 0) returnItems.push(it);
    else if (q > 0) saleItems.push(it);
  }
  return { saleItems, returnItems };
}

function headerFromItems(items, paidFallback) {
  let sub = 0;
  let disc = 0;
  let tax = 0;
  let net = 0;
  for (const it of items) {
    const qty = absN(lineQty(it));
    const unitPrice = absN(lineUnitPrice(it));
    const d = absN(lineDiscount(it));
    const subL = absN(lineSubTotalC(it) || qty * unitPrice - d);
    const t1 = absN(lineTax1AmountC(it));
    const t2 = absN(lineTax2AmountC(it));
    const t3 = absN(lineTax3AmountC(it));
    const lt = absN(lineTotal(it) || subL + t1 + t2 + t3);
    sub += subL;
    disc += d;
    tax += t1 + t2 + t3;
    net += lt;
  }
  const paid = paidFallback != null ? absN(paidFallback) : net;
  return {
    subTotal: round2(sub),
    discountAmount: round2(disc),
    taxableAmount: round2(sub),
    tax1: round2(tax),
    tax2: 0,
    tax3: 0,
    net: round2(net),
    paid: round2(paid),
  };
}

async function markSalesReturn(client, companyId, salesId) {
  try {
    await client.query(
      `UPDATE ops.sales_master
          SET transaction_type = 'RETURN'
        WHERE company_id = $1 AND sales_id = $2`,
      [companyId, salesId],
    );
  } catch (err) {
    if (err.code !== '42703') throw err;
  }
}

async function persistRestaurantBill(client, ctx) {
  const {
    companyId,
    branchId,
    stationId,
    stockBranchId,
    kotMasterId,
    counterNo,
    paymentMode,
    customerId,
    waiterId,
    tableId,
    areaId,
    noOfCustomers,
    staffPk,
    auditBy,
    remarks,
    creditCardNo,
    paymentRefNo,
    items,
    header,
    isReturn,
  } = ctx;

  const salesId = await salesRepo.nextSalesId(client, companyId);
  const billNo = await salesRepo.nextBillNo(client, companyId, stationId);
  const net = absN(header.net);
  const paid = absN(header.paid, net);
  const cashAmount = paymentMode === 'CASH' ? paid : 0;
  const creditCardAmount = paymentMode === 'CREDITCARD' ? paid : 0;

  await salesRepo.insertSalesMaster(client, {
    companyId,
    salesId,
    branchId,
    stationId,
    kotMasterId,
    counterNo,
    billNo,
    customerId,
    paymentMode,
    creditCardNo,
    amount: net,
    cashAmount,
    creditAmount: 0,
    creditCardAmount,
    paidAmount: paid,
    balancePaid: Math.max(0, paid - net),
    discountAmount: absN(header.discountAmount),
    subtotalAmount: absN(header.subTotal),
    taxableAmount: absN(header.taxableAmount, header.subTotal),
    tax1Amount: absN(header.tax1),
    tax2Amount: absN(header.tax2),
    tax3Amount: absN(header.tax3),
    tax1Rate: absN(header.tax1Rate),
    tax2Rate: absN(header.tax2Rate),
    tax3Rate: absN(header.tax3Rate),
    roundOffAdj: header.roundOffAdj ?? 0,
    waiterId,
    tableId,
    areaId,
    noOfCustomers,
    staffId: staffPk,
    remarks,
    createdBy: auditBy,
    modifiedBy: auditBy,
  });

  if (isReturn) await markSalesReturn(client, companyId, salesId);

  let lineNo = 0;
  const stockLines = [];
  for (const it of items) {
    const productId = lineProductId(it);
    if (productId < 1) continue;
    const signedQty = lineQty(it);
    if (signedQty === 0) continue;
    lineNo += 1;

    const qty = absN(signedQty);
    const unitPrice = absN(lineUnitPrice(it));
    const unitCost = absN(lineUnitCost(it));
    const packQty = absN(linePackQty(it), 1) || 1;
    const disc = absN(lineDiscount(it));
    const subL = absN(lineSubTotalC(it) || qty * unitPrice - disc);
    const t1 = absN(lineTax1AmountC(it));
    const t2 = absN(lineTax2AmountC(it));
    const t3 = absN(lineTax3AmountC(it));
    const r1 = absN(lineTax1RateC(it));
    const r2 = absN(lineTax2RateC(it));
    const r3 = absN(lineTax3RateC(it));
    const lt = absN(lineTotal(it) || subL + t1 + t2 + t3);
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
      stationId,
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
    stockLines.push({
      productId: Math.trunc(productId),
      qty: signedQty,
      unitCost,
      unitPrice,
      shortDescription: desc,
    });
  }

  if (lineNo < 1) {
    const err = new Error('No valid line items (productId required)');
    err.status = 400;
    throw err;
  }

  const stockMoved = await applyRestaurantSaleStockOut(client, {
    companyId,
    branchId: stockBranchId,
    salesId,
    lines: stockLines,
    createdBy: auditBy,
  });

  await salesRepo.insertSalesPaymentSplit(client, {
    companyId,
    salesId,
    payerNo: 1,
    payMode: paymentMode === 'CREDITCARD' ? 'CARD' : 'CASH',
    billAmount: paid,
    branchId,
    counterId: counterNo,
    staffId: staffPk,
    refNo: paymentRefNo,
  });

  return { salesId, billNo, lineNo, stockMoved, paid, net };
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
  const stationId = num(
    String(body.stationId ?? body.StationID ?? authStaff.station_id ?? authStaff.branch_id ?? '').trim(),
    0
  );
  if (stationId < 1) {
    const err = new Error('stationId / branch is required');
    err.status = 400;
    throw err;
  }
  const { rows: stnRows } = await pool.query(
    `SELECT branch_id
       FROM core.station_master
      WHERE company_id = $1 AND station_id = $2 AND is_deleted = FALSE
      LIMIT 1`,
    [companyId, stationId]
  );
  if (!stnRows.length) {
    const err = new Error('Invalid station for this company');
    err.status = 400;
    throw err;
  }
  const branchId = Number(authStaff.branch_id);
  const stockBranchId = num(stnRows[0].branch_id, 0) || num(branchId, 0);

  const kotMasterId = num(body.kotId ?? body.kotMasterId ?? body.KotMasterID, 0);
  if (kotMasterId < 1) {
    const err = new Error('kotId is required');
    err.status = 400;
    throw err;
  }

  const items = lineItemsFromBody(body);
  if (!items.length) {
    const err = new Error('items array is required (send items or Items)');
    err.status = 400;
    throw err;
  }

  const { saleItems, returnItems } = splitSaleReturnItems(items);
  if (!saleItems.length && !returnItems.length) {
    const err = new Error('No valid line items (productId required)');
    err.status = 400;
    throw err;
  }

  const isReturnOnly = detectSalesReturn(body, items) && saleItems.length === 0;
  const rawNet = num(body.netAmount, 0);
  const rawPaid = num(body.paidAmount, 0);
  const tol = 0.02;
  if (rawNet === 0 && !returnItems.length) {
    const err = new Error('netAmount must not be 0');
    err.status = 400;
    throw err;
  }
  if (rawNet > 0 && rawPaid + tol < rawNet) {
    const err = new Error('paidAmount must be >= netAmount');
    err.status = 400;
    throw err;
  }

  const paymentModeRaw = str(body.paymentMode, 50) || 'CASH';
  const paymentMode = paymentModeRaw.toUpperCase().includes('CREDIT') ? 'CREDITCARD' : 'CASH';

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
    if (Number(kot.station_id ?? kot.branch_id) !== stationId) {
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

    const counterNo = num(body.counterNo, 1);
    const customerId = nullableLong(body.customerId);
    const waiterId = nullableLong(body.waiterId);
    const tableId = nullableLong(body.tableId);
    const areaId = nullableLong(body.areaId);
    const noOfCustomers = Math.max(0, Math.trunc(num(body.noOfCustomer ?? body.noOfCustomers, 0)));
    const remarks = str(body.comments ?? body.remarks, 200);
    const creditCardNo = paymentMode === 'CREDITCARD' ? str(body.creditCardNo, 50) : null;
    const paymentRefNo = str(body.paymentRefNo, 100);
    const shared = {
      companyId,
      branchId,
      stationId,
      stockBranchId,
      kotMasterId,
      counterNo,
      paymentMode,
      customerId,
      waiterId,
      tableId,
      areaId,
      noOfCustomers,
      staffPk,
      auditBy,
      remarks,
      creditCardNo,
      paymentRefNo,
    };

    const bodyHeader = {
      subTotal: absN(body.subTotal ?? body.subTotalM),
      discountAmount: absN(body.discountAmount),
      taxableAmount: absN(body.taxableAmount, body.subTotal ?? body.subTotalM),
      tax1: absN(body.tax1Amount ?? body.tax1AmountM),
      tax2: absN(body.tax2AmountM),
      tax3: absN(body.tax3AmountM),
      tax1Rate: absN(body.tax1RateM),
      tax2Rate: absN(body.tax2RateM),
      tax3Rate: absN(body.tax3RateM),
      roundOffAdj: body.roundOffAdj ?? 0,
      net: absN(body.netAmount),
      paid: absN(body.paidAmount, body.netAmount),
    };

    let saleOut = null;
    let returnOut = null;

    if (saleItems.length && returnItems.length) {
      saleOut = await persistRestaurantBill(client, {
        ...shared,
        items: saleItems,
        header: headerFromItems(saleItems),
        isReturn: false,
      });
      returnOut = await persistRestaurantBill(client, {
        ...shared,
        items: returnItems,
        header: headerFromItems(returnItems),
        isReturn: true,
      });
    } else if (returnItems.length || isReturnOnly) {
      returnOut = await persistRestaurantBill(client, {
        ...shared,
        items: returnItems.length ? returnItems : items,
        header: bodyHeader,
        isReturn: true,
      });
    } else {
      saleOut = await persistRestaurantBill(client, {
        ...shared,
        items: saleItems.length ? saleItems : items,
        header: bodyHeader,
        isReturn: false,
      });
    }

    const primary = saleOut || returnOut;
    await kotRepo.updateKotMasterSettled(client, companyId, kotMasterId, primary.salesId, auditBy);

    console.log('[pos settlement] saved', {
      companyId,
      branchId,
      stockBranchId,
      salesId: primary.salesId,
      billNo: primary.billNo,
      kotMasterId,
      lines: (saleOut?.lineNo || 0) + (returnOut?.lineNo || 0),
      stockMoved: (saleOut?.stockMoved || 0) + (returnOut?.stockMoved || 0),
      isReturn: Boolean(returnOut),
    });

    return {
      ok: true,
      salesId: String(primary.salesId),
      billNo: String(primary.billNo),
      balancePaid: String(Math.max(0, primary.paid - primary.net)),
      message: 'Settlement saved.',
    };
  });
}

function mapSaleChild(row, i = 0) {
  return {
    slNo: i + 1,
    productId: Number(row.product_id ?? 0),
    ProductID: Number(row.product_id ?? 0),
    qty: Number(row.qty ?? 0),
    Qty: Number(row.qty ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    UnitPrice: Number(row.unit_price ?? 0),
    discount: Number(row.discount_amount ?? 0),
    Discount: Number(row.discount_amount ?? 0),
    itemDisc: Number(row.discount_amount ?? 0),
    ItemDisc: Number(row.discount_amount ?? 0),
    subTotalC: Number(row.subtotal_amount ?? 0),
    SubTotalC: Number(row.subtotal_amount ?? 0),
    tax1AmountC: Number(row.tax_1_amount ?? 0),
    Tax1AmountC: Number(row.tax_1_amount ?? 0),
    tax1RateC: Number(row.tax_1_rate ?? 0),
    Tax1RateC: Number(row.tax_1_rate ?? 0),
    lineTotal: Number(row.line_total ?? 0),
    LineTotal: Number(row.line_total ?? 0),
    shortDescription: row.short_description ?? '',
    ShortDescription: row.short_description ?? '',
    groupId: Number(row.group_id ?? 0),
    GroupID: Number(row.group_id ?? 0),
    modifier: row.modifier ?? '',
    Modifier: row.modifier ?? '',
    barcode: row.barcode ?? row.bar_code ?? '',
    BarCode: row.barcode ?? row.bar_code ?? '',
  };
}

async function loadSaleChildren(pool, companyId, salesId) {
  const { rows } = await pool.query(
    `SELECT sales_child_id, product_id, short_description, group_id, qty, unit_price,
            discount_amount, subtotal_amount, tax_1_amount, tax_1_rate, line_total, modifier
       FROM ops.sales_child
      WHERE company_id = $1 AND sales_id = $2
      ORDER BY sales_child_id`,
    [companyId, salesId],
  );
  return rows.map((row, i) => mapSaleChild(row, i));
}

/** GET /api/pos/sales/by-bill/:billNo — Return keypad LoadSalesData. */
export async function getSaleByBillNo(pool, billNoRaw, query, authStaff) {
  const companyId = Number(authStaff.company_id);
  const billNo = Number(billNoRaw);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('company_id required');
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(billNo) || billNo < 1) {
    return { ok: true, items: [] };
  }
  const stationId = num(query.stationId ?? authStaff.station_id, 0);
  const params = [companyId, billNo];
  let stationSql = '';
  if (stationId > 0) {
    stationSql = ' AND sm.station_id = $3';
    params.push(stationId);
  }
  let masters;
  try {
    const out = await pool.query(
      `SELECT sm.sales_id, sm.bill_no, sm.station_id, sm.payment_mode, sm.customer_id,
              sm.amount, sm.subtotal_amount, sm.discount_amount, sm.tax_1_amount, sm.paid_amount
         FROM ops.sales_master sm
        WHERE sm.company_id = $1
          AND sm.bill_no = $2
          AND COALESCE(UPPER(TRIM(sm.transaction_type)), '') NOT IN ('RETURN', 'SALES RETURN')
          ${stationSql}
        ORDER BY sm.sales_id DESC
        LIMIT 1`,
      params,
    );
    masters = out.rows;
  } catch (err) {
    if (err.code !== '42703') throw err;
    const out = await pool.query(
      `SELECT sm.sales_id, sm.bill_no, sm.station_id, sm.payment_mode, sm.customer_id,
              sm.amount, sm.subtotal_amount, sm.discount_amount, sm.tax_1_amount, sm.paid_amount
         FROM ops.sales_master sm
        WHERE sm.company_id = $1
          AND sm.bill_no = $2
          ${stationSql}
        ORDER BY sm.sales_id DESC
        LIMIT 1`,
      params,
    );
    masters = out.rows;
  }
  if (!masters.length) return { ok: true, items: [] };
  const m = masters[0];
  const items = await loadSaleChildren(pool, companyId, m.sales_id);
  return {
    ok: true,
    salesId: String(m.sales_id),
    billNo: String(m.bill_no),
    paymentMode: m.payment_mode ?? 'CASH',
    amount: Number(m.amount ?? 0),
    items,
  };
}

function isoDate(raw, fallback) {
  const s = String(raw ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

/** GET /api/pos/sales/viewer */
export async function listSalesViewer(pool, query, authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('company_id required');
    err.status = 400;
    throw err;
  }
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = isoDate(query.dateFrom ?? query.fromDate, today);
  const dateTo = isoDate(query.dateTo ?? query.toDate, today);
  const stationId = num(query.stationId ?? authStaff.station_id, 0);
  const billNo = num(query.billNo, 0);
  const counterNo = num(query.counterNo, 0);
  const customerId = num(query.customerId, 0);
  const areaId = num(query.areaId, 0);
  const paymentMode = str(query.paymentMode, 50);

  const params = [companyId, dateFrom, dateTo];
  const extra = [];
  if (stationId > 0) {
    params.push(stationId);
    extra.push(`sm.station_id = $${params.length}`);
  }
  if (billNo > 0) {
    params.push(billNo);
    extra.push(`sm.bill_no = $${params.length}`);
  }
  if (counterNo > 0) {
    params.push(counterNo);
    extra.push(`sm.counter_no = $${params.length}`);
  }
  if (customerId > 0) {
    params.push(customerId);
    extra.push(`sm.customer_id = $${params.length}`);
  }
  if (areaId > 0) {
    params.push(areaId);
    extra.push(`sm.area_id = $${params.length}`);
  }
  if (paymentMode) {
    params.push(paymentMode);
    extra.push(`UPPER(COALESCE(sm.payment_mode, '')) = UPPER($${params.length})`);
  }
  const extraSql = extra.length ? ` AND ${extra.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT sm.sales_id, sm.bill_no, sm.counter_no, sm.bill_date, sm.bill_time,
            sm.payment_mode, sm.amount, sm.discount_amount, sm.taxable_amount,
            sm.tax_1_amount, sm.subtotal_amount, sm.created_by, sm.area_id,
            COALESCE(cu.customer_name, 'Walk-in') AS customer_name,
            COALESCE(wt.staff_name, '') AS waiter_name
       FROM ops.sales_master sm
       LEFT JOIN biz.customer_master cu
         ON cu.company_id = sm.company_id AND cu.customer_id = sm.customer_id
       LEFT JOIN LATERAL (
         SELECT s.staff_name
           FROM core.staff_master s
          WHERE s.company_id = sm.company_id
            AND (s.id = sm.waiter_id OR s.staff_id = sm.waiter_id)
          ORDER BY CASE WHEN s.staff_id = sm.waiter_id THEN 0 ELSE 1 END
          LIMIT 1
       ) wt ON TRUE
      WHERE sm.company_id = $1
        AND sm.bill_date::date BETWEEN $2::date AND $3::date
        ${extraSql}
      ORDER BY sm.bill_date DESC, sm.sales_id DESC
      LIMIT 500`,
    params,
  );
  return {
    bills: rows.map((r) => ({
      salesId: String(r.sales_id),
      SalesID: String(r.sales_id),
      billNo: String(r.bill_no ?? ''),
      BillNo: String(r.bill_no ?? ''),
      counterNo: String(r.counter_no ?? ''),
      CounterNo: String(r.counter_no ?? ''),
      customerName: r.customer_name ?? 'Walk-in',
      CustomerName: r.customer_name ?? 'Walk-in',
      billDate: r.bill_date,
      BillDate: r.bill_date,
      billTime: r.bill_time ?? r.bill_date,
      BillTime: r.bill_time ?? r.bill_date,
      paymentMode: r.payment_mode ?? 'CASH',
      PaymentMode: r.payment_mode ?? 'CASH',
      deliveryBoy: r.waiter_name ?? '',
      amount: Number(r.subtotal_amount ?? r.amount ?? 0),
      Amount: Number(r.subtotal_amount ?? r.amount ?? 0),
      discount: Number(r.discount_amount ?? 0),
      Discount: Number(r.discount_amount ?? 0),
      taxableAmount: Number(r.taxable_amount ?? 0),
      TaxableAmount: Number(r.taxable_amount ?? 0),
      tax1AmountM: Number(r.tax_1_amount ?? 0),
      Tax1AmountM: Number(r.tax_1_amount ?? 0),
      total: Number(r.amount ?? 0),
      Total: Number(r.amount ?? 0),
      cashierName: r.created_by ?? '',
      CashierName: r.created_by ?? '',
      postStatus: '',
      counterCloseStatus: '',
    })),
  };
}

/** GET /api/pos/sales/viewer/:salesId */
export async function getSalesViewerBill(pool, salesIdRaw, query, authStaff) {
  const companyId = Number(authStaff.company_id);
  const salesId = Number(salesIdRaw);
  if (!Number.isFinite(companyId) || companyId < 1 || !Number.isFinite(salesId) || salesId < 1) {
    const err = new Error('salesId required');
    err.status = 400;
    throw err;
  }
  const { rows } = await pool.query(
    `SELECT sm.sales_id, sm.bill_no, sm.bill_date, sm.bill_time, sm.payment_mode,
            sm.counter_no, sm.credit_card_no, sm.amount, sm.paid_amount, sm.balance_paid,
            sm.discount_amount, sm.subtotal_amount, sm.tax_1_amount, sm.created_by, sm.table_id,
            COALESCE(cu.customer_name, 'Walk-in') AS customer_name,
            COALESCE(wt.staff_name, '') AS waiter_name
       FROM ops.sales_master sm
       LEFT JOIN biz.customer_master cu
         ON cu.company_id = sm.company_id AND cu.customer_id = sm.customer_id
       LEFT JOIN LATERAL (
         SELECT s.staff_name
           FROM core.staff_master s
          WHERE s.company_id = sm.company_id
            AND (s.id = sm.waiter_id OR s.staff_id = sm.waiter_id)
          ORDER BY CASE WHEN s.staff_id = sm.waiter_id THEN 0 ELSE 1 END
          LIMIT 1
       ) wt ON TRUE
      WHERE sm.company_id = $1 AND sm.sales_id = $2
      LIMIT 1`,
    [companyId, salesId],
  );
  if (!rows.length) {
    const err = new Error('Bill not found');
    err.status = 404;
    throw err;
  }
  const m = rows[0];
  const items = await loadSaleChildren(pool, companyId, m.sales_id);
  return {
    salesId: String(m.sales_id),
    billNo: String(m.bill_no ?? ''),
    billDate: m.bill_date,
    billTime: m.bill_time ?? m.bill_date,
    paymentMode: m.payment_mode ?? 'CASH',
    customerName: m.customer_name ?? 'Walk-in',
    cashierName: m.created_by ?? '',
    waiterName: m.waiter_name ?? '',
    counterNo: String(m.counter_no ?? ''),
    creditCardNo: m.credit_card_no ?? '',
    tableName: m.table_id != null ? String(m.table_id) : '',
    subTotal: Number(m.subtotal_amount ?? 0),
    discountAmount: Number(m.discount_amount ?? 0),
    tax1Amount: Number(m.tax_1_amount ?? 0),
    amount: Number(m.amount ?? 0),
    paidAmount: Number(m.paid_amount ?? 0),
    balancePaid: Number(m.balance_paid ?? 0),
    items,
  };
}
