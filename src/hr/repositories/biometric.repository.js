// Raw SQL for the biometric attendance bridge (migration 106).
//
// Kept out of hr.repository.js because the device-facing half of this feature
// authenticates with a device token instead of a staff session, and mixing the
// two lookup paths in one file makes it easy to reach for a session-scoped
// helper on a route that has no session.

function asNumber(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function nextId(client, table, idCol, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(${idCol}), 0) + 1 AS next_id FROM hr.${table} WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId],
  );
  return Number(rows[0].next_id);
}

export const nextStagingId = (c, co, br) => nextId(c, 'attendance_biometric_staging', 'staging_id', co, br);
export const nextSyncJobId = (c, co, br) => nextId(c, 'attendance_sync_job', 'job_id', co, br);
// Same allocation hr.repository uses for manual attendance entry. Re-exported
// here so the sync path does not have to import both repositories.
export const nextDailyId = (c, co, br) => nextId(c, 'attendance_daily', 'daily_id', co, br);

// ── Device tokens ─────────────────────────────────────
export async function findTokenByHash(pool, tokenHash) {
  const { rows } = await pool.query(
    `SELECT token_id, company_id, branch_id, label, is_active
       FROM hr.biometric_device_token
      WHERE token_hash = $1`,
    [tokenHash],
  );
  if (!rows[0]) return null;
  return {
    tokenId: Number(rows[0].token_id),
    companyId: Number(rows[0].company_id),
    branchId: Number(rows[0].branch_id),
    label: rows[0].label,
    isActive: rows[0].is_active,
  };
}

export async function touchToken(pool, tokenId, ip) {
  await pool.query(
    `UPDATE hr.biometric_device_token
        SET last_seen_at = now(), last_seen_ip = $2
      WHERE token_id = $1`,
    [tokenId, ip ? String(ip).slice(0, 64) : null],
  );
}

export async function markTokenSync(client, tokenId, rowCount) {
  await client.query(
    `UPDATE hr.biometric_device_token
        SET last_sync_at = now(), last_sync_rows = $2
      WHERE token_id = $1`,
    [tokenId, rowCount],
  );
}

