import { pool } from '../../config/db.js';

export async function listSystemLogs({
  companyId = null,
  level = '',
  source = '',
  action = '',
  search = '',
  limit = 500,
  offset = 0,
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const { rows } = await pool.query(
    `SELECT 'TENANT'::text AS scope, tsl.log_id, tsl.company_id, cm.company_name,
            tsl.actor, tsl.level, tsl.source, tsl.action, tsl.entity_type,
            tsl.entity_id, tsl.message, tsl.details, tsl.http_method,
            tsl.request_path, tsl.status_code, tsl.duration_ms, tsl.ip_address,
            tsl.user_agent, tsl.created_at
       FROM core.tool_system_log tsl
       LEFT JOIN core.company_master cm ON cm.company_id = tsl.company_id
      WHERE ($1::bigint IS NULL OR tsl.company_id = $1)
        AND ($2 = '' OR tsl.level = $2)
        AND ($3 = '' OR tsl.source = $3)
        AND ($4 = '' OR tsl.action = $4)
        AND ($5 = '' OR tsl.actor ILIKE '%' || $5 || '%' OR tsl.message ILIKE '%' || $5 || '%'
             OR cm.company_name ILIKE '%' || $5 || '%' OR tsl.entity_type ILIKE '%' || $5 || '%'
             OR tsl.entity_id ILIKE '%' || $5 || '%' OR tsl.request_path ILIKE '%' || $5 || '%')
      ORDER BY tsl.created_at DESC
      LIMIT $6 OFFSET $7`,
    [companyId, level, source, action, search, safeLimit, safeOffset],
  );
  return rows;
}

export async function getSystemLogSummary() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM core.tool_system_log WHERE created_at >= NOW() - INTERVAL '24 hours') AS tenant_events_24h,
       (SELECT COUNT(*)::int FROM core.tool_system_log WHERE level = 'ERROR' AND created_at >= NOW() - INTERVAL '24 hours') AS errors_24h,
       (SELECT COUNT(DISTINCT company_id)::int FROM core.tool_system_log WHERE created_at >= NOW() - INTERVAL '24 hours') AS active_tenants_24h,
       (SELECT COUNT(*)::int FROM core.tool_system_log WHERE action = 'LOGIN' AND created_at >= NOW() - INTERVAL '24 hours') AS logins_24h,
       NOW() AS checked_at`,
  );
  return rows[0];
}
