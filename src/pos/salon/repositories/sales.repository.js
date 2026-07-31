/**
 * ops.sales_master / sales_child / sales_payment_split writes for Salon POS.
 *
 * Separate from the restaurant repository rather than shared, for two reasons:
 *   - entry_source is written as 'SALON-POS', which is how reports tell salon
 *     bills apart from restaurant ones in the same table;
 *   - needs job_id on the master and stylist_id / line_type on
 *     each line, and threading three nullable salon columns through the
 *     restaurant writer would put salon concerns in a hot restaurant path.
 *
 * Id allocation (nextSalesId / nextSalesChildId / nextBillNo) deliberately
 * mirrors the restaurant repository, including its MAX+1 approach. These ids
 * are per company and the callers hold an advisory lock for the whole
 * transaction, so concurrent tills cannot interleave. bill_no stays a plain
 * integer because the Flutter printing and receipt code parses it as one â€” see
 * the documented exception in api/CLAUDE.md.
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

export async function nextBillNo(client, companyId, stationId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(bill_no), 0) + 1 AS n
       FROM ops.sales_master
      WHERE company_id = $1 AND station_id = $2`,
    [companyId, stationId]
  );
  return Number(rows[0].n);
}

/**
 * The job as the settlement guard needs to see it. Locked FOR UPDATE so two
 * tills cannot both pass the "not settled yet" check for the same job.
 */
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

/**
 * Job lines keyed by line_id, used to fill in stylist_id / line_type for a
 * settlement line when the client did not send them. The job is the source of
 * truth for who performed a service â€” a client that omits the stylist must not
 * silently produce a bill with no one credited.
 */
export async function listJobLinesForSettlement(client, companyId, jobId) {
  const { rows } = await client.query(
    `SELECT line_id, product_id, line_type, stylist_id
       FROM ops.job_child
      WHERE company_id = $1 AND job_id = $2 AND is_deleted = FALSE`,
    [companyId, jobId]
  );
  return rows;
}

export async function markJobSettled(client, companyId, jobId, salesId, modifiedBy) {
  const { rowCount } = await client.query(
    `UPDATE ops.job_master
        SET job_status = 'SETTLED',
            sales_id   = $3,
            end_time   = COALESCE(end_time, NOW()),
            modified_by = $4,
            updated_at  = NOW()
      WHERE company_id = $1 AND job_id = $2
        AND job_status <> 'SETTLED'`,
    [companyId, jobId, salesId, modifiedBy]
  );
  return rowCount > 0;
}

export async function insertSalesMaster(client, row) {
  const {
    companyId, salesId, branchId, stationId, jobId, counterNo, billNo,
    customerId, paymentMode, creditCardNo,
    amount, cashAmount, creditCardAmount, paidAmount, balancePaid,
    discountAmount, subtotalAmount, taxableAmount,
    tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
    roundOffAdj, stylistId, chairId, areaId, noOfCustomers,
    staffId, remarks, createdBy, modifiedBy,
  } = row;

  await client.query(
    `INSERT INTO ops.sales_master (
        company_id, sales_id, branch_id, station_id, job_id,
        counter_no, bill_no, bill_date, bill_time,
        customer_id, payment_mode, credit_card_no,
        amount, cash_amount, credit_card_amount, paid_amount, balance_paid,
        discount_amount, subtotal_amount, taxable_amount,
        tax_1_amount, tax_2_amount, tax_3_amount,
        tax_1_rate, tax_2_rate, tax_3_rate,
        round_off_adjustment,
        waiter_id, table_id, area_id, no_of_customers,
        staff_id, remarks, entry_source, created_by, modified_by
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7, NOW(), NOW(),
        $8,$9,$10,
        $11,$12,$13,$14,$15,
        $16,$17,$18,
        $19,$20,$21,
        $22,$23,$24,
        $25,
        $26,$27,$28,$29,
        $30,$31,'SALON-POS',$32,$33
      )`,
    [
      companyId, salesId, branchId, stationId ?? branchId, jobId,
      counterNo, billNo,
      customerId, paymentMode, creditCardNo,
      amount, cashAmount, creditCardAmount, paidAmount, balancePaid,
      discountAmount, subtotalAmount, taxableAmount,
      tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
      roundOffAdj,
      // waiter_id carries the stylist and table_id the chair: the salon reuses
      // these columns rather than adding duplicates, and every downstream POS
      // report already reads them.
      stylistId, chairId, areaId, noOfCustomers,
      staffId, remarks, createdBy, modifiedBy,
    ]
  );
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
      // kot_child_id stores the salon job LINE id. The column is a plain BIGINT
      // with no foreign key, and it is what links a bill line back to the job
      // line it came from for per-stylist commission reporting.
      jobLineId, productId, shortDescription, groupId,
      qty, unitPrice, unitCost, packQty, discountAmount, lineTotal,
      tax1Amount, tax2Amount, tax3Amount, tax1Rate, tax2Rate, tax3Rate,
      subtotalAmount, stylistId, lineType, modifier,
      createdBy, modifiedBy,
    ]
  );
}

export async function insertSalesPaymentSplit(client, row) {
  const { companyId, salesId, payerNo, payMode, billAmount, branchId, counterId, staffId, refNo } = row;
  const counter = Number.isFinite(Number(counterId)) ? Math.trunc(Number(counterId)) : 0;
  await client.query(
    `INSERT INTO ops.sales_payment_split (
        company_id, sales_id, payer_no, pay_mode, bill_amount, tip_amount,
        branch_id, counter_id, staff_id, ref_no, pay_date, is_cancelled
      ) VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9, NOW(), FALSE)`,
    [companyId, salesId, payerNo, payMode, billAmount, branchId, counter, staffId, refNo]
  );
}