export async function listTokens(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT token_id, label, is_active, last_seen_at, last_seen_ip, last_sync_at, last_sync_rows, created_at
       FROM hr.biometric_device_token
      WHERE company_id = $1 AND branch_id = $2
      ORDER BY token_id`,
    [companyId, branchId],
  );
  return rows.map((r) => ({
    tokenId: Number(r.token_id),
    label: r.label,
    isActive: r.is_active,
    lastSeenAt: r.last_seen_at,
    lastSeenIp: r.last_seen_ip,
    lastSyncAt: r.last_sync_at,
    lastSyncRows: Number(r.last_sync_rows),
    createdAt: r.created_at,
  }));
}

export async function insertToken(client, d) {
  const { rows } = await client.query(
    `INSERT INTO hr.biometric_device_token (company_id, branch_id, token_hash, label)
     VALUES ($1,$2,$3,$4)
     RETURNING token_id`,
    [d.companyId, d.branchId, d.tokenHash, d.label ?? null],
  );
  return { tokenId: Number(rows[0].token_id) };
}

// ── PIN resolution ────────────────────────────────────
// One query for the whole batch: a sync can carry a month of rows for thirty
// people, and resolving each PIN with its own round trip made the endpoint
// visibly slow over the tunnel.
export async function resolvePins(pool, companyId, branchId, pins) {
  if (!pins.length) return new Map();
  const { rows } = await pool.query(
    `SELECT pin, employee_id FROM (
        SELECT m.device_pin AS pin, m.employee_id, 1 AS priority
          FROM hr.biometric_pin_map m
          JOIN hr.employee_master e
            ON e.company_id = m.company_id AND e.branch_id = m.branch_id
           AND e.employee_id = m.employee_id AND e.is_deleted = FALSE
         WHERE m.company_id = $1 AND m.branch_id = $2 AND m.device_pin = ANY($3::text[])
        UNION ALL
        SELECT e.employee_code AS pin, e.employee_id, 2 AS priority
          FROM hr.employee_master e
         WHERE e.company_id = $1 AND e.branch_id = $2
           AND e.is_deleted = FALSE
           AND e.employee_code = ANY($3::text[])
     ) t
     ORDER BY pin, priority`,
    [companyId, branchId, pins],
  );
  // ORDER BY priority means an explicit map entry is seen before the
  // employee_code fallback; first write wins.
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.pin)) out.set(r.pin, Number(r.employee_id));
  }
  return out;
}

// ── Staging ───────────────────────────────────────────
export async function upsertStagingRow(client, d) {
  const { rows } = await client.query(
    `INSERT INTO hr.attendance_biometric_staging
       (company_id, branch_id, staging_id, device_pin, device_name, device_sn,
        work_date, first_in, last_out, hours, punches, status, employee_id, applied_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (company_id, branch_id, device_pin, work_date) DO UPDATE SET
       device_name = COALESCE(EXCLUDED.device_name, hr.attendance_biometric_staging.device_name),
       device_sn   = COALESCE(EXCLUDED.device_sn,   hr.attendance_biometric_staging.device_sn),
       first_in    = EXCLUDED.first_in,
       last_out    = EXCLUDED.last_out,
       hours       = EXCLUDED.hours,
       punches     = EXCLUDED.punches,
       -- A row an HR user explicitly dismissed stays dismissed even if the
       -- device re-sends it on the next rolling-window push.
       status      = CASE WHEN hr.attendance_biometric_staging.status = 'ignored'
                          THEN 'ignored' ELSE EXCLUDED.status END,
       employee_id = COALESCE(EXCLUDED.employee_id, hr.attendance_biometric_staging.employee_id),
       received_at = now(),
       applied_at  = COALESCE(EXCLUDED.applied_at, hr.attendance_biometric_staging.applied_at)
     RETURNING staging_id, status`,
    [
      d.companyId, d.branchId, d.stagingId, d.devicePin, d.deviceName ?? null, d.deviceSn ?? null,
      d.workDate, d.firstIn ?? null, d.lastOut ?? null, d.hours ?? null, d.punches ?? 0,
      d.status, d.employeeId ?? null, d.appliedAt ?? null,
    ],
  );
  return { stagingId: Number(rows[0].staging_id), status: rows[0].status };
}

// Grouped by PIN — the mapping screen asks "which unknown people are there",
// not "which unknown rows".
export async function listUnmatchedPins(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT device_pin, MAX(device_name) AS device_name, MAX(device_sn) AS device_sn,
            COUNT(*)::int AS day_count, MIN(work_date) AS first_date, MAX(work_date) AS last_date,
            SUM(punches)::int AS punch_count
       FROM hr.attendance_biometric_staging
      WHERE company_id = $1 AND branch_id = $2 AND status = 'unmatched'
      GROUP BY device_pin
      ORDER BY MAX(work_date) DESC, device_pin`,
    [companyId, branchId],
  );
  return rows.map((r) => ({
    devicePin: r.device_pin,
    deviceName: r.device_name,
    deviceSn: r.device_sn,
    dayCount: r.day_count,
    firstDate: r.first_date,
    lastDate: r.last_date,
    punchCount: r.punch_count,
  }));
}

