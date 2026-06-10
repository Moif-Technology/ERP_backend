function mapLpo(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    lpoNo: row.lpo_no,
    subletJobId: row.sublet_job_id == null ? null : Number(row.sublet_job_id),
    vendorId: row.vendor_id == null ? null : Number(row.vendor_id),
    vendorName: row.vendor_name,
    lpoDate: row.lpo_date,
    amount: row.amount == null ? null : Number(row.amount),
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    modifiedAt: row.modified_at,
    modifiedBy: row.modified_by,
  };
}

export async function nextLpoNo(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(lpo_no,'[^0-9]','','g'),'') AS BIGINT)),0)+1 AS next_seq
     FROM garage.sublet_lpo WHERE company_id=$1 AND branch_id=$2`,
    [companyId, branchId]
  );
  return `SLPO-${String(rows[0].next_seq).padStart(5, '0')}`;
}

export async function listSubletLpos(pool, companyId, branchId, filters) {
  const params = [companyId, branchId];
  let where = `WHERE company_id=$1 AND branch_id=$2`;
  if (filters.subletJobId) { params.push(filters.subletJobId); where += ` AND sublet_job_id=$${params.length}`; }
  if (filters.status) { params.push(filters.status); where += ` AND status=$${params.length}`; }
  const { rows } = await pool.query(
    `SELECT * FROM garage.sublet_lpo ${where} ORDER BY created_at DESC`,
    params
  );
  return rows.map(mapLpo);
}

export async function findSubletLpoById(pool, companyId, branchId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM garage.sublet_lpo WHERE company_id=$1 AND branch_id=$2 AND id=$3 LIMIT 1`,
    [companyId, branchId, id]
  );
  return rows[0] ? mapLpo(rows[0]) : null;
}

export async function insertSubletLpo(pool, p) {
  const { rows } = await pool.query(
    `INSERT INTO garage.sublet_lpo (company_id,branch_id,lpo_no,sublet_job_id,vendor_id,vendor_name,lpo_date,amount,status,created_by,modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9,$9) RETURNING *`,
    [p.companyId, p.branchId, p.lpoNo, p.subletJobId, p.vendorId, p.vendorName, p.lpoDate, p.amount, p.createdBy]
  );
  return mapLpo(rows[0]);
}

export async function updateSubletLpo(pool, companyId, branchId, id, p) {
  const { rows } = await pool.query(
    `UPDATE garage.sublet_lpo SET vendor_id=$4,vendor_name=$5,lpo_date=$6,amount=$7,modified_at=NOW(),modified_by=$8
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 AND status='OPEN' RETURNING *`,
    [companyId, branchId, id, p.vendorId, p.vendorName, p.lpoDate, p.amount, p.modifiedBy]
  );
  return rows[0] ? mapLpo(rows[0]) : null;
}

export async function setSubletLpoStatus(pool, companyId, branchId, id, status, modifiedBy) {
  const { rows } = await pool.query(
    `UPDATE garage.sublet_lpo SET status=$4,modified_at=NOW(),modified_by=$5
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING *`,
    [companyId, branchId, id, status, modifiedBy]
  );
  return rows[0] ? mapLpo(rows[0]) : null;
}
