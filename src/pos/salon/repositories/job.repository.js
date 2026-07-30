/**
 * Data access for ops.salon_job_master + ops.salon_job_child.
 * Raw SQL only — no business logic (see api/CLAUDE.md conventions).
 *
 * Every id lookup and every FK is scoped by company_id. The restaurant KOT
 * tables are keyed on kot_master_id alone while allocating ids per-company,
 * which collides the moment a second tenant exists; the salon tables carry
 * composite (company_id, job_id) uniqueness so that cannot happen here.
 *
 * stylist_id holds the BUSINESS staff id (core.staff_master.staff_id), not the
 * internal surrogate PK (core.staff_master.id). That matches what the POS client
 * sends and what ops.kot_master.waiter_id stores. Joins must use staff_id.
 */

export async function nextJobId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(job_id), 0) + 1 AS n
       FROM ops.salon_job_master
      WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function nextLineId(client, companyId, jobId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(line_id), 0) + 1 AS n
       FROM ops.salon_job_child
      WHERE company_id = $1 AND job_id = $2`,
    [companyId, jobId]
  );
  return Number(rows[0].n);
}

/** Open/held job occupying a chair, if any. Enforced by a partial unique index too. */
export async function findOpenJobByChair(client, companyId, chairId) {
  const { rows } = await client.query(
    `SELECT job_id, job_no, job_status, primary_stylist_id
       FROM ops.salon_job_master
      WHERE company_id = $1
        AND chair_id   = $2
        AND job_status IN ('OPEN','HELD')
        AND is_deleted = FALSE
      LIMIT 1`,
    [companyId, chairId]
  );
  return rows[0] ?? null;
}

export async function findJobMaster(executor, companyId, jobId) {
  const { rows } = await executor.query(
    `SELECT job_id, job_no, job_status, station_id, branch_id,
            customer_id, chair_id, area_id, primary_stylist_id,
            start_time, end_time, appointment_id,
            sub_total, tax_1_amount, bill_discount, round_off_adj, amount,
            remarks
       FROM ops.salon_job_master
      WHERE company_id = $1 AND job_id = $2 AND is_deleted = FALSE`,
    [companyId, jobId]
  );
  return rows[0] ?? null;
}

export async function insertJobMaster(client, row) {
  const {
    companyId, branchId, stationId, jobId, jobNo, jobStatus,
    customerId, chairId, areaId, primaryStylistId,
    startTime, appointmentId,
    billDiscount, subTotal, tax1Amount, tax1Rate, roundOffAdj, amount,
    remarks, createdBy,
  } = row;

  await client.query(
    `INSERT INTO ops.salon_job_master (
        company_id, branch_id, station_id,
        job_id, job_no, job_status,
        customer_id, chair_id, area_id, primary_stylist_id,
        start_time, appointment_id,
        bill_discount, sub_total, tax_1_amount, tax_1_rate,
        round_off_adj, amount, remarks,
        created_by, modified_by
     ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20
     )`,
    [
      companyId, branchId, stationId,
      jobId, jobNo, jobStatus,
      customerId, chairId, areaId, primaryStylistId,
      startTime, appointmentId,
      billDiscount, subTotal, tax1Amount, tax1Rate,
      roundOffAdj, amount, remarks,
      createdBy,
    ]
  );
}

export async function insertJobChild(client, row) {
  const {
    companyId, branchId, stationId, jobId, lineId,
    lineType, stylistId, durationMinutes, serviceStatus,
    productId, barcode, shortDescription, groupId,
    qty, unitPrice, unitCost, amount, itemDiscount,
    subTotal, lineTotal, tax1Amount, tax1Rate,
    remarks, createdBy,
  } = row;

  await client.query(
    `INSERT INTO ops.salon_job_child (
        company_id, branch_id, station_id, job_id, line_id,
        line_type, stylist_id, duration_minutes, service_status,
        product_id, barcode, short_description, group_id,
        qty, unit_price, unit_cost, amount, item_discount,
        sub_total, line_total, tax_1_amount, tax_1_rate,
        remarks, created_by, modified_by
     ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
        $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24
     )`,
    [
      companyId, branchId, stationId, jobId, lineId,
      lineType, stylistId, durationMinutes, serviceStatus,
      productId, barcode, shortDescription, groupId,
      qty, unitPrice, unitCost, amount, itemDiscount,
      subTotal, lineTotal, tax1Amount, tax1Rate,
      remarks, createdBy,
    ]
  );
}

/** Recompute header totals from the lines. Single source of truth is the child rows. */
export async function refreshJobTotals(client, companyId, jobId, modifiedBy) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(sub_total), 0)    AS sub_total,
            COALESCE(SUM(tax_1_amount), 0) AS tax1,
            COALESCE(SUM(line_total), 0)   AS total
       FROM ops.salon_job_child
      WHERE company_id = $1 AND job_id = $2 AND is_deleted = FALSE`,
    [companyId, jobId]
  );
  const t = rows[0];

  await client.query(
    `UPDATE ops.salon_job_master
        SET sub_total    = $3,
            tax_1_amount = $4,
            amount       = $5,
            modified_by  = $6,
            updated_at   = NOW()
      WHERE company_id = $1 AND job_id = $2`,
    [companyId, jobId, t.sub_total, t.tax1, t.total, modifiedBy]
  );

  return { subTotal: Number(t.sub_total), tax1: Number(t.tax1), total: Number(t.total) };
}

