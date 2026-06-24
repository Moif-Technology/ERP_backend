/**
 * Data access for core.pos_device_enrollment (Counter-POS device pairing).
 */

export async function upsertEnrollment(pool, { deviceToken, companyId, branchId, stationId, label }) {
  await pool.query(
    `INSERT INTO core.pos_device_enrollment
       (device_token, company_id, branch_id, station_id, counter_no, label, enrolled_at, last_seen_at, record_status)
     VALUES ($1, $2, $3, $4, 1, $5, NOW(), NOW(), 'ACTIVE')
     ON CONFLICT (device_token) DO UPDATE
       SET company_id    = EXCLUDED.company_id,
           branch_id     = EXCLUDED.branch_id,
           station_id    = EXCLUDED.station_id,
           label         = EXCLUDED.label,
           last_seen_at  = NOW(),
           record_status = 'ACTIVE'`,
    [deviceToken, companyId, branchId, stationId ?? null, label ?? null]
  );
}

export async function findByToken(pool, deviceToken) {
  const { rows } = await pool.query(
    `SELECT company_id, branch_id, station_id, COALESCE(counter_no, 1) AS counter_no, label
     FROM core.pos_device_enrollment
     WHERE device_token = $1 AND record_status = 'ACTIVE'
     LIMIT 1`,
    [deviceToken]
  );
  return rows[0] ?? null;
}

export async function deactivate(pool, deviceToken) {
  await pool.query(
    `UPDATE core.pos_device_enrollment
     SET record_status = 'INACTIVE', last_seen_at = NOW()
     WHERE device_token = $1`,
    [deviceToken]
  );
}
