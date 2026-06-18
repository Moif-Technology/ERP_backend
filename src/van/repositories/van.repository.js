export async function getVanDaySummary(pool, companyId, branchId, staffId, date) {
  const { rows } = await pool.query(
    `SELECT sm.sales_id,
            sm.bill_no,
            sm.bill_date,
            sm.payment_mode,
            sm.amount,
            sm.subtotal_amount,
            COALESCE(sm.tax_1_amount, 0) + COALESCE(sm.tax_2_amount, 0) + COALESCE(sm.tax_3_amount, 0) AS tax_amount,
            sm.discount_amount,
            sm.customer_id,
            cm.customer_name,
            cm.customer_code
     FROM ops.sales_master sm
     LEFT JOIN biz.customer_master cm
       ON cm.company_id = sm.company_id
      AND cm.customer_id = sm.customer_id
     WHERE sm.company_id = $1
       AND sm.branch_id  = $2
       AND sm.staff_id   = $3
       AND sm.bill_date::date = $4::date
     ORDER BY sm.sales_id DESC`,
    [companyId, branchId, staffId, date],
  );
  return rows;
}