export async function listJobLines(executor, companyId, jobId) {
  const { rows } = await executor.query(
    `SELECT c.job_id, c.line_id, c.line_type, c.stylist_id,
            c.duration_minutes, c.service_status,
            c.product_id, c.barcode, c.short_description, c.group_id,
            c.qty, c.unit_price, c.item_discount, c.sub_total,
            c.line_total, c.tax_1_amount, c.tax_1_rate, c.remarks,
            m.job_no, m.chair_id, m.area_id, m.primary_stylist_id,
            m.customer_id, m.job_status,
            s.staff_name AS stylist_name
       FROM ops.salon_job_child c
       JOIN ops.salon_job_master m
         ON m.company_id = c.company_id AND m.job_id = c.job_id
       LEFT JOIN core.staff_master s
         ON s.company_id = c.company_id AND s.staff_id = c.stylist_id
      WHERE c.company_id = $1 AND c.job_id = $2 AND c.is_deleted = FALSE
      ORDER BY c.line_id`,
    [companyId, jobId]
  );
  return rows;
}

/**
 * Open jobs for the job board. Scoped by station when one is supplied —
 * restaurant's getKot omits this scoping, which lets any staffer read any
 * ticket in the company by guessing an id. Not repeating that here.
 */
export async function listOpenJobs(executor, companyId, {
  stationId = null,
  stylistId = null,
  search = null,
} = {}) {
  const params = [companyId];
  let where = `m.company_id = $1 AND m.job_status <> 'SETTLED' AND m.is_deleted = FALSE`;

  if (stationId != null) {
    params.push(stationId);
    where += ` AND m.station_id = $${params.length}`;
  }
  if (stylistId != null) {
    params.push(stylistId);
    where += ` AND EXISTS (SELECT 1 FROM ops.salon_job_child c
                            WHERE c.company_id = m.company_id
                              AND c.job_id = m.job_id
                              AND c.stylist_id = $${params.length})`;
  }
  if (search != null && String(search).trim() !== '') {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    const p = `$${params.length}`;
    where += ` AND (
      LOWER(COALESCE(m.job_no, '')) LIKE ${p}
      OR LOWER(COALESCE(cu.customer_name, '')) LIKE ${p}
      OR LOWER(COALESCE(t.table_name, '')) LIKE ${p}
      OR LOWER(COALESCE(s.staff_name, '')) LIKE ${p}
      OR CAST(m.job_id AS TEXT) LIKE ${p}
    )`;
  }

  const { rows } = await executor.query(
    `SELECT m.job_id, m.job_no, m.job_status, m.chair_id, m.area_id,
            m.customer_id, m.primary_stylist_id, m.amount,
            m.start_time, m.job_date, m.job_time, m.station_id,
            t.table_name   AS chair_name,
            a.area_name,
            cu.customer_name,
            s.staff_name   AS primary_stylist_name,
            (SELECT COUNT(*) FROM ops.salon_job_child c
              WHERE c.company_id = m.company_id AND c.job_id = m.job_id
                AND c.line_type = 'SERVICE' AND c.is_deleted = FALSE) AS service_count,
            (SELECT COUNT(*) FROM ops.salon_job_child c
              WHERE c.company_id = m.company_id AND c.job_id = m.job_id
                AND c.line_type = 'SERVICE' AND c.service_status = 'DONE'
                AND c.is_deleted = FALSE) AS service_done_count
       FROM ops.salon_job_master m
       LEFT JOIN core.table_master t
         ON t.company_id = m.company_id AND t.table_id = m.chair_id
       LEFT JOIN core.area_master a
         ON a.company_id = m.company_id
        AND a.area_id = m.area_id
        AND a.branch_id = m.branch_id
       LEFT JOIN biz.customer_master cu
         ON cu.company_id = m.company_id AND cu.customer_id = m.customer_id
       LEFT JOIN core.staff_master s
         ON s.company_id = m.company_id AND s.staff_id = m.primary_stylist_id
      WHERE ${where}
      ORDER BY m.job_id DESC`,
    params
  );
  return rows;
}

export async function updateLineServiceStatus(client, companyId, jobId, lineId, status, modifiedBy) {
  const { rowCount } = await client.query(
    `UPDATE ops.salon_job_child
        SET service_status = $4, modified_by = $5, updated_at = NOW()
      WHERE company_id = $1 AND job_id = $2 AND line_id = $3
        AND line_type = 'SERVICE' AND is_deleted = FALSE`,
    [companyId, jobId, lineId, status, modifiedBy]
  );
  return rowCount > 0;
}

export async function updateLineStylist(client, companyId, jobId, lineId, stylistId, modifiedBy) {
  const { rowCount } = await client.query(
    `UPDATE ops.salon_job_child
        SET stylist_id = $4, modified_by = $5, updated_at = NOW()
      WHERE company_id = $1 AND job_id = $2 AND line_id = $3 AND is_deleted = FALSE`,
    [companyId, jobId, lineId, stylistId, modifiedBy]
  );
  return rowCount > 0;
}

/** Station must belong to the company and be a salon till. */
export async function assertSalonStation(executor, companyId, stationId) {
  const { rows } = await executor.query(
    `SELECT station_id, station_type, station_name, branch_id
       FROM core.station_master
      WHERE company_id = $1 AND station_id = $2 AND is_deleted = FALSE
      LIMIT 1`,
    [companyId, stationId]
  );
  return rows[0] ?? null;
}

/** First SALON_POS till for the company (used when the client still sends branch/BACKOFFICE id). */
export async function findFirstSalonStation(executor, companyId) {
  const { rows } = await executor.query(
    `SELECT station_id, station_type, station_name, branch_id
       FROM core.station_master
      WHERE company_id = $1
        AND station_type = 'SALON_POS'
        AND is_deleted = FALSE
      ORDER BY station_id
      LIMIT 1`,
    [companyId]
  );
  return rows[0] ?? null;
}