export async function listStagingRows(pool, companyId, branchId, filters) {
  const params = [companyId, branchId];
  let where = '';
  if (filters?.devicePin) { params.push(filters.devicePin); where += ` AND s.device_pin = $${params.length}`; }
  if (filters?.status) { params.push(filters.status); where += ` AND s.status = $${params.length}`; }
  if (filters?.from) { params.push(filters.from); where += ` AND s.work_date >= $${params.length}`; }
  if (filters?.to) { params.push(filters.to); where += ` AND s.work_date <= $${params.length}`; }
  params.push(Math.min(Number(filters?.limit) || 500, 2000));
  const { rows } = await pool.query(
    `SELECT s.staging_id, s.device_pin, s.device_name, s.device_sn, s.work_date,
            s.first_in, s.last_out, s.hours, s.punches, s.status, s.employee_id,
            e.employee_name, s.received_at, s.applied_at
       FROM hr.attendance_biometric_staging s
       LEFT JOIN hr.employee_master e
         ON e.company_id = s.company_id AND e.branch_id = s.branch_id AND e.employee_id = s.employee_id
      WHERE s.company_id = $1 AND s.branch_id = $2${where}
      ORDER BY s.work_date DESC, s.device_pin
      LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    stagingId: Number(r.staging_id),
    devicePin: r.device_pin,
    deviceName: r.device_name,
    deviceSn: r.device_sn,
    workDate: r.work_date,
    firstIn: r.first_in,
    lastOut: r.last_out,
    hours: asNumber(r.hours),
    punches: Number(r.punches),
    status: r.status,
    employeeId: asNumber(r.employee_id),
    employeeName: r.employee_name ?? null,
    receivedAt: r.received_at,
    appliedAt: r.applied_at,
  }));
}

// Rows waiting on a PIN that has just been mapped, so they can be replayed.
export async function listUnmatchedRowsForPin(client, companyId, branchId, devicePin) {
  const { rows } = await client.query(
    `SELECT staging_id, device_pin, device_name, work_date, first_in, last_out, hours, punches
       FROM hr.attendance_biometric_staging
      WHERE company_id = $1 AND branch_id = $2 AND device_pin = $3 AND status = 'unmatched'
      ORDER BY work_date`,
    [companyId, branchId, devicePin],
  );
  return rows.map((r) => ({
    stagingId: Number(r.staging_id),
    devicePin: r.device_pin,
    deviceName: r.device_name,
    workDate: r.work_date,
    firstIn: r.first_in,
    lastOut: r.last_out,
    hours: asNumber(r.hours),
    punches: Number(r.punches),
  }));
}

export async function markStagingApplied(client, companyId, branchId, stagingIds, employeeId) {
  if (!stagingIds.length) return 0;
  const { rowCount } = await client.query(
    `UPDATE hr.attendance_biometric_staging
        SET status = 'applied', employee_id = $4, applied_at = now()
      WHERE company_id = $1 AND branch_id = $2 AND staging_id = ANY($3::int[])`,
    [companyId, branchId, stagingIds, employeeId],
  );
  return rowCount;
}

export async function setStagingStatus(client, companyId, branchId, stagingIds, status) {
  if (!stagingIds.length) return 0;
  const { rowCount } = await client.query(
    `UPDATE hr.attendance_biometric_staging
        SET status = $4
      WHERE company_id = $1 AND branch_id = $2 AND staging_id = ANY($3::int[])`,
    [companyId, branchId, stagingIds, status],
  );
  return rowCount;
}

// ── PIN map ───────────────────────────────────────────
export async function upsertPinMap(client, d) {
  await client.query(
    `INSERT INTO hr.biometric_pin_map (company_id, branch_id, device_pin, employee_id, device_name, mapped_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (company_id, branch_id, device_pin) DO UPDATE SET
       employee_id = EXCLUDED.employee_id,
       device_name = COALESCE(EXCLUDED.device_name, hr.biometric_pin_map.device_name),
       mapped_by   = EXCLUDED.mapped_by,
       mapped_at   = now()`,
    [d.companyId, d.branchId, d.devicePin, d.employeeId, d.deviceName ?? null, d.mappedBy ?? null],
  );
}

export async function deletePinMap(client, companyId, branchId, devicePin) {
  const { rowCount } = await client.query(
    `DELETE FROM hr.biometric_pin_map WHERE company_id=$1 AND branch_id=$2 AND device_pin=$3`,
    [companyId, branchId, devicePin],
  );
  return rowCount;
}

export async function listPinMap(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT m.device_pin, m.employee_id, m.device_name, m.mapped_at,
            e.employee_name, e.employee_code
       FROM hr.biometric_pin_map m
       LEFT JOIN hr.employee_master e
         ON e.company_id = m.company_id AND e.branch_id = m.branch_id AND e.employee_id = m.employee_id
      WHERE m.company_id = $1 AND m.branch_id = $2
      ORDER BY m.device_pin`,
    [companyId, branchId],
  );
  return rows.map((r) => ({
    devicePin: r.device_pin,
    employeeId: Number(r.employee_id),
    employeeCode: r.employee_code ?? null,
    employeeName: r.employee_name ?? null,
    deviceName: r.device_name,
    mappedAt: r.mapped_at,
  }));
}

// ── attendance_daily upsert ───────────────────────────
// first_in / last_out on this table are TIMESTAMPs, not TIMEs — the manual
// Punch In/Out buttons in the ERP store a full `new Date()`. The device only
// reports a clock time, so the work_date is added back on ($5::date + $6::time)
// to produce a value of the same shape. A NULL time yields a NULL timestamp,
// which is what a day with a single punch should have.
//
// LEAST/GREATEST ignore NULLs in PostgreSQL, so a day that already has only a
// first_in keeps it and simply gains a last_out.
//
// attendance_status is only advanced to 'Present' from a state that means "we
// had no evidence" (Absent / Missing). A status an HR user set deliberately —
// Leave, Holiday, Half Day — survives the sync: the person really did badge in
// on their half day, and overwriting that would erase a payroll decision.
//
// is_deleted is likewise never touched. If an HR user removed a day, a later
// re-push updates the row's times but leaves it deleted rather than silently
// resurrecting it.
export async function upsertAttendanceFromDevice(client, d) {
  const { rows } = await client.query(
    `INSERT INTO hr.attendance_daily
       (company_id, branch_id, daily_id, employee_id, work_date,
        first_in, last_out, ot_hours, attendance_status, source, device_pin, synced_at)
     VALUES ($1,$2,$3,$4,$5::date,
             ($5::date + $6::time), ($5::date + $7::time),
             0,'Present','biometric',$8, now())
     ON CONFLICT (company_id, branch_id, employee_id, work_date) DO UPDATE SET
       first_in   = LEAST(hr.attendance_daily.first_in, EXCLUDED.first_in),
       last_out   = GREATEST(hr.attendance_daily.last_out, EXCLUDED.last_out),
       attendance_status = CASE
         WHEN hr.attendance_daily.attendance_status IN ('Absent', 'Missing')
           THEN 'Present'
         ELSE hr.attendance_daily.attendance_status
       END,
       source     = 'biometric',
       device_pin = EXCLUDED.device_pin,
       synced_at  = now()
     RETURNING daily_id, (xmax = 0) AS inserted`,
    [d.companyId, d.branchId, d.dailyId, d.employeeId, d.workDate, d.firstIn ?? null, d.lastOut ?? null, d.devicePin ?? null],
  );
  return { dailyId: Number(rows[0].daily_id), inserted: rows[0].inserted === true };
}

// ── Sync jobs ─────────────────────────────────────────
export async function insertSyncJob(client, d) {
  const { rows } = await client.query(
    `INSERT INTO hr.attendance_sync_job
       (company_id, branch_id, job_id, from_date, to_date, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING job_id, from_date, to_date, status, requested_at`,
    [d.companyId, d.branchId, d.jobId, d.fromDate, d.toDate, d.requestedBy ?? null],
  );
  const r = rows[0];
  return {
    jobId: Number(r.job_id), fromDate: r.from_date, toDate: r.to_date,
    status: r.status, requestedAt: r.requested_at,
  };
}

// Claim-on-read. The agent is a single process, but it can be restarted
// mid-poll, and FOR UPDATE SKIP LOCKED keeps a second instance from handing the
// same range to two pushes.
export async function claimPendingJobs(client, companyId, branchId, limit) {
  const { rows } = await client.query(
    `WITH picked AS (
        SELECT job_id FROM hr.attendance_sync_job
         WHERE company_id = $1 AND branch_id = $2 AND status = 'pending'
         ORDER BY requested_at
         LIMIT $3
         FOR UPDATE SKIP LOCKED
     )
     UPDATE hr.attendance_sync_job j
        SET status = 'claimed', claimed_at = now()
       FROM picked p
      WHERE j.company_id = $1 AND j.branch_id = $2 AND j.job_id = p.job_id
      RETURNING j.job_id, j.from_date, j.to_date`,
    [companyId, branchId, limit],
  );
  return rows.map((r) => ({
    jobId: Number(r.job_id),
    fromDate: typeof r.from_date === 'string' ? r.from_date : r.from_date.toISOString().slice(0, 10),
    toDate: typeof r.to_date === 'string' ? r.to_date : r.to_date.toISOString().slice(0, 10),
  }));
}

export async function completeSyncJob(client, d) {
  const { rowCount } = await client.query(
    `UPDATE hr.attendance_sync_job
        SET status = $4, completed_at = now(),
            rows_received = $5, rows_matched = $6, rows_staged = $7,
            error_message = $8
      WHERE company_id = $1 AND branch_id = $2 AND job_id = $3`,
    [d.companyId, d.branchId, d.jobId, d.status, d.rowsReceived ?? 0, d.rowsMatched ?? 0, d.rowsStaged ?? 0, d.errorMessage ?? null],
  );
  return rowCount > 0;
}

// A job the agent claimed but never completed is stuck — the office PC died
// between claim and push. Releasing it lets the next poll retry.
export async function releaseStaleJobs(client, companyId, branchId, staleMinutes) {
  const { rowCount } = await client.query(
    `UPDATE hr.attendance_sync_job
        SET status = 'pending', claimed_at = NULL
      WHERE company_id = $1 AND branch_id = $2
        AND status = 'claimed'
        AND claimed_at < now() - ($3 || ' minutes')::interval`,
    [companyId, branchId, String(staleMinutes)],
  );
  return rowCount;
}

export async function listSyncJobs(pool, companyId, branchId, limit) {
  const { rows } = await pool.query(
    `SELECT job_id, from_date, to_date, status, requested_at, claimed_at, completed_at,
            rows_received, rows_matched, rows_staged, error_message
       FROM hr.attendance_sync_job
      WHERE company_id = $1 AND branch_id = $2
      ORDER BY requested_at DESC
      LIMIT $3`,
    [companyId, branchId, Math.min(Number(limit) || 20, 200)],
  );
  return rows.map((r) => ({
    jobId: Number(r.job_id),
    fromDate: r.from_date,
    toDate: r.to_date,
    status: r.status,
    requestedAt: r.requested_at,
    claimedAt: r.claimed_at,
    completedAt: r.completed_at,
    rowsReceived: Number(r.rows_received),
    rowsMatched: Number(r.rows_matched),
    rowsStaged: Number(r.rows_staged),
    errorMessage: r.error_message,
  }));
}

// ── Status summary ────────────────────────────────────
export async function getSyncSummary(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT MAX(last_seen_at) FROM hr.biometric_device_token
         WHERE company_id = $1 AND branch_id = $2)                              AS last_seen_at,
       (SELECT MAX(last_sync_at) FROM hr.biometric_device_token
         WHERE company_id = $1 AND branch_id = $2)                              AS last_sync_at,
       (SELECT COUNT(*)::int FROM hr.biometric_device_token
         WHERE company_id = $1 AND branch_id = $2 AND is_active)                AS active_tokens,
       (SELECT COUNT(DISTINCT device_pin)::int FROM hr.attendance_biometric_staging
         WHERE company_id = $1 AND branch_id = $2 AND status = 'unmatched')     AS unmatched_pins,
       (SELECT COUNT(*)::int FROM hr.attendance_biometric_staging
         WHERE company_id = $1 AND branch_id = $2 AND status = 'unmatched')     AS unmatched_rows,
       (SELECT COUNT(*)::int FROM hr.attendance_daily
         WHERE company_id = $1 AND branch_id = $2 AND source = 'biometric')     AS biometric_days,
       (SELECT COUNT(*)::int FROM hr.attendance_sync_job
         WHERE company_id = $1 AND branch_id = $2 AND status IN ('pending','claimed')) AS open_jobs`,
    [companyId, branchId],
  );
  const r = rows[0];
  return {
    lastSeenAt: r.last_seen_at,
    lastSyncAt: r.last_sync_at,
    activeTokens: r.active_tokens,
    unmatchedPins: r.unmatched_pins,
    unmatchedRows: r.unmatched_rows,
    biometricDays: r.biometric_days,
    openJobs: r.open_jobs,
  };
}
