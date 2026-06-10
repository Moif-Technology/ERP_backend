import { pool } from '../../../config/db.js';
import * as repo from '../repositories/sales.repository.js';

/**
 * Save current cart as a held bill.
 * body = { cartItems, paymentMode, subTotal, discountAmt, taxableAmt, taxAmt,
 *          roundOff, netAmount, customerId, counterNo }
 */
export async function holdBill(authStaff, body) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const staffId   = Number(authStaff.staff_id);
  const counterNo = Number(body.counterNo ?? 1);
  const { cartItems, recalledHoldSalesId } = body;

  if (!cartItems?.length) {
    const e = new Error('Cart is empty'); e.status = 400; throw e;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [companyId]);

    const salesId     = await repo.getNextSalesId(client, companyId);
    const holdNo      = await repo.getNextHoldNo(client, companyId);
    const childIdBase = await repo.getNextSalesChildIdBase(client, companyId, cartItems.length);
    const now         = new Date();
    const taxRate     = cartItems[0]?.vatPer ?? 0;

    // If re-holding a recalled bill, delete the old hold first
    if (recalledHoldSalesId) {
      await repo.deleteHoldBill(client, companyId, Number(recalledHoldSalesId));
    }

    await repo.insertHoldMaster(client, {
      companyId, salesId, branchId, counterNo,
      billDate: now,
      customerId: body.customerId ?? null,
      paymentMode: body.paymentMode ?? 'CASH',
      subTotal: body.subTotal ?? 0,
      discountAmt: body.discountAmt ?? 0,
      taxableAmt: body.taxableAmt ?? 0,
      taxAmt: body.taxAmt ?? 0,
      taxRate,
      roundOff: body.roundOff ?? 0,
      netAmount: body.netAmount ?? 0,
      staffId, holdNo,
      prefix: 'B-',
    });

    await repo.insertSalesChildren(
      client, companyId, salesId, branchId, cartItems, childIdBase, staffId,
    );

    await client.query('COMMIT');
    return { salesId, holdNo, message: `Bill held as H-${holdNo}` };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** List all active held bills for this branch */
export async function getHeldBills(authStaff) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  return repo.getHeldBills(pool, companyId, branchId);
}

/** Get master + items for one held bill */
export async function recallBill(authStaff, salesId) {
  const companyId = Number(authStaff.company_id);
  const items = await repo.getHeldBillItems(pool, companyId, Number(salesId));
  if (!items.length) {
    const e = new Error('Hold bill not found'); e.status = 404; throw e;
  }
  return items;
}

/** Cancel a held bill */
export async function cancelHold(authStaff, salesId) {
  const companyId = Number(authStaff.company_id);
  const count = await repo.cancelHoldBill(pool, companyId, Number(salesId));
  if (!count) {
    const e = new Error('Hold bill not found or already cancelled'); e.status = 404; throw e;
  }
  return { message: 'Hold bill cancelled' };
}

/** Staff-wise sales report for the current pending counter session */
export async function getStaffWiseReport(authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const counterNo = Number(query.counterNo ?? 1);
  const rows = await repo.getStaffWiseSales(pool, { companyId, branchId, counterNo });
  return rows.map(r => ({
    staffId:      r.staff_id,
    staffName:    r.staff_name ?? `Staff #${r.staff_id}`,
    billCount:    Number(r.bill_count),
    grossAmount:  Number(r.gross_amount),
    totalDiscount:Number(r.total_discount),
    totalRoundOff:Number(r.total_round_off),
    netAmount:    Number(r.net_amount),
    totalCash:    Number(r.total_cash),
    totalCard:    Number(r.total_card),
    totalCredit:  Number(r.total_credit),
  }));
}

export async function getNextBillNo(authStaff) {
  const companyId = Number(authStaff.company_id);
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(bill_no), 0) + 1 AS next_bill
     FROM ops.sales_master
     WHERE company_id = $1`,
    [companyId],
  );
  return Number(rows[0].next_bill);
}

/**
 * Save a POS bill inside a single DB transaction.
 * body = {
 *   cartItems: [{ productId, productCode, description, qty, unitPrice, vatPer, vatAmt, lineTotal, discount }],
 *   paymentMode: 'CASH'|'CARD'|'CREDIT'|'MULTI',
 *   subTotal, discountAmt, taxableAmt, taxAmt, roundOff, netAmount,
 *   paidAmount, balanceAmount,
 *   customerId: null | number,
 * }
 */
export async function saveBill(authStaff, body) {
  const companyId = Number(authStaff.company_id);
  const branchId  = Number(authStaff.branch_id);
  const staffId   = Number(authStaff.staff_id);
  const counterNo = Number(body.counterNo ?? 1);

  const {
    cartItems, paymentMode,
    subTotal, discountAmt, taxableAmt, taxAmt, roundOff, netAmount,
    paidAmount, balanceAmount, customerId,
    recalledHoldSalesId,   // pass this if finalising a recalled hold
  } = body;

  if (!cartItems?.length) {
    const e = new Error('Cart is empty'); e.status = 400; throw e;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock to serialise concurrent bill inserts for same company
    await client.query(
      `SELECT pg_advisory_xact_lock($1)`,
      [companyId],
    );

    const salesId     = await repo.getNextSalesId(client, companyId);
    const childIdBase = await repo.getNextSalesChildIdBase(client, companyId, cartItems.length);
    const now         = new Date();

    // Determine tax rate from first item (all items same VAT% in counter POS)
    const taxRate = cartItems[0]?.vatPer ?? 0;

    await repo.insertSalesMaster(client, {
      companyId, salesId, branchId, counterNo,
      billDate: now,
      customerId: customerId ?? null,
      paymentMode,
      subTotal, discountAmt, taxableAmt,
      taxAmt, taxRate,
      roundOff, netAmount,
      paidAmount,
      balanceAmount: paidAmount - netAmount,
      staffId,
      prefix: 'B-',
    });

    await repo.insertSalesChildren(
      client, companyId, salesId, branchId,
      cartItems, childIdBase, staffId,
    );

    await repo.insertPaymentSplit(client, {
      companyId, salesId, branchId, counterNo,
      paymentMode, netAmount, staffId, billDate: now,
    });

    // If this bill was recalled from hold, remove the held record
    if (recalledHoldSalesId) {
      await repo.deleteHoldBill(client, companyId, Number(recalledHoldSalesId));
    }

    await client.query('COMMIT');

    return { salesId, billNo: salesId, billNoDisplay: `B-${salesId}` };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
