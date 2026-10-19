/**
 * Data access for ops.pos_printer + ops.print_job.
 * Every query is scoped by company_id + station_id.
 */

export async function listPrinters(executor, companyId, stationId) {
  const { rows } = await executor.query(
    `SELECT printer_id, counter_no, kitchen_loc, printer_name, transport, address,
            paper_mm, is_fallback, is_default, is_active
       FROM ops.pos_printer
      WHERE company_id = $1 AND station_id = $2
      ORDER BY counter_no ASC, printer_id ASC`,
    [companyId, stationId],
  );
  return rows;
}

/** Upsert keyed by (company, station, counter_no) — one printer per counter. */
export async function upsertPrinter(client, p) {
  const { rows } = await client.query(
    `INSERT INTO ops.pos_printer (
        company_id, station_id, counter_no, kitchen_loc, printer_name,
        transport, address, paper_mm, is_fallback, is_active,
        created_by, modified_by, is_default
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12)
      ON CONFLICT (company_id, station_id, counter_no) DO UPDATE SET
        kitchen_loc = EXCLUDED.kitchen_loc,
        printer_name = EXCLUDED.printer_name,
        transport = EXCLUDED.transport,
        address = EXCLUDED.address,
        paper_mm = EXCLUDED.paper_mm,
        is_fallback = EXCLUDED.is_fallback,
        is_default = EXCLUDED.is_default,
        is_active = EXCLUDED.is_active,
        modified_by = EXCLUDED.modified_by,
        modified_on = NOW()
      RETURNING printer_id, counter_no, kitchen_loc, printer_name, transport, address,
                paper_mm, is_fallback, is_default, is_active`,
    [
      p.companyId, p.stationId, p.counterNo, p.kitchenLoc, p.printerName,
      p.transport, p.address, p.paperMm, p.isFallback, p.isActive, p.auditBy,
      p.isDefault === true,
    ],
  );
  return rows[0];
}

/** Drop the fallback flag off any other printer at this station. */
export async function clearFallback(client, companyId, stationId, keepCounterPrinterId) {
  await client.query(
    `UPDATE ops.pos_printer SET is_fallback = FALSE, modified_on = NOW()
      WHERE company_id = $1 AND station_id = $2 AND is_fallback = TRUE
        AND printer_id <> $3`,
    [companyId, stationId, Number(keepCounterPrinterId) || 0],
  );
}

/** One default printer per station: clear the others before saving a new default. */
export async function clearDefault(client, companyId, stationId, counterNo) {
  await client.query(
    `UPDATE ops.pos_printer SET is_default = FALSE, modified_on = NOW()
      WHERE company_id = $1 AND station_id = $2 AND is_default = TRUE
        AND counter_no <> $3`,
    [companyId, stationId, counterNo],
  );
}

export async function deletePrinter(executor, companyId, stationId, printerId) {
  const { rowCount } = await executor.query(
    `DELETE FROM ops.pos_printer
      WHERE company_id = $1 AND station_id = $2 AND printer_id = $3`,
    [companyId, stationId, printerId],
  );
  return rowCount;
}

export async function getKotHeader(executor, companyId, stationId, kotMasterId) {
  const { rows } = await executor.query(
    `SELECT km.kot_master_id, km.kot_prefix, km.kot_number, km.kot_status,
            km.nof_customer, km.remarks, km.kot_time,
            COALESCE(am.area_name, '') AS area_name,
            COALESCE(am.supply_type, '') AS supply_type,
            COALESCE(tm.table_name, '') AS table_name,
            COALESCE(st.staff_name, '') AS waiter_name
       FROM ops.kot_master km
       LEFT JOIN LATERAL (
          SELECT a.area_name, a.supply_type FROM core.area_master a
           WHERE a.company_id = km.company_id AND a.area_id = km.area_id
             AND a.branch_id IN (km.station_id, km.branch_id)
           ORDER BY CASE WHEN a.branch_id = km.station_id THEN 0 ELSE 1 END LIMIT 1
        ) am ON TRUE
       LEFT JOIN LATERAL (
          SELECT t.table_name FROM core.table_master t
           WHERE t.company_id = km.company_id AND t.table_id = km.table_id
             AND COALESCE(t.is_deleted, FALSE) = FALSE
             AND t.branch_id IN (km.station_id, km.branch_id)
           ORDER BY CASE WHEN t.branch_id = km.station_id THEN 0 ELSE 1 END LIMIT 1
        ) tm ON TRUE
       LEFT JOIN LATERAL (
          SELECT s.staff_name FROM core.staff_master s
           WHERE s.company_id = km.company_id
             AND (s.id = km.waiter_id OR s.staff_id = km.waiter_id)
           ORDER BY CASE WHEN s.staff_id = km.waiter_id THEN 0 ELSE 1 END LIMIT 1
        ) st ON TRUE
      WHERE km.company_id = $1 AND km.station_id = $2 AND km.kot_master_id = $3`,
    [companyId, stationId, kotMasterId],
  );
  return rows[0] ?? null;
}

/**
 * KOT lines plus each product's kitchen location_code. location_code lives on
 * core.product_inventory (per branch); pick the row for this KOT's branch/station,
 * falling back to any branch for the product. Defensive if the column/table is
 * absent on an older schema.
 */
