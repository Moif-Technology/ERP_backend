export async function nextSubstituteId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(product_substitute_id), 0) + 1 AS next_id
     FROM biz.product_substitute WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

export async function listSubstitutes(pool, companyId, productId, branchId) {
  const { rows } = await pool.query(
    `SELECT ps.substitute_product_unique_id AS product_id,
            m.product_code,
            m.product_name,
            m.short_name,
            COALESCE(i.unit_price, 0) AS unit_price
     FROM biz.product_substitute ps
     INNER JOIN core.product_master m
       ON m.company_id = ps.company_id AND m.product_id = ps.substitute_product_unique_id
     LEFT JOIN core.product_inventory i
       ON i.company_id = ps.company_id
          AND i.product_id = ps.substitute_product_unique_id
          AND i.branch_id = $3
     WHERE ps.company_id = $1
       AND ps.product_unique_id = $2
       AND ps.record_status = 'ACTIVE'
       AND m.record_status = 'ACTIVE'
     ORDER BY m.product_name ASC`,
    [companyId, productId, branchId]
  );
  return rows.map((r) => ({
    productId:   Number(r.product_id),
    productCode: r.product_code,
    productName: r.product_name,
    shortName:   r.short_name ?? null,
    unitPrice:   Number(r.unit_price) || 0,
  }));
}

export async function saveSubstitutes(client, companyId, productId, substituteProductIds) {
  await client.query(
    `UPDATE biz.product_substitute
     SET record_status = 'DELETED', modified_on = NOW()
     WHERE company_id = $1 AND product_unique_id = $2 AND record_status = 'ACTIVE'`,
    [companyId, productId]
  );
  if (!Array.isArray(substituteProductIds) || substituteProductIds.length === 0) return;
  for (const subId of substituteProductIds) {
    if (Number(subId) === Number(productId)) continue;
    const sid = await nextSubstituteId(client, companyId);
    await client.query(
      `INSERT INTO biz.product_substitute
         (product_substitute_id, company_id, product_unique_id, substitute_product_unique_id,
          record_status, created_on, modified_on)
       VALUES ($1,$2,$3,$4,'ACTIVE',NOW(),NOW())
       ON CONFLICT (company_id, product_unique_id, substitute_product_unique_id)
       DO UPDATE SET record_status = 'ACTIVE', modified_on = NOW()`,
      [sid, companyId, productId, Number(subId)]
    );
  }
}
