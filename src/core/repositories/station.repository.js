export async function listStationsByCompany(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT sm.station_id, sm.branch_id, sm.station_code, sm.station_name,
            sm.station_type, sm.counter_no, sm.status,
            bm.branch_name
     FROM core.station_master sm
     LEFT JOIN core.branch_master bm
       ON bm.company_id = sm.company_id AND bm.branch_id = sm.branch_id
     WHERE sm.company_id = $1 AND sm.is_deleted = FALSE
     ORDER BY sm.station_type, sm.station_id`,
    [companyId]
  );
  return rows;
}

export async function nextStationId(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(station_id), 0) + 1 AS n FROM core.station_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function insertStation(pool, { companyId, stationId, branchId, stationCode, stationName, stationType, counterNo, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO core.station_master
       (company_id, branch_id, station_id, station_code, station_name, station_type, counter_no, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8)
     RETURNING station_id, branch_id, station_code, station_name, station_type, counter_no, status`,
    [companyId, branchId, stationId, stationCode, stationName, stationType, counterNo ?? null, createdBy ?? null]
  );
  return rows[0];
}

export async function updateStation(pool, { companyId, stationId, branchId, stationCode, stationName, stationType, counterNo, modifiedBy }) {
  const { rows } = await pool.query(
    `UPDATE core.station_master SET
       branch_id = $3, station_code = $4, station_name = $5, station_type = $6,
       counter_no = $7, modified_by = $8, modified_at = NOW()
     WHERE company_id = $1 AND station_id = $2 AND is_deleted = FALSE
     RETURNING station_id, branch_id, station_code, station_name, station_type, counter_no, status`,
    [companyId, stationId, branchId, stationCode, stationName, stationType, counterNo ?? null, modifiedBy ?? null]
  );
  return rows[0] ?? null;
}

export async function softDeleteStation(pool, companyId, stationId, deletedBy) {
  const { rows } = await pool.query(
    `UPDATE core.station_master SET
       is_deleted = TRUE, deleted_at = NOW(), deleted_by = $3, status = 'INACTIVE'
     WHERE company_id = $1 AND station_id = $2 AND is_deleted = FALSE
     RETURNING station_id`,
    [companyId, stationId, deletedBy ?? null]
  );
  return rows[0] ?? null;
}
