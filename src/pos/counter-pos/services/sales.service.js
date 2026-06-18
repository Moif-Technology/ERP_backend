import { pool } from '../../../config/db.js';
import * as accountHeadRepo from '../../../accounts/repositories/accountHead.repository.js';
import * as voucherRepo from '../../../accounts/repositories/voucher.repository.js';
import * as stockRepo from '../../../shared/repositories/stock.repository.js';
import * as repo from '../repositories/sales.repository.js';

// Seeded chart-of-accounts fallbacks (accountsSeed.repository.js)
const ACCOUNTS_RECEIVABLE_ID = 1003;
const SALES_REVENUE_ID = 4001;

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

    const warnings = [];

    // ───── Stock: product_log_entry (outward) + qty_on_hand sync ─────
    try {
      await client.query('SAVEPOINT stock_update');
      for (const it of cartItems) {
        await stockRepo.applyStockMovement(client, {
          companyId, branchId,
          productId: Number(it.productId),
          transactionType: 'SALES',
          transactionId: salesId,
          qty: -Number(it.qty),
          unitCost: Number(it.unitCost ?? it.unitPrice ?? 0),
          unitPrice: Number(it.unitPrice ?? 0),
          createdBy: staffId,
        });
      }
      await client.query('RELEASE SAVEPOINT stock_update');
    } catch (stockErr) {
      await client.query('ROLLBACK TO SAVEPOINT stock_update');
      if (stockErr.code === '42P01' || stockErr.code === '42703') {
        console.warn('product_log_entry/product_inventory schema mismatch — stock update skipped');
        warnings.push('Stock update skipped (schema mismatch)');
      } else {
        throw stockErr;
      }
    }

    // ───── Accounts: CREDIT bills go to the books (DR debtor / CR sales) ─────
    // Cash/card counter sales are reconciled at counter close, not per bill.
    if (paymentMode === 'CREDIT') {
      try {
        await client.query('SAVEPOINT voucher_save');

        // Debtor ledger: customer's own head if it exists, else Accounts Receivable.
        let debtorAccountId = null;
        if (customerId != null) {
          const custHead = await accountHeadRepo.findAccountHead(client, companyId, Number(customerId));
          if (custHead) debtorAccountId = Number(customerId);
        }
        if (debtorAccountId == null) {
          const arHead = await accountHeadRepo.findAccountHead(client, companyId, ACCOUNTS_RECEIVABLE_ID);
          if (arHead) debtorAccountId = ACCOUNTS_RECEIVABLE_ID;
        }
        const salesHead = await accountHeadRepo.findAccountHead(client, companyId, SALES_REVENUE_ID);

        if (debtorAccountId == null || !salesHead) {
          warnings.push('Credit sale not posted to accounts — debtor/sales ledger missing');
        } else {
          const voucherTypeId = await voucherRepo.getVoucherTypeId(client, companyId, 'SalesEntryVoucherName', branchId) || 1;
          const voucherPrefix = await voucherRepo.getVoucherPrefix(client, companyId, voucherTypeId) || 'SV-';
          const vMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
          const autoNo = await voucherRepo.nextAutoVoucherNo(client, companyId, branchId, voucherTypeId);

          await voucherRepo.insertVoucherMaster(client, {
            companyId, branchId,
            voucherMasterId: vMasterId,
            voucherTypeId,
            autoVoucherNo: autoNo,
            voucherPrefix,
            voucherDate: now,
            referenceNo: String(salesId),
            voucherAmount: netAmount,
            remarks: `POS CREDIT B-${salesId}`,
            postStatus: 'PENDING',
            creationMode: 'COUNTERPOS',
            voucherPostedId: salesId,
            counterCloseNo: 'PENDING',
            recordStatus: 'ACTIVE',
            createdBy: String(staffId),
          });

          let detailSeq = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);
          // DR debtor — full bill value stays outstanding until receipt
          await voucherRepo.insertVoucherDetail(client, {
            companyId, branchId,
            voucherDetailId: detailSeq++,
            voucherMasterId: vMasterId,
            accountId: debtorAccountId,
            creditAmount: 0,
            debitAmount: netAmount,
            outstandingBalance: netAmount,
            narration: `POS CREDIT B-${salesId}`,
            postStatus: 'PENDING',
            recordStatus: 'ACTIVE',
            createdBy: String(staffId),
          });
          // CR sales revenue
          await voucherRepo.insertVoucherDetail(client, {
            companyId, branchId,
            voucherDetailId: detailSeq++,
            voucherMasterId: vMasterId,
            accountId: SALES_REVENUE_ID,
            creditAmount: netAmount,
            debitAmount: 0,
            outstandingBalance: 0,
            narration: `POS CREDIT B-${salesId}`,
            postStatus: 'PENDING',
            recordStatus: 'ACTIVE',
            createdBy: String(staffId),
          });
        }
        await client.query('RELEASE SAVEPOINT voucher_save');
      } catch (voucherErr) {
        await client.query('ROLLBACK TO SAVEPOINT voucher_save');
        if (voucherErr.code === '42P01' || voucherErr.code === '42703') {
          console.warn('Voucher tables missing — credit sale accounting skipped');
          warnings.push('Credit sale accounting skipped (schema mismatch)');
        } else {
          throw voucherErr;
        }
      }
    }

    // If this bill was recalled from hold, remove the held record
    if (recalledHoldSalesId) {
      await repo.deleteHoldBill(client, companyId, Number(recalledHoldSalesId));
    }

    await client.query('COMMIT');

    return {
      salesId, billNo: salesId, billNoDisplay: `B-${salesId}`,
      warnings: warnings.length ? warnings : undefined,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
