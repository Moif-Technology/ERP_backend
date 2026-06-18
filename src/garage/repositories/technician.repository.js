function map(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    empId: row.emp_id,
    techName: row.tech_name,
    specialisation: row.specialisation,
    phone: row.phone,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    modifiedAt: row.modified_at,
    modifiedBy: row.modified_by,
  };
}

export async function listTechnicians(pool, companyId, branchId, search) {
  const params = [companyId, branchId];
  let where = `WHERE company_id=$1 AND branch_id=$2`;
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (tech_name ILIKE $${params.length} OR COALESCE(emp_id,'') ILIKE $${params.length})`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM garage.technician ${where} ORDER BY tech_name`,
    params
  );
  return rows.map(map);
}

export async function findTechnicianById(pool, companyId, branchId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM garage.technician WHERE company_id=$1 AND branch_id=$2 AND id=$3 LIMIT 1`,
    [companyId, branchId, id]
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function insertTechnician(pool, p) {
  const { rows } = await pool.query(
    `INSERT INTO garage.technician (company_id,branch_id,emp_id,tech_name,specialisation,phone,status,created_by,modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$7) RETURNING *`,
    [p.companyId, p.branchId, p.empId, p.techName, p.specialisation, p.phone, p.createdBy]
  );
  return map(rows[0]);
}

export async function upsertTechnicianByEmpId(pool, p) {
  const existing = await pool.query(
    `SELECT id
     FROM garage.technician
     WHERE company_id=$1
       AND branch_id=$2
       AND emp_id=$3
     ORDER BY id
     LIMIT 1`,
    [p.companyId, p.branchId, p.empId]
  );

  if (existing.rows[0]?.id) {
    const { rows } = await pool.query(
      `UPDATE garage.technician
       SET tech_name=$4,
           specialisation=$5,
           phone=$6,
           status='ACTIVE',
           modified_at=NOW(),
           modified_by=$7
       WHERE company_id=$1
         AND branch_id=$2
         AND id=$3
       RETURNING *`,
      [
        p.companyId,
        p.branchId,
        existing.rows[0].id,
        p.techName,
        p.specialisation,
        p.phone,
        p.modifiedBy,
      ]
    );
    return map(rows[0]);
  }

  return insertTechnician(pool, {
    companyId: p.companyId,
    branchId: p.branchId,
    empId: p.empId,
    techName: p.techName,
    specialisation: p.specialisation,
    phone: p.phone,
    createdBy: p.createdBy,
  });
}

export async function updateTechnician(pool, companyId, branchId, id, p) {
  const { rows } = await pool.query(
    `UPDATE garage.technician SET emp_id=$4,tech_name=$5,specialisation=$6,phone=$7,status=$8,
       modified_at=NOW(),modified_by=$9
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING *`,
    [companyId, branchId, id, p.empId, p.techName, p.specialisation, p.phone, p.status, p.modifiedBy]
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function deleteTechnician(pool, companyId, branchId, id, modifiedBy) {
  const { rows } = await pool.query(
    `UPDATE garage.technician SET status='INACTIVE',modified_at=NOW(),modified_by=$4
     WHERE company_id=$1 AND branch_id=$2 AND id=$3 RETURNING id`,
    [companyId, branchId, id, modifiedBy]
  );
  return rows[0] ? true : false;
}
