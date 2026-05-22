/**
 * Counter-POS product lookups — self-contained, no imports from shared repos.
 */

function mapProduct(row) {
  return {
    productId:   Number(row.product_id),
    productCode: row.product_code,
    barcode:     row.barcode ?? null,
    productName: row.product_name,
    shortName:   row.short_name ?? null,
    unitName:    row.unit_name  ?? null,
    groupId:     row.group_id   != null ? Number(row.group_id)   : null,
    subgroupId:  row.subgroup_id != null ? Number(row.subgroup_id) : null,
    inventory: {
      unitPrice:           row.unit_price           != null ? Number(row.unit_price)           : 0,
      minimumRetailPrice:  row.minimum_retail_price  != null ? Number(row.minimum_retail_price)  : 0,
      maximumRetailPrice:  row.maximum_retail_price  != null ? Number(row.maximum_retail_price)  : 0,
      qtyOnHand:           row.qty_on_hand           != null ? Number(row.qty_on_hand)           : 0,
      outputTax1Rate:      row.output_tax_1_rate      != null ? Number(row.output_tax_1_rate)      : 0,
    },
  };
}

export async function searchProduct(pool, companyId, branchId, { barcode = null, productCode = null }) {
  const params = [companyId, branchId];
  let filterSql = '';

  if (barcode != null && String(barcode).trim() !== '') {
    params.push(String(barcode).trim());
    filterSql = `AND m.barcode = $${params.length}`;
  } else if (productCode != null && String(productCode).trim() !== '') {
    params.push(String(productCode).trim().toLowerCase());
    filterSql = `AND LOWER(m.product_code) = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT m.product_id, m.product_code, m.barcode, m.product_name, m.short_name,
            m.unit_name, m.group_id, m.subgroup_id,
            i.unit_price, i.minimum_retail_price, i.maximum_retail_price,
            i.qty_on_hand, i.output_tax_1_rate
     FROM core.product_master m
     INNER JOIN core.product_inventory i
       ON m.company_id = i.company_id AND m.product_id = i.product_id
     WHERE m.company_id = $1
       AND i.branch_id  = $2
       AND m.record_status = 'ACTIVE'
       AND i.record_status = 'ACTIVE'
       ${filterSql}
     LIMIT 1`,
    params,
  );

  return rows.length > 0 ? mapProduct(rows[0]) : null;
}

export async function lookupProducts(pool, companyId, branchId, { q = '', maxPrice = null }) {
  const term = String(q).trim();
  const params = [companyId, branchId];
  const conditions = [];

  if (term) {
    params.push(`%${term.toLowerCase()}%`);
    params.push(term);
    conditions.push(
      `(LOWER(m.product_name) LIKE $${params.length - 1}
        OR LOWER(m.short_name)  LIKE $${params.length - 1}
        OR LOWER(m.product_code) LIKE $${params.length - 1}
        OR m.barcode = $${params.length})`,
    );
  }

  if (maxPrice != null && !Number.isNaN(Number(maxPrice))) {
    params.push(Number(maxPrice));
    conditions.push(`i.unit_price <= $${params.length}`);
  }

  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT m.product_id, m.product_code, m.barcode, m.product_name, m.short_name,
            m.unit_name, m.group_id, m.subgroup_id,
            i.unit_price, i.minimum_retail_price, i.maximum_retail_price,
            i.qty_on_hand, i.output_tax_1_rate
     FROM core.product_master m
     INNER JOIN core.product_inventory i
       ON m.company_id = i.company_id AND m.product_id = i.product_id
     WHERE m.company_id = $1
       AND i.branch_id  = $2
       AND m.record_status = 'ACTIVE'
       AND i.record_status = 'ACTIVE'
       ${whereExtra}
     ORDER BY m.product_name
     LIMIT 100`,
    params,
  );

  return rows.map(mapProduct);
}
