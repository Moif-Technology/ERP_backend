/**
 * Back-office reports — read-only aggregate queries.
 * Tables: ops.sales_master / sales_child, ops.purchase_master / purchase_child,
 *         biz.customer_master / supplier_master, core.product_master / product_inventory,
 *         ops.product_log_entry, accounts.voucher_master / voucher_detail / account_head_master.
 * All queries are company + branch scoped.
 */

/* ───────────────────────── SALES ───────────────────────── */

// Daily Sales Summary — one row per bill.
export async function dailySales(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT sm.sales_id,
            COALESCE(sm.invoice_no, sm.bill_no::text, sm.sales_id::text) AS invoice_no,
            sm.bill_no,
            sm.bill_date,
            COALESCE(cm.customer_name, 'CASH CUSTOMER') AS customer,
            COALESCE(sm.payment_mode, 'CASH') AS payment_mode,
            COALESCE(sm.subtotal_amount, 0) AS subtotal_amount,
            COALESCE(sm.tax_1_amount,0)+COALESCE(sm.tax_2_amount,0)+COALESCE(sm.tax_3_amount,0) AS tax_amount,
            COALESCE(sm.discount_amount, 0) AS discount_amount,
            COALESCE(sm.amount, 0) AS amount,
            COALESCE(sm.post_status, 'DRAFT') AS post_status
       FROM ops.sales_master sm
       LEFT JOIN biz.customer_master cm
         ON cm.company_id = sm.company_id AND cm.customer_id = sm.customer_id
      WHERE sm.company_id = $1
        AND ($2::integer IS NULL OR sm.branch_id = $2::integer)
        AND UPPER(COALESCE(sm.record_status, 'ACTIVE')) <> 'CANCELLED'
        AND UPPER(COALESCE(TRIM(sm.transaction_type), '')) NOT IN ('RETURN', 'SALES RETURN')
        AND sm.bill_date >= $3::date
        AND sm.bill_date <  ($4::date + interval '1 day')
      ORDER BY sm.bill_date ASC, sm.sales_id ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Customer-Wise Sales — grouped per customer.
export async function customerWiseSales(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT COALESCE(cm.customer_name, 'CASH CUSTOMER') AS customer,
            COUNT(*)::int AS bills,
            COALESCE(SUM(sm.subtotal_amount),0) AS sub,
            COALESCE(SUM(sm.discount_amount),0) AS disc,
            COALESCE(SUM(COALESCE(sm.tax_1_amount,0)+COALESCE(sm.tax_2_amount,0)+COALESCE(sm.tax_3_amount,0)),0) AS tax,
            COALESCE(SUM(sm.amount),0) AS net
       FROM ops.sales_master sm
       LEFT JOIN biz.customer_master cm
         ON cm.company_id = sm.company_id AND cm.customer_id = sm.customer_id
      WHERE sm.company_id = $1 AND sm.branch_id = $2
        AND COALESCE(sm.record_status,'ACTIVE') = 'ACTIVE'
        AND sm.bill_date >= $3::date
        AND sm.bill_date <  ($4::date + interval '1 day')
      GROUP BY COALESCE(cm.customer_name, 'CASH CUSTOMER')
      ORDER BY net DESC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Product-Wise Sales — grouped per product (sales_child).
export async function productWiseSales(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT pm.product_code AS code,
            COALESCE(pm.product_name, sc.short_description) AS product,
            COALESCE(g.group_description, '') AS grp,
            COALESCE(SUM(sc.qty),0) AS qty,
            CASE WHEN COALESCE(SUM(sc.qty),0) > 0
                 THEN COALESCE(SUM(sc.line_total),0) / SUM(sc.qty)
                 ELSE 0 END AS rate,
            COALESCE(SUM(sc.subtotal_amount),0) AS sub,
            COALESCE(SUM(sc.discount_amount),0) AS disc,
            COALESCE(SUM(sc.line_total),0) AS net
       FROM ops.sales_child sc
       JOIN ops.sales_master sm
         ON sm.company_id = sc.company_id AND sm.sales_id = sc.sales_id
       LEFT JOIN core.product_master pm
         ON pm.company_id = sc.company_id AND pm.product_id = sc.product_id
       LEFT JOIN biz.group_master g
         ON g.company_id = pm.company_id AND g.group_id = pm.group_id
      WHERE sc.company_id = $1 AND sm.branch_id = $2
        AND COALESCE(sm.record_status,'ACTIVE') = 'ACTIVE'
        AND sm.bill_date >= $3::date
        AND sm.bill_date <  ($4::date + interval '1 day')
      GROUP BY pm.product_code, COALESCE(pm.product_name, sc.short_description), COALESCE(g.group_description,'')
      ORDER BY net DESC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Sales By Agent — grouped per staff (salesman).
export async function salesByAgent(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT COALESCE(st.staff_name, 'UNASSIGNED') AS agent,
            COUNT(*)::int AS bills,
            COUNT(DISTINCT sm.customer_id)::int AS customers,
            COALESCE(SUM(sm.subtotal_amount),0) AS sub,
            COALESCE(SUM(sm.discount_amount),0) AS disc,
            COALESCE(SUM(sm.amount),0) AS net
       FROM ops.sales_master sm
       LEFT JOIN core.staff_master st
         ON st.company_id = sm.company_id AND st.staff_id = sm.staff_id
      WHERE sm.company_id = $1 AND sm.branch_id = $2
        AND COALESCE(sm.record_status,'ACTIVE') = 'ACTIVE'
        AND sm.bill_date >= $3::date
        AND sm.bill_date <  ($4::date + interval '1 day')
      GROUP BY COALESCE(st.staff_name, 'UNASSIGNED')
      ORDER BY net DESC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Sales Return — bills flagged as return (negative amount or post_status RETURN).
export async function salesReturn(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT sm.bill_no AS ret_no,
            sm.bill_date,
            COALESCE(sm.remarks, '') AS orig_bill,
            COALESCE(cm.customer_name, 'CASH CUSTOMER') AS customer,
            COALESCE(sm.remarks, '') AS reason,
            ABS(sm.amount) AS amount,
            CASE WHEN sm.post_status = 'POSTED' THEN 'Approved' ELSE 'Pending' END AS status
       FROM ops.sales_master sm
       LEFT JOIN biz.customer_master cm
         ON cm.company_id = sm.company_id AND cm.customer_id = sm.customer_id
      WHERE sm.company_id = $1 AND sm.branch_id = $2
        AND COALESCE(sm.record_status,'ACTIVE') = 'ACTIVE'
        AND sm.amount < 0
        AND sm.bill_date >= $3::date
        AND sm.bill_date <  ($4::date + interval '1 day')
      ORDER BY sm.bill_date ASC, sm.sales_id ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

/* ──────────────────────── PURCHASE ──────────────────────── */

// Purchase Summary — one row per purchase bill.
export async function purchaseSummary(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT p.purchase_no AS bill_no,
            p.purchase_date,
            COALESCE(sp.supplier_name, 'UNKNOWN') AS supplier,
            (SELECT COUNT(*)::int FROM ops.purchase_child pc
              WHERE pc.company_id = p.company_id AND pc.purchase_id = p.purchase_id) AS items,
            COALESCE(p.subtotal_amount,0) AS sub,
            COALESCE(p.input_tax_1_amount,0)+COALESCE(p.input_tax_2_amount,0)+COALESCE(p.input_tax_3_amount,0) AS tax,
            COALESCE(p.discount_amount,0) AS disc,
            COALESCE(p.invoice_amount,0) AS net
       FROM ops.purchase_master p
       LEFT JOIN biz.supplier_master sp
         ON sp.company_id = p.company_id AND sp.supplier_id = p.supplier_id
      WHERE p.company_id = $1 AND p.branch_id = $2
        AND COALESCE(p.record_status,'ACTIVE') = 'ACTIVE'
        AND p.purchase_date >= $3::date
        AND p.purchase_date <  ($4::date + interval '1 day')
      ORDER BY p.purchase_date ASC, p.purchase_id ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Supplier-Wise Purchase — grouped per supplier.
export async function supplierWisePurchase(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT COALESCE(sp.supplier_name, 'UNKNOWN') AS supplier,
            COUNT(*)::int AS bills,
            COALESCE(SUM((SELECT COUNT(*) FROM ops.purchase_child pc
              WHERE pc.company_id = p.company_id AND pc.purchase_id = p.purchase_id)),0)::int AS items,
            COALESCE(SUM(p.subtotal_amount),0) AS sub,
            COALESCE(SUM(COALESCE(p.input_tax_1_amount,0)+COALESCE(p.input_tax_2_amount,0)+COALESCE(p.input_tax_3_amount,0)),0) AS tax,
            COALESCE(SUM(p.discount_amount),0) AS disc,
            COALESCE(SUM(p.invoice_amount),0) AS net
       FROM ops.purchase_master p
       LEFT JOIN biz.supplier_master sp
         ON sp.company_id = p.company_id AND sp.supplier_id = p.supplier_id
      WHERE p.company_id = $1 AND p.branch_id = $2
        AND COALESCE(p.record_status,'ACTIVE') = 'ACTIVE'
        AND p.purchase_date >= $3::date
        AND p.purchase_date <  ($4::date + interval '1 day')
      GROUP BY COALESCE(sp.supplier_name, 'UNKNOWN')
      ORDER BY net DESC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Purchase By Product — grouped per product from purchase_child.
export async function purchaseByProduct(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT pm.product_code AS code,
            COALESCE(pm.product_name, pc.own_ref_no, 'UNKNOWN') AS product,
            COALESCE(g.group_description, '') AS grp,
            COALESCE(SUM(pc.qty),0) AS qty,
            CASE WHEN COALESCE(SUM(pc.qty),0) > 0
                 THEN COALESCE(SUM(pc.line_amount),0) / SUM(pc.qty)
                 ELSE 0 END AS rate,
            COALESCE(SUM(pc.subtotal_amount),0) AS sub,
            COALESCE(SUM(pc.discount_amount),0) AS disc,
            COALESCE(SUM(pc.line_amount),0) AS net
       FROM ops.purchase_child pc
       JOIN ops.purchase_master p
         ON p.company_id = pc.company_id AND p.purchase_id = pc.purchase_id
       LEFT JOIN core.product_master pm
         ON pm.company_id = pc.company_id AND pm.product_id = pc.product_id
       LEFT JOIN biz.group_master g
         ON g.company_id = pm.company_id AND g.group_id = pm.group_id
      WHERE pc.company_id = $1 AND p.branch_id = $2
        AND COALESCE(p.record_status,'ACTIVE') = 'ACTIVE'
        AND (p.transaction_type IS NULL OR p.transaction_type != 'RETURN')
        AND p.purchase_date >= $3::date
        AND p.purchase_date <  ($4::date + interval '1 day')
      GROUP BY pm.product_code, COALESCE(pm.product_name, pc.own_ref_no, 'UNKNOWN'), COALESCE(g.group_description,'')
      ORDER BY net DESC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Purchase Return — supplier returns (transaction_type = 'RETURN').
export async function purchaseReturn(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT COALESCE(p.return_no, p.purchase_no) AS bill_no,
            p.purchase_date,
            COALESCE(sp.supplier_name, 'UNKNOWN') AS supplier,
            (SELECT COUNT(*)::int FROM ops.purchase_child pc
              WHERE pc.company_id = p.company_id AND pc.purchase_id = p.purchase_id) AS items,
            COALESCE(p.subtotal_amount,0) AS sub,
            COALESCE(p.input_tax_1_amount,0)+COALESCE(p.input_tax_2_amount,0)+COALESCE(p.input_tax_3_amount,0) AS tax,
            COALESCE(p.discount_amount,0) AS disc,
            ABS(COALESCE(p.invoice_amount,0)) AS net
       FROM ops.purchase_master p
       LEFT JOIN biz.supplier_master sp
         ON sp.company_id = p.company_id AND sp.supplier_id = p.supplier_id
      WHERE p.company_id = $1 AND p.branch_id = $2
        AND p.transaction_type = 'RETURN'
        AND COALESCE(p.record_status,'ACTIVE') = 'ACTIVE'
        AND p.purchase_date >= $3::date
        AND p.purchase_date <  ($4::date + interval '1 day')
      ORDER BY p.purchase_date ASC, p.purchase_id ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Outstanding LPO — open / partial LPOs not yet closed or received.
export async function outstandingLPO(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT lm.lpo_no,
            lm.lpo_date,
            COALESCE(sp.supplier_name, lm.supplier_display_name, 'UNKNOWN') AS supplier,
            lm.status,
            (SELECT COUNT(*)::int FROM ops.lpo_child lc
              WHERE lc.company_id = lm.company_id AND lc.lpo_master_id = lm.lpo_master_id
                AND (lc.record_status IS NULL OR lc.record_status = 'ACTIVE')) AS items,
            COALESCE(lm.sub_total,0) AS sub,
            COALESCE(lm.discount_amount,0) AS disc,
            COALESCE(lm.lpo_amount,0) AS net
       FROM ops.lpo_master lm
       LEFT JOIN biz.supplier_master sp
         ON sp.company_id = lm.company_id AND sp.supplier_id = lm.supplier_id
      WHERE lm.company_id = $1 AND lm.branch_id = $2
        AND (lm.record_status IS NULL OR lm.record_status = 'ACTIVE')
        AND lm.status NOT IN ('CLOSED', 'RECEIVED')
      ORDER BY lm.lpo_date DESC, lm.lpo_master_id DESC`,
    [companyId, branchId],
  );
  return rows;
}

/* ───────────────────────── STOCK ───────────────────────── */

// Stock Summary — current on-hand + value, with in/out within period.
export async function stockSummary(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT pm.product_code AS code,
            pm.product_name AS product,
            COALESCE(g.group_description,'') AS grp,
            COALESCE(i.qty_on_hand,0) AS close_qty,
            COALESCE(i.average_cost, i.last_purchase_cost, 0) AS cost_price,
            COALESCE(i.qty_on_hand,0) * COALESCE(i.average_cost, i.last_purchase_cost, 0) AS stock_value,
            COALESCE((SELECT SUM(ple.qty) FROM ops.product_log_entry ple
               WHERE ple.company_id = i.company_id AND ple.branch_id = i.branch_id
                 AND ple.product_id = i.product_id AND ple.qty > 0
                 AND ple.transaction_date >= $3::date
                 AND ple.transaction_date < ($4::date + interval '1 day')),0) AS in_qty,
            COALESCE((SELECT SUM(ABS(ple.qty)) FROM ops.product_log_entry ple
               WHERE ple.company_id = i.company_id AND ple.branch_id = i.branch_id
                 AND ple.product_id = i.product_id AND ple.qty < 0
                 AND ple.transaction_date >= $3::date
                 AND ple.transaction_date < ($4::date + interval '1 day')),0) AS out_qty
       FROM core.product_inventory i
       JOIN core.product_master pm
         ON pm.company_id = i.company_id AND pm.product_id = i.product_id
       LEFT JOIN biz.group_master g
         ON g.company_id = pm.company_id AND g.group_id = pm.group_id
      WHERE i.company_id = $1 AND i.branch_id = $2
        AND COALESCE(i.record_status,'ACTIVE') = 'ACTIVE'
        AND COALESCE(pm.record_status,'ACTIVE') = 'ACTIVE'
      ORDER BY pm.product_name ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

// Stock Ledger — movement history. productId optional; when null, all products.
export async function stockLedger(pool, companyId, branchId, productId, dateFrom, dateTo) {
  const params = [companyId, branchId, dateFrom, dateTo];
  let productFilter = '';
  if (productId != null) {
    params.push(productId);
    productFilter = ` AND ple.product_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT ple.transaction_date AS date,
            COALESCE(ple.transaction_id::text, '') AS voucher,
            COALESCE(ple.transaction_type, '') AS type,
            COALESCE(pm.product_name, '') AS ref,
            CASE WHEN ple.qty > 0 THEN ple.qty ELSE 0 END AS in_qty,
            CASE WHEN ple.qty < 0 THEN ABS(ple.qty) ELSE 0 END AS out_qty,
            ple.balance_qty AS balance
       FROM ops.product_log_entry ple
       LEFT JOIN core.product_master pm
         ON pm.company_id = ple.company_id AND pm.product_id = ple.product_id
      WHERE ple.company_id = $1 AND ple.branch_id = $2
        AND ple.transaction_date >= $3::date
        AND ple.transaction_date < ($4::date + interval '1 day')${productFilter}
      ORDER BY ple.product_log_id ASC`,
    params,
  );
  return rows;
}

// Reorder — products at/below reorder level.
export async function reorder(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT pm.product_code AS code,
            pm.product_name AS product,
            COALESCE(g.group_description,'') AS grp,
            COALESCE(i.qty_on_hand,0) AS current_qty,
            COALESCE(i.reorder_level,0) AS reorder_point,
            COALESCE(i.reorder_qty,0) AS reorder_qty,
            COALESCE(sp.supplier_name,'') AS supplier
       FROM core.product_inventory i
       JOIN core.product_master pm
         ON pm.company_id = i.company_id AND pm.product_id = i.product_id
       LEFT JOIN biz.group_master g
         ON g.company_id = pm.company_id AND g.group_id = pm.group_id
       LEFT JOIN biz.supplier_master sp
         ON sp.company_id = pm.company_id AND sp.supplier_id = pm.last_supplier_id
      WHERE i.company_id = $1 AND i.branch_id = $2
        AND COALESCE(i.record_status,'ACTIVE') = 'ACTIVE'
        AND COALESCE(pm.record_status,'ACTIVE') = 'ACTIVE'
        AND COALESCE(i.reorder_level,0) > 0
        AND COALESCE(i.qty_on_hand,0) <= COALESCE(i.reorder_level,0)
      ORDER BY (COALESCE(i.qty_on_hand,0) - COALESCE(i.reorder_level,0)) ASC`,
    [companyId, branchId],
  );
  return rows;
}

/* ──────────────────────── ACCOUNTS ──────────────────────── */

// Cash & Bank Movement — voucher detail lines hitting cash/bank ledgers.
export async function cashBankMovement(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT vm.voucher_date AS date,
            COALESCE(vm.auto_voucher_no::text, '') AS voucher,
            COALESCE(vt.voucher_name, '') AS type,
            ah.account_head AS account,
            COALESCE(vd.narration, '') AS narration,
            COALESCE(vd.debit_amount,0) AS debit,
            COALESCE(vd.credit_amount,0) AS credit
       FROM accounts.voucher_detail vd
       JOIN accounts.voucher_master vm
         ON vm.company_id = vd.company_id AND vm.branch_id = vd.branch_id
        AND vm.voucher_master_id = vd.voucher_master_id
       JOIN accounts.account_head_master ah
         ON ah.company_id = vd.company_id AND ah.account_id = vd.account_id
       LEFT JOIN accounts.voucher_type_master vt
         ON vt.company_id = vm.company_id AND vt.voucher_type_id = vm.voucher_type_id
      WHERE vd.company_id = $1 AND vd.branch_id = $2
        AND COALESCE(vd.record_status,'ACTIVE') = 'ACTIVE'
        AND COALESCE(vm.record_status,'ACTIVE') = 'ACTIVE'
        AND (ah.account_head ILIKE '%CASH%' OR ah.account_head ILIKE '%BANK%')
        AND vm.voucher_date >= $3::date
        AND vm.voucher_date < ($4::date + interval '1 day')
      ORDER BY vm.voucher_date ASC, vd.voucher_detail_id ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

/* ──────────────────────── HR ──────────────────────── */

export async function attendanceReport(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT ad.work_date,
            em.employee_code,
            em.employee_name,
            COALESCE(em.department, '') AS department,
            COALESCE(ad.first_in::text, '') AS first_in,
            COALESCE(ad.last_out::text, '') AS last_out,
            CASE WHEN ad.first_in IS NOT NULL AND ad.last_out >= ad.first_in
              THEN ROUND((EXTRACT(EPOCH FROM (ad.last_out - ad.first_in)) / 3600)::numeric, 2)
              ELSE NULL END AS hours,
            COALESCE(ad.ot_hours, 0) AS ot_hours,
            COALESCE(ad.attendance_status, '') AS status
       FROM hr.attendance_daily ad
       JOIN hr.employee_master em
         ON em.company_id = ad.company_id AND em.branch_id = ad.branch_id AND em.employee_id = ad.employee_id
      WHERE ad.company_id = $1 AND ad.branch_id = $2
        AND ad.work_date >= $3::date
        AND ad.work_date < ($4::date + interval '1 day')
      ORDER BY ad.work_date DESC, em.employee_name ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}

export async function leaveReport(pool, companyId, branchId, dateFrom, dateTo) {
  const { rows } = await pool.query(
    `SELECT em.employee_code,
            em.employee_name,
            COALESCE(em.department, '') AS department,
            COALESCE(ltm.leave_name, '') AS leave_type,
            lr.from_date,
            lr.to_date,
            COALESCE(lr.total_days, 0) AS total_days,
            COALESCE(lr.request_status, '') AS status
       FROM hr.leave_request lr
       JOIN hr.employee_master em
         ON em.company_id = lr.company_id AND em.branch_id = lr.branch_id AND em.employee_id = lr.employee_id
       LEFT JOIN hr.leave_type_master ltm
         ON ltm.company_id = lr.company_id AND ltm.branch_id = lr.branch_id AND ltm.leave_type_id = lr.leave_type_id
      WHERE lr.company_id = $1 AND lr.branch_id = $2
        AND lr.from_date >= $3::date
        AND lr.from_date < ($4::date + interval '1 day')
      ORDER BY lr.from_date DESC, em.employee_name ASC`,
    [companyId, branchId, dateFrom, dateTo],
  );
  return rows;
}
