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
            sm.invoice_no,
            sm.bill_no,
            sm.bill_date,
            COALESCE(cm.customer_name, 'CASH CUSTOMER') AS customer,
            sm.payment_mode,
            sm.subtotal_amount,
            COALESCE(sm.tax_1_amount,0)+COALESCE(sm.tax_2_amount,0)+COALESCE(sm.tax_3_amount,0) AS tax_amount,
            sm.discount_amount,
            sm.amount
       FROM ops.sales_master sm
       LEFT JOIN biz.customer_master cm
         ON cm.company_id = sm.company_id AND cm.customer_id = sm.customer_id
      WHERE sm.company_id = $1
        AND ($2::integer IS NULL OR sm.branch_id = $2::integer)
        AND COALESCE(sm.record_status,'ACTIVE') = 'ACTIVE'
        AND COALESCE(sm.post_status,'') = 'POSTED'
        AND sm.entry_source = 'ERP'
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
