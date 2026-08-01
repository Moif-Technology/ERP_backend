/**
 * Data access for salon stylists.
 *
 * A stylist is a core.staff_master row. There is no separate stylist table —
 * the garage module models technicians separately, but salon staff already
 * exist as POS staff (they log in and take payments), so a parallel table would
 * duplicate identity for no gain.
 *
 * All ids here are the BUSINESS staff id (staff_master.staff_id), matching what
 * ops.job_child.stylist_id stores and what the POS client sends.
 */

/** Active staff for the company, shaped as a stylist roster. */
export async function listStylists(executor, companyId, { branchId = null } = {}) {
  const params = [companyId];
  let extra = '';
  if (branchId != null) {
    params.push(branchId);
    extra = ` AND s.branch_id = $${params.length}`;
  }

  const { rows } = await executor.query(
    `SELECT s.staff_id, s.staff_code, s.staff_name, s.designation, s.branch_id
       FROM core.staff_master s
      WHERE s.company_id = $1
        AND s.record_status = 'ACTIVE'
        ${extra}
      ORDER BY s.staff_name ASC NULLS LAST`,
    params
  );
  return rows;
}

/**
 * Current load per stylist: open service lines and whether any is running.
 * Drives the roster's Free / Busy state without a second round-trip per stylist.
 */
export async function stylistLoad(executor, companyId, { stylistId = null } = {}) {
  const params = [companyId];
  let extra = '';
  if (stylistId != null) {
    params.push(stylistId);
    extra = ` AND c.stylist_id = $${params.length}`;
  }

  const { rows } = await executor.query(
    `SELECT c.stylist_id,
            COUNT(*) FILTER (WHERE c.service_status <> 'DONE')            AS open_services,
            COUNT(*) FILTER (WHERE c.service_status = 'IN_PROGRESS')      AS running_services,
            MIN(m.start_time) FILTER (WHERE c.service_status = 'IN_PROGRESS') AS started_at,
            SUM(c.duration_minutes) FILTER (WHERE c.service_status <> 'DONE') AS pending_minutes
       FROM ops.job_child c
       JOIN ops.job_master m
         ON m.company_id = c.company_id AND m.job_id = c.job_id
      WHERE c.company_id  = $1
        AND c.line_type   = 'SERVICE'
        AND c.is_deleted  = FALSE
        AND m.job_status IN ('OPEN','HELD')
        AND m.is_deleted  = FALSE
        ${extra}
      GROUP BY c.stylist_id`,
    params
  );
  return rows;
}
