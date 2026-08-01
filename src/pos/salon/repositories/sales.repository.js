/**
 * ops.sales_master / sales_child / sales_payment_split writes for Salon POS.
 * After a successful settle, job rows are hard-deleted (migration 106 drops FKs).
 */
import {
  PM,
  isCreditCardBillMode,
  isCreditBillMode,
  isComplimentBillMode,
  isOnlineBillMode,
  isMultiPaymentBillMode,
  normalizeBillPaymentMode,
} from '../utils/paymentModes.js';

export async function nextSalesId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(sales_id), 0) + 1 AS n FROM ops.sales_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function nextSalesChildId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(sales_child_id), 0) + 1 AS n FROM ops.sales_child WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function nextBillNo(client, companyId, stationId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(bill_no), 0) + 1 AS n
       FROM ops.sales_master
      WHERE company_id = $1 AND station_id = $2`,
    [companyId, stationId]
  );
  return Number(rows[0].n);
}

export async function findJobForSettlement(client, companyId, jobId) {
  const { rows } = await client.query(
    `SELECT job_id, job_no, job_status, station_id, branch_id,
            chair_id, area_id, customer_id, primary_stylist_id, sales_id
       FROM ops.job_master
      WHERE company_id = $1 AND job_id = $2 AND is_deleted = FALSE
      FOR UPDATE`,
    [companyId, jobId]
  );
  return rows[0] ?? null;
}

export async function listJobLinesForSettlement(client, companyId, jobId) {
  const { rows } = await client.query(
    `SELECT line_id, product_id, line_type, stylist_id
       FROM ops.job_child
      WHERE company_id = $1 AND job_id = $2 AND is_deleted = FALSE`,
    [companyId, jobId]
  );
  return rows;
}

/** Hard-delete job child then master after sales insert completes.
 *  sales_master.job_id stays as a historical reference (no FK).
 */
export async function ensureNoSalesJobFk(client) {
  await client.query(
    `ALTER TABLE ops.sales_master DROP CONSTRAINT IF EXISTS fk_sales_master_salon_job`
  );
  await client.query(
    `ALTER TABLE ops.sales_master DROP CONSTRAINT IF EXISTS fk_sales_master_job`
  );
  await client.query(
    `ALTER TABLE ops.job_master DROP CONSTRAINT IF EXISTS fk_job_master_sales`
  );
  await client.query(
    `ALTER TABLE ops.job_master DROP CONSTRAINT IF EXISTS fk_salon_job_master_sales`
  );
}

export async function deleteJobAfterSettlement(client, companyId, jobId) {
  // Drop FKs that would block job delete after bill insert (idempotent).
  await ensureNoSalesJobFk(client);

  await client.query(
    `DELETE FROM ops.job_child
      WHERE company_id = $1 AND job_id = $2`,
    [companyId, jobId]
  );
  const { rowCount } = await client.query(
    `DELETE FROM ops.job_master
      WHERE company_id = $1 AND job_id = $2`,
    [companyId, jobId]
  );
  return rowCount > 0;
}

export function resolveSalesOutstandingBalance(m) {
  const mode = normalizeBillPaymentMode(m.paymentMode);
  const net = Number(m.amount ?? m.netAmount ?? 0);
  if (mode === PM.CREDIT) return net > 0 ? net : 0;
  if (isMultiPaymentBillMode(mode)) {
    const credit = m.creditAmount != null ? Number(m.creditAmount) : 0;
    return credit > 0 ? credit : 0;
  }
  return 0;
}

export async function insertSalesMaster(client, row) {
  const {
    companyId, salesId, branchId, stationId, jobId, counterNo, billNo,
    customerId, paymentMode, creditCardNo,
    amount, cashAmount, creditAmount, creditCardAmount, paidAmount, balancePaid,
    discountAmount, subtotalAmount, taxableAmount,
    tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
    roundOffAdj, stylistId, chairId, areaId, noOfCustomers,
    staffId, remarks, onlineSource, createdBy, modifiedBy,
  } = row;

  const mode = normalizeBillPaymentMode(paymentMode);
  const paid = Number(paidAmount ?? 0);
  const net = Number(amount ?? 0);

  const cashAmt = cashAmount != null
    ? Number(cashAmount)
    : (mode === PM.CASH ? paid : 0);
  const creditAmt = creditAmount != null
    ? Number(creditAmount)
    : (isCreditBillMode(mode) ? net : 0);
  const cardAmt = creditCardAmount != null
    ? Number(creditCardAmount)
    : ((isCreditCardBillMode(mode) || isOnlineBillMode(mode)) ? paid : 0);

  const osBal = resolveSalesOutstandingBalance({
    paymentMode: mode,
    amount: net,
    creditAmount: creditAmt,
  });

  const remarkText = [remarks, onlineSource ? `Online: ${onlineSource}` : null]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 200) || null;

  await client.query(
    `INSERT INTO ops.sales_master (
        company_id, sales_id, branch_id, station_id, job_id,
        counter_no, bill_no, bill_date, bill_time,
        customer_id, payment_mode, credit_card_no,
        amount, cash_amount, credit_amount, credit_card_amount,
        paid_amount, balance_paid, outstanding_balance,
        discount_amount, subtotal_amount, taxable_amount,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        round_off_adjustment,
        waiter_id, table_id, area_id, no_of_customers,
        staff_id, remarks, entry_source, post_status,
        counter_close_status, created_by, modified_by
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7, NOW(), NOW(),
        $8,$9,$10,
        $11,$12,$13,$14,
        $15,$16,$17,
        $18,$19,$20,
        $21,$22,$23,
        $24,$25,$26,
        $27,
        $28,$29,$30,$31,
        $32,$33,'SALON-POS','POSTED',
        'PENDING',$34,$35
      )`,
    [
      companyId, salesId, branchId, stationId ?? branchId, jobId,
      counterNo, billNo,
      customerId, mode, creditCardNo,
      net, cashAmt, creditAmt, cardAmt,
      isComplimentBillMode(mode) ? 0 : paid,
      isComplimentBillMode(mode) ? 0 : Number(balancePaid ?? 0),
      osBal,
      discountAmount, subtotalAmount, taxableAmount,
      tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
      roundOffAdj,
      stylistId, chairId, areaId, noOfCustomers,
      staffId, remarkText, createdBy, modifiedBy,
    ]
  ).catch(async (e) => {
    // Older DBs may still have salon_job_id instead of job_id.
    if (e.code !== '42703' || !String(e.message || '').includes('job_id')) throw e;
    await client.query(
      `INSERT INTO ops.sales_master (
          company_id, sales_id, branch_id, station_id, salon_job_id,
          counter_no, bill_no, bill_date, bill_time,
          customer_id, payment_mode, credit_card_no,
          amount, cash_amount, credit_amount, credit_card_amount,
          paid_amount, balance_paid, outstanding_balance,
          discount_amount, subtotal_amount, taxable_amount,
          tax_1_amount, tax_2_amount, tax_3_amount,
          tax_1_rate, tax_2_rate, tax_3_rate,
          round_off_adjustment,
          waiter_id, table_id, area_id, no_of_customers,
          staff_id, remarks, entry_source, post_status,
          counter_close_status, created_by, modified_by
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7, NOW(), NOW(),
          $8,$9,$10,
          $11,$12,$13,$14,
          $15,$16,$17,
          $18,$19,$20,
          $21,$22,$23,
          $24,$25,$26,
          $27,
          $28,$29,$30,$31,
          $32,$33,'SALON-POS','POSTED',
          'PENDING',$34,$35
        )`,
      [
        companyId, salesId, branchId, stationId ?? branchId, jobId,
        counterNo, billNo,
        customerId, mode, creditCardNo,
        net, cashAmt, creditAmt, cardAmt,
        isComplimentBillMode(mode) ? 0 : paid,
        isComplimentBillMode(mode) ? 0 : Number(balancePaid ?? 0),
        osBal,
        discountAmount, subtotalAmount, taxableAmount,
        tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
        roundOffAdj,
        stylistId, chairId, areaId, noOfCustomers,
        staffId, remarkText, createdBy, modifiedBy,
      ]
    );
  });
}

export async function insertSalesChild(client, row) {
  const {
    companyId, salesChildId, salesId, branchId, stationId,
    jobLineId, productId, shortDescription, groupId,
    qty, unitPrice, unitCost, packQty, discountAmount, lineTotal,
    tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
    subtotalAmount, stylistId, lineType, modifier, createdBy, modifiedBy,
  } = row;

  await client.query(
    `INSERT INTO ops.sales_child (
        company_id, sales_child_id, sales_id, branch_id, station_id,
        kot_child_id, product_id, short_description, group_id,
        qty, unit_price, unit_cost, pack_qty, discount_amount, line_total,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        subtotal_amount, stylist_id, line_type, modifier,
        created_by, modified_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
      )`,
    [
      companyId, salesChildId, salesId, branchId, stationId ?? branchId,
      jobLineId, productId, shortDescription, groupId,
      qty, unitPrice, unitCost, packQty, discountAmount, lineTotal,
      tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
      subtotalAmount, stylistId, lineType, modifier,
      createdBy, modifiedBy,
    ]
  );
}

export async function insertSalesPaymentSplit(client, row) {
  const {
    companyId, salesId, payerNo, payMode, billAmount, tipAmount = 0,
    branchId, counterId, staffId, refNo, creditCardTypeId = null,
  } = row;
  const counter = Number.isFinite(Number(counterId)) ? Math.trunc(Number(counterId)) : 0;
  try {
    await client.query(
      `INSERT INTO ops.sales_payment_split (
          company_id, sales_id, payer_no, pay_mode, bill_amount, tip_amount,
          branch_id, counter_id, staff_id, ref_no, credit_card_type_id,
          pay_date, is_cancelled
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW(), FALSE)`,
      [
        companyId, salesId, payerNo, payMode, billAmount, tipAmount,
        branchId, counter, staffId, refNo, creditCardTypeId,
      ]
    );
  } catch (e) {
    if (e.code !== '42703') throw e;
    await client.query(
      `INSERT INTO ops.sales_payment_split (
          company_id, sales_id, payer_no, pay_mode, bill_amount, tip_amount,
          branch_id, counter_id, staff_id, ref_no, pay_date, is_cancelled
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), FALSE)`,
      [
        companyId, salesId, payerNo, payMode, billAmount, tipAmount,
        branchId, counter, staffId, refNo,
      ]
    );
  }
}

export async function insertPaymentSplits(client, {
  companyId, salesId, branchId, counterNo, staffId, splits,
}) {
  let payerNo = 1;
  for (const s of splits) {
    await insertSalesPaymentSplit(client, {
      companyId,
      salesId,
      payerNo: payerNo++,
      payMode: s.payMode,
      billAmount: s.amount,
      tipAmount: s.tip ?? 0,
      branchId,
      counterId: counterNo,
      staffId,
      refNo: s.refNo || null,
      creditCardTypeId: s.creditCardTypeId ?? null,
    });
  }
}
