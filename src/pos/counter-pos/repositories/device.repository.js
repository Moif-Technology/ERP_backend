/**
 * Data access for core.pos_device_enrollment (Counter-POS device pairing).
 */

export async function upsertEnrollment(pool, { deviceToken, companyId, branchId, stationId, counterNo, label }) {
  // One ACTIVE row per company + station (uq_pos_device_enrollment_active_station).
  // Restaurant and salon enroll take the station over. Counter-POS checks
  // findOtherOnStation first and only calls this after an explicit move.
  const isPool = pool?.totalCount !== undefined && typeof pool.connect === 'function';
  const client = isPool ? await pool.connect() : pool;
  const ownClient = isPool;
  try {
    if (ownClient) await client.query('BEGIN');
    if (stationId != null) {
      await client.query(
        `UPDATE core.pos_device_enrollment
            SET record_status = 'INACTIVE',
                last_seen_at  = NOW()
          WHERE company_id = $1
            AND station_id = $2
            AND device_token <> $3
            AND record_status = 'ACTIVE'`,
        [companyId, stationId, deviceToken],
      );
    }
    await client.query(
      `INSERT INTO core.pos_device_enrollment
         (device_token, company_id, branch_id, station_id, counter_no, label, enrolled_at, last_seen_at, record_status)
       VALUES ($1, $2, $3, $4, $6, $5, NOW(), NOW(), 'ACTIVE')
      ON CONFLICT (device_token) DO UPDATE
         SET company_id    = EXCLUDED.company_id,
             branch_id     = EXCLUDED.branch_id,
             station_id    = EXCLUDED.station_id,
             counter_no    = EXCLUDED.counter_no,
             label         = EXCLUDED.label,
             last_seen_at  = NOW(),
             record_status = 'ACTIVE'`,
      [deviceToken, companyId, branchId, stationId ?? null, label ?? null, counterNo ?? 1],
    );
    if (ownClient) await client.query('COMMIT');
  } catch (err) {
    if (ownClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownClient) client.release();
  }
}

/** Active terminal (other than this one) already holding the station, if any. */
export async function findOtherOnStation(pool, { companyId, stationId, deviceToken }) {
  const { rows } = await pool.query(
    `SELECT device_token, label, last_seen_at
     FROM core.pos_device_enrollment
     WHERE company_id = $1 AND station_id = $2 AND record_status = 'ACTIVE' AND device_token <> $3
     LIMIT 1`,
    [companyId, stationId, deviceToken]
  );
  return rows[0] ?? null;
}

/** Release the station from every other terminal (admin "move here"). */
export async function releaseStation(pool, { companyId, stationId, deviceToken }) {
  await pool.query(
    `UPDATE core.pos_device_enrollment
     SET record_status = 'INACTIVE', last_seen_at = NOW()
     WHERE company_id = $1 AND station_id = $2 AND record_status = 'ACTIVE' AND device_token <> $3`,
    [companyId, stationId, deviceToken]
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