export async function getKotItemLocations(executor, companyId, stationId, kotMasterId) {
  try {
    const { rows } = await executor.query(
      `SELECT kc.kot_child_id, kc.product_id, kc.short_description, kc.qty, kc.modifier,
              kc.print_count,
              COALESCE(pi.location_code, '') AS location_code
         FROM ops.kot_child kc
         LEFT JOIN LATERAL (
            SELECT i.location_code FROM core.product_inventory i
             WHERE i.company_id = kc.company_id AND i.product_id = kc.product_id
             ORDER BY CASE WHEN i.branch_id IN (kc.station_id, kc.branch_id) THEN 0 ELSE 1 END,
                      i.branch_id
             LIMIT 1
          ) pi ON TRUE
        WHERE kc.company_id = $1 AND kc.kot_master_id = $2
        ORDER BY kc.kot_child_id ASC`,
      [companyId, kotMasterId],
    );
    return rows;
  } catch (e) {
    if (e.code === '42703' || e.code === '42P01') {
      const { rows } = await executor.query(
        `SELECT kot_child_id, product_id, short_description, qty, modifier,
                print_count, '' AS location_code
           FROM ops.kot_child
          WHERE company_id = $1 AND kot_master_id = $2
          ORDER BY kot_child_id ASC`,
        [companyId, kotMasterId],
      );
      return rows;
    }
    throw e;
  }
}

/**
 * Insert a job. Returns the row, or null when the dedupe key already exists
 * (another dispatch of the same batch to the same printer already claimed it).
 */
export async function insertJob(client, j) {
  const { rows } = await client.query(
    `INSERT INTO ops.print_job (
        company_id, station_id, job_type, kot_master_id, printer_id,
        dedupe_key, is_reprint, payload, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
      ON CONFLICT (company_id, dedupe_key) DO NOTHING
      RETURNING print_job_id, job_type, kot_master_id, printer_id, status,
                is_reprint, last_error, payload`,
    [
      j.companyId, j.stationId, j.jobType, j.kotMasterId, j.printerId,
      j.dedupeKey, j.isReprint, JSON.stringify(j.payload ?? {}), j.auditBy,
    ],
  );
  return rows[0] ?? null;
}

/** Atomic claim: only a PENDING job flips to CLAIMED, exactly once. */
export async function claimJob(executor, companyId, stationId, jobId, claimedBy) {
  const { rows } = await executor.query(
    `UPDATE ops.print_job
        SET status = 'CLAIMED', claimed_by = $4, claimed_at = NOW(),
            attempts = attempts + 1, modified_on = NOW()
      WHERE company_id = $1 AND station_id = $2 AND print_job_id = $3
        AND status = 'PENDING'
      RETURNING print_job_id`,
    [companyId, stationId, jobId, claimedBy],
  );
  return rows[0] ?? null;
}

export async function getJobForUpdate(client, companyId, stationId, jobId) {
  const { rows } = await client.query(
    `SELECT print_job_id, status, kot_master_id, payload
       FROM ops.print_job
      WHERE company_id = $1 AND station_id = $2 AND print_job_id = $3
      FOR UPDATE`,
    [companyId, stationId, jobId],
  );
  return rows[0] ?? null;
}

export async function setJobStatus(client, { companyId, stationId, jobId, status, error }) {
  const { rows } = await client.query(
    `UPDATE ops.print_job
        SET status = $4, last_error = $5, modified_on = NOW()
      WHERE company_id = $1 AND station_id = $2 AND print_job_id = $3
      RETURNING print_job_id, job_type, kot_master_id, printer_id, status,
                is_reprint, last_error, payload`,
    [companyId, stationId, jobId, status, error ?? ''],
  );
  return rows[0];
}

/** Count a dispatch on each line (print_count > 0 = printed) so it is never auto-resent. */
export async function markChildrenPrinted(client, companyId, kotMasterId, childIds) {
  const ids = (childIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return 0;
  try {
    const { rowCount } = await client.query(
      `UPDATE ops.kot_child
          SET print_count = COALESCE(print_count, 0) + 1, modified_at = NOW()
        WHERE company_id = $1 AND kot_master_id = $2 AND kot_child_id = ANY($3::bigint[])`,
      [companyId, kotMasterId, ids],
    );
    return rowCount;
  } catch (e) {
    if (e.code === '42703') return 0;
    throw e;
  }
}

export async function listJobsForKot(executor, companyId, stationId, kotMasterId) {
  const { rows } = await executor.query(
    `SELECT j.print_job_id, j.job_type, j.kot_master_id, j.printer_id, j.status,
            j.is_reprint, j.last_error, j.payload,
            p.printer_name, p.transport, p.address, p.paper_mm
       FROM ops.print_job j
       LEFT JOIN ops.pos_printer p ON p.printer_id = j.printer_id
      WHERE j.company_id = $1 AND j.station_id = $2 AND j.kot_master_id = $3
      ORDER BY j.print_job_id DESC`,
    [companyId, stationId, kotMasterId],
  );
  return rows;
}
