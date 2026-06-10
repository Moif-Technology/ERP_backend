/**
 * ops.sales_master, ops.sales_child, ops.sales_payment_split (MOIFONE INDEXES).
 */

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

export async function nextBillNo(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(bill_no), 0) + 1 AS n
     FROM ops.sales_master
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId]
  );
  return Number(rows[0].n);
}

export async function insertSalesMaster(client, row) {
  const {
    companyId,
    salesId,
    branchId,
    kotMasterId,
    counterNo,
    billNo,
    customerId,
    paymentMode,
    creditCardNo,
    amount,
    cashAmount,
    creditAmount,
    creditCardAmount,
    paidAmount,
    balancePaid,
    discountAmount,
    subtotalAmount,
    taxableAmount,
    tax1Amount,
    tax2Amount,
    tax3Amount,
    tax1Rate,
    tax2Rate,
    tax3Rate,
    roundOffAdj,
    waiterId,
    tableId,
    areaId,
    noOfCustomers,
    staffId,
    remarks,
    createdBy,
    modifiedBy,
  } = row;
  await client.query(
    `INSERT INTO ops.sales_master (
        company_id, sales_id, branch_id, kot_master_id, counter_no, bill_no,
        bill_date, bill_time, customer_id, payment_mode, credit_card_no,
        amount, cash_amount, credit_amount, credit_card_amount, paid_amount, balance_paid, discount_amount,
        subtotal_amount, taxable_amount,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        round_off_adjustment,
        waiter_id, table_id, area_id, no_of_customers, staff_id, remarks,
        entry_source, created_by, modified_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6, NOW(), NOW(), $7,$8,$9,
        $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
        'RESTAURANT-POS',$32,$33
      )`,
    [
      companyId,
      salesId,
      branchId,
      kotMasterId,
      counterNo,
      billNo,
      customerId,
      paymentMode,
      creditCardNo,
      amount,
      cashAmount,
      creditAmount,
      creditCardAmount,
      paidAmount,
      balancePaid,
      discountAmount,
      subtotalAmount,
      taxableAmount,
      tax1Amount,
      tax2Amount,
      tax3Amount,
      tax1Rate,
      tax2Rate,
      tax3Rate,
      roundOffAdj,
      waiterId,
      tableId,
      areaId,
      noOfCustomers,
      staffId,
      remarks,
      createdBy,
      modifiedBy,
    ]
  );
}

export async function insertSalesChild(client, row) {
  const {
    companyId,
    salesChildId,
    salesId,
    branchId,
    kotChildId,
    productId,
    shortDescription,
    groupId,
    qty,
    unitPrice,
    unitCost,
    packQty,
    discountAmount,
    lineTotal,
    tax1Amount,
    tax2Amount,
    tax3Amount,
    tax1Rate,
    tax2Rate,
    tax3Rate,
    subtotalAmount,
    modifier,
    createdBy,
    modifiedBy,
    quotationId,
    doId,
  } = row;
  const qid = quotationId != null && Number.isFinite(Number(quotationId)) && Number(quotationId) >= 1 ? Math.trunc(Number(quotationId)) : null;
  const did = doId != null && Number.isFinite(Number(doId)) && Number(doId) >= 1 ? Math.trunc(Number(doId)) : null;
  await client.query(
    `INSERT INTO ops.sales_child (
        company_id, sales_child_id, sales_id, branch_id, kot_child_id, product_id,
        short_description, group_id, qty, unit_price, unit_cost, pack_qty,
        discount_amount, line_total,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        subtotal_amount, modifier, created_by, modified_by,
        quotation_id, do_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
      )`,
    [
      companyId,
      salesChildId,
      salesId,
      branchId,
      kotChildId,
      productId,
      shortDescription,
      groupId,
      qty,
      unitPrice,
      unitCost,
      packQty,
      discountAmount,
      lineTotal,
      tax1Amount,
      tax2Amount,
      tax3Amount,
      tax1Rate,
      tax2Rate,
      tax3Rate,
      subtotalAmount,
      modifier,
      createdBy,
      modifiedBy,
      qid,
      did,
    ]
  );
}

export async function insertSalesPaymentSplit(client, row) {
  const {
    companyId,
    salesId,
    payerNo,
    payMode,
    billAmount,
    branchId,
    counterId,
    staffId,
    refNo,
  } = row;
  const counter = counterId != null && Number.isFinite(Number(counterId)) ? Math.trunc(Number(counterId)) : 0;
  await client.query(
    `INSERT INTO ops.sales_payment_split (
        company_id, sales_id, payer_no, pay_mode, bill_amount, tip_amount, branch_id,
        counter_id, staff_id, ref_no,
        pay_date, is_cancelled
      ) VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9, NOW(), false)`,
    [companyId, salesId, payerNo, payMode, billAmount, branchId, counter, staffId, refNo]
  );
}
