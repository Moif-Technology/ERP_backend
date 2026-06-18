function map(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    jobCardId: row.job_card_id == null ? null : Number(row.job_card_id),
    jcNo: row.jc_no,
    productId: row.product_id == null ? null : Number(row.product_id),
    productCode: row.product_code,
    description: row.description,
    unitName: row.unit_name,
    qty: row.qty == null ? null : Number(row.qty),
    unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
    totalCost: row.total_cost == null ? null : Number(row.total_cost),
    createdAt: row.created_at,
    createdBy: row.created_by,
    modifiedAt: row.modified_at,
    modifiedBy: row.modified_by,
  };
}

export async function listLubricants(pool, companyId, branchId, jobCardId) {
  const params = [companyId, branchId];
  let where = `WHERE company_id=$1 AND branch_id=$2`;
  if (jobCardId) { params.push(jobCardId); where += ` AND job_card_id=$${params.length}`; }
  const { rows } = await pool.query(
    `SELECT * FROM garage.lubricant_usage ${where} ORDER BY created_at DESC`,
    params
  );
  return rows.map(map);
}

export async function findLubricantById(pool, companyId, branchId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM garage.lubricant_usage WHERE company_id=$1 AND branch_id=$2 AND id=$3 LIMIT 1`,
    [companyId, branchId, id]
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function insertLubricant(pool, p) {
  const { rows } = await pool.query(
    `INSERT INTO garage.lubricant_usage (company_id,branch_id,job_card_id,jc_no,product_id,product_code,description,unit_name,qty,unit_cost,total_cost,created_by,modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
    [p.companyId, p.branchId, p.jobCardId, p.jcNo, p.productId, p.productCode,
     p.description, p.unitName, p.qty, p.unitCost, p.totalCost, p.createdBy]
  );
  return map(rows[0]);
}

export async function updateLubricant(pool, companyId, branchId, id, p) {
  const { rows } = await pool.query(
    `UPDATE garage.lubricant_usage SET product_id=$4,product_code=$5,description=$6,unit_name=$7,qty=$8,unit_cost=$9,total_cost=$10,
       modified_at=NOW(),modified_by=$11
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING *`,
    [companyId, branchId, id, p.productId, p.productCode, p.description,
     p.unitName, p.qty, p.unitCost, p.totalCost, p.modifiedBy]
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function deleteLubricant(pool, companyId, branchId, id) {
  const { rows } = await pool.query(
    `DELETE FROM garage.lubricant_usage WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING id`,
    [companyId, branchId, id]
  );
  return rows[0] ? true : false;
}
