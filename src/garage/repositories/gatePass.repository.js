function map(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    gpNo: row.gp_no,
    jobCardId: row.job_card_id == null ? null : Number(row.job_card_id),
    jcNo: row.jc_no,
    vehicleId: row.vehicle_id == null ? null : Number(row.vehicle_id),
    regNo: row.reg_no,
    passType: row.pass_type,
    passDate: row.pass_date,
    kmReading: row.km_reading == null ? null : Number(row.km_reading),
    issuedBy: row.issued_by,
    remarks: row.remarks,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function nextGpNo(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(gp_no,'[^0-9]','','g'),'') AS BIGINT)),0)+1 AS next_seq
     FROM garage.gate_pass WHERE company_id=$1 AND branch_id=$2`,
    [companyId, branchId]
  );
  return `GP-${String(rows[0].next_seq).padStart(5, '0')}`;
}

export async function listGatePasses(pool, companyId, branchId, filters) {
  const params = [companyId, branchId];
  let where = `WHERE company_id=$1 AND branch_id=$2`;
  if (filters.jobCardId) { params.push(filters.jobCardId); where += ` AND job_card_id=$${params.length}`; }
  if (filters.passType) { params.push(filters.passType); where += ` AND pass_type=$${params.length}`; }
  const { rows } = await pool.query(
    `SELECT * FROM garage.gate_pass ${where} ORDER BY created_at DESC`,
    params
  );
  return rows.map(map);
}

export async function findGatePassById(pool, companyId, branchId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM garage.gate_pass WHERE company_id=$1 AND branch_id=$2 AND id=$3 LIMIT 1`,
    [companyId, branchId, id]
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function insertGatePass(pool, p) {
  const { rows } = await pool.query(
    `INSERT INTO garage.gate_pass (company_id,branch_id,gp_no,job_card_id,jc_no,vehicle_id,reg_no,pass_type,pass_date,km_reading,issued_by,remarks,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [p.companyId, p.branchId, p.gpNo, p.jobCardId, p.jcNo, p.vehicleId,
     p.regNo, p.passType, p.passDate, p.kmReading, p.issuedBy, p.remarks, p.createdBy]
  );
  return map(rows[0]);
}
