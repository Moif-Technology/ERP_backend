function toNumber(v, fallback = 0) {
  return v != null ? Number(v) : fallback;
}

export async function getKpis(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE record_status <> 'DELETED')::bigint AS total_leads,
        COUNT(*) FILTER (
          WHERE record_status <> 'DELETED'
            AND converted_at IS NULL
            AND lost_at IS NULL
        )::bigint AS open_leads,
        COUNT(*) FILTER (WHERE record_status <> 'DELETED' AND converted_at IS NOT NULL)::bigint AS converted_leads
       FROM biz.lead_master
      WHERE company_id = $1`,
    [companyId]
  );

  const { rows: oppRows } = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE status <> 'CANCELLED')::bigint AS total_opportunities,
        COUNT(*) FILTER (WHERE status = 'WON')::bigint AS opportunities_won,
        COALESCE(SUM(estimated_value) FILTER (WHERE status = 'OPEN'), 0)::numeric AS revenue_pipeline
       FROM biz.opportunity_master
      WHERE company_id = $1`,
    [companyId]
  );

  return {
    totalLeads: toNumber(rows[0]?.total_leads),
    openLeads: toNumber(rows[0]?.open_leads),
    convertedLeads: toNumber(rows[0]?.converted_leads),
    totalOpportunities: toNumber(oppRows[0]?.total_opportunities),
    opportunitiesWon: toNumber(oppRows[0]?.opportunities_won),
    revenuePipeline: toNumber(oppRows[0]?.revenue_pipeline),
  };
}

export async function getRecentLeads(pool, companyId, limit = 7) {
  const { rows } = await pool.query(
    `SELECT l.id, l.lead_code, COALESCE(l.company_name, l.lead_name) AS lead_name,
            s.status_name, l.assigned_to_staff_id, st.staff_name, l.lead_date
       FROM biz.lead_master l
       LEFT JOIN biz.lead_status_master s
              ON s.company_id = l.company_id AND s.id = l.lead_status_id
       LEFT JOIN core.staff_master st
              ON st.company_id = l.company_id AND st.staff_id = l.assigned_to_staff_id
      WHERE l.company_id = $1
        AND l.record_status <> 'DELETED'
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $2`,
    [companyId, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    leadCode: r.lead_code,
    leadName: r.lead_name,
    status: r.status_name || null,
    assignedTo: r.staff_name || (r.assigned_to_staff_id != null ? String(r.assigned_to_staff_id) : null),
    leadDate: r.lead_date,
  }));
}

export async function getRecentOpportunities(pool, companyId, limit = 7) {
  const { rows } = await pool.query(
    `SELECT o.id, o.opportunity_code, o.opportunity_name, o.estimated_value, o.expected_close_date,
            c.customer_name, s.stage_name
       FROM biz.opportunity_master o
       LEFT JOIN biz.customer_master c
              ON c.company_id = o.company_id AND c.customer_id = o.customer_id
       LEFT JOIN biz.opportunity_stage_master s
              ON s.company_id = o.company_id AND s.id = o.opportunity_stage_id
      WHERE o.company_id = $1
        AND o.status <> 'CANCELLED'
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT $2`,
    [companyId, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    opportunityCode: r.opportunity_code,
    opportunityName: r.opportunity_name,
    customerName: r.customer_name || null,
    stageName: r.stage_name || null,
    estimatedValue: toNumber(r.estimated_value),
    expectedCloseDate: r.expected_close_date,
  }));
}

export async function getTodayFollowups(pool, companyId, limit = 5) {
  const { rows } = await pool.query(
    `SELECT f.id, f.subject, f.followup_type, f.priority_level, f.followup_date,
            COALESCE(c.customer_name, l.company_name, l.lead_name, o.opportunity_name) AS linked_name
       FROM biz.customer_followup f
       LEFT JOIN biz.customer_master c
              ON c.company_id = f.company_id AND c.customer_id = f.customer_id
       LEFT JOIN biz.lead_master l
              ON l.company_id = f.company_id AND l.lead_id = f.lead_id
       LEFT JOIN biz.opportunity_master o
              ON o.company_id = f.company_id AND o.opportunity_id = f.opportunity_id
      WHERE f.company_id = $1
        AND f.followup_date::date = CURRENT_DATE
        AND f.status <> 'CANCELLED'
      ORDER BY f.followup_date ASC, f.id ASC
      LIMIT $2`,
    [companyId, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    subject: r.subject,
    linkedTo: r.linked_name || null,
    type: r.followup_type,
    priority: r.priority_level,
    followupDate: r.followup_date,
  }));
}

export async function getUpcomingFollowups(pool, companyId, limit = 5) {
  const { rows } = await pool.query(
    `SELECT f.id, f.followup_date, f.subject, f.followup_type, f.priority_level, f.status, f.assigned_to_staff_id,
            st.staff_name,
            COALESCE(c.customer_name, l.company_name, l.lead_name, o.opportunity_name) AS linked_name
       FROM biz.customer_followup f
       LEFT JOIN core.staff_master st
              ON st.company_id = f.company_id AND st.staff_id = f.assigned_to_staff_id
       LEFT JOIN biz.customer_master c
              ON c.company_id = f.company_id AND c.customer_id = f.customer_id
       LEFT JOIN biz.lead_master l
              ON l.company_id = f.company_id AND l.lead_id = f.lead_id
       LEFT JOIN biz.opportunity_master o
              ON o.company_id = f.company_id AND o.opportunity_id = f.opportunity_id
      WHERE f.company_id = $1
        AND f.status <> 'CANCELLED'
        AND f.followup_date::date >= CURRENT_DATE
      ORDER BY f.followup_date ASC, f.id ASC
      LIMIT $2`,
    [companyId, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    dueDate: r.followup_date,
    subject: r.subject,
    linkedTo: r.linked_name || null,
    type: r.followup_type,
    priority: r.priority_level,
    assignedTo: r.staff_name || (r.assigned_to_staff_id != null ? String(r.assigned_to_staff_id) : null),
    status: r.status,
  }));
}

export async function getPipelineByStage(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT s.stage_name,
            COUNT(o.id)::bigint AS item_count,
            COALESCE(SUM(o.estimated_value), 0)::numeric AS total_value
       FROM biz.opportunity_stage_master s
       LEFT JOIN biz.opportunity_master o
              ON o.company_id = s.company_id
             AND o.opportunity_stage_id = s.id
             AND o.status <> 'CANCELLED'
      WHERE s.company_id = $1
      GROUP BY s.stage_name, s.display_order
      ORDER BY s.display_order ASC, s.stage_name ASC`,
    [companyId]
  );
  return rows.map((r) => ({
    stage: r.stage_name,
    count: toNumber(r.item_count),
    value: toNumber(r.total_value),
  }));
}

export async function getLeadSourceBreakdown(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT s.source_name,
            COUNT(l.id)::bigint AS lead_count,
            COUNT(*) FILTER (WHERE l.converted_at IS NOT NULL)::bigint AS converted_count
       FROM biz.lead_source_master s
       LEFT JOIN biz.lead_master l
              ON l.company_id = s.company_id
             AND l.lead_source_id = s.id
             AND l.record_status <> 'DELETED'
      WHERE s.company_id = $1
      GROUP BY s.source_name, s.display_order
      ORDER BY s.display_order ASC, s.source_name ASC`,
    [companyId]
  );
  return rows.map((r) => {
    const count = toNumber(r.lead_count);
    const converted = toNumber(r.converted_count);
    return {
      source: r.source_name,
      count,
      conversionPct: count > 0 ? Math.round((converted / count) * 100) : 0,
    };
  });
}
