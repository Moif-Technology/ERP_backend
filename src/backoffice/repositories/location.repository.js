export async function nextLocationId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(location_id), 0) + 1 AS next_id
     FROM core.location_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

export async function listLocationsByBranch(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT location_id, location_code, location_name
     FROM core.location_master
     WHERE company_id = $1 AND branch_id = $2 AND status = 'ACTIVE'
     ORDER BY location_name ASC`,
    [companyId, branchId]
  );
  return rows.map((r) => ({
    locationId:   Number(r.location_id),
    locationCode: r.location_code,
    locationName: r.location_name,
  }));
}

export async function insertLocation(client, { companyId, branchId, locationId, locationCode, locationName, createdBy }) {
  const { rows } = await client.query(
    `INSERT INTO core.location_master
       (company_id, branch_id, location_id, location_code, location_name, status, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,NOW(),NOW())
     RETURNING location_id, location_code, location_name`,
    [companyId, branchId, locationId, locationCode, locationName, createdBy || 'system']
  );
  return rows[0];
}

export async function updateLocation(client, { companyId, locationId, locationCode, locationName, modifiedBy }) {
  const { rows } = await client.query(
    `UPDATE core.location_master
     SET location_code = $3, location_name = $4, updated_at = NOW()
     WHERE company_id = $1 AND location_id = $2 AND status = 'ACTIVE'
     RETURNING location_id, location_code, location_name`,
    [companyId, locationId, locationCode, locationName]
  );
  return rows[0] ?? null;
}

export async function softDeleteLocation(client, companyId, locationId) {
  const { rowCount } = await client.query(
    `UPDATE core.location_master SET status = 'INACTIVE', updated_at = NOW()
     WHERE company_id = $1 AND location_id = $2 AND status = 'ACTIVE'`,
    [companyId, locationId]
  );
  return rowCount === 1;
}
