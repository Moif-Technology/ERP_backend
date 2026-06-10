export async function listDevices(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT
        d.id,
        d.device_token,
        d.company_id,
        d.branch_id,
        COALESCE(d.counter_no, 1) AS counter_no,
        d.label,
        d.enrolled_at,
        d.last_seen_at,
        d.record_status,
        b.branch_name
     FROM core.pos_device_enrollment d
     LEFT JOIN core.branch_master b
       ON b.company_id = d.company_id
      AND b.branch_id = d.branch_id
     WHERE d.company_id = $1
     ORDER BY d.record_status = 'ACTIVE' DESC, d.last_seen_at DESC NULLS LAST, d.id DESC`,
    [companyId],
  );
  return rows;
}

export async function updateDevice(pool, { companyId, deviceId, label, branchId, counterNo, recordStatus }) {
  const { rows } = await pool.query(
    `UPDATE core.pos_device_enrollment
     SET label = $3,
         branch_id = $4,
         counter_no = $5,
         record_status = $6,
         last_seen_at = NOW()
     WHERE company_id = $1
       AND id = $2
     RETURNING id, device_token, company_id, branch_id, counter_no, label, enrolled_at, last_seen_at, record_status`,
    [companyId, deviceId, label, branchId, counterNo, recordStatus],
  );
  return rows[0] ?? null;
}
