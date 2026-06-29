import { pool } from '../../config/db.js';

/**
 * Get max_erp_sessions and max_pos_sessions for a company.
 * Checks tenant override first, then plan limit, then falls back to conservative defaults.
 */
export async function getSessionLimits(db, companyId) {
  const companyRes = await db.query(
    `SELECT COALESCE(ts.plan_code, ob.plan_code) AS plan_code
     FROM core.company_master c
     LEFT JOIN core.tenant_subscription ts ON ts.company_id = c.company_id
     LEFT JOIN core.company_onboarding ob ON ob.company_id = c.company_id
     WHERE c.company_id = $1
     LIMIT 1`,
    [companyId]
  );
  const planCode = companyRes.rows[0]?.plan_code ?? 'basic';

  const { rows } = await db.query(
    `SELECT
       COALESCE(
         (SELECT lo.limit_value FROM core.tenant_limit_override lo
          WHERE lo.company_id = $1 AND lo.limit_code = 'max_erp_sessions'),
         (SELECT pl.limit_value FROM core.plan_limit pl
          WHERE pl.plan_code = $2 AND pl.limit_code = 'max_erp_sessions'),
         3
       ) AS max_erp_sessions,
       COALESCE(
         (SELECT lo.limit_value FROM core.tenant_limit_override lo
          WHERE lo.company_id = $1 AND lo.limit_code = 'max_pos_sessions'),
         (SELECT pl.limit_value FROM core.plan_limit pl
          WHERE pl.plan_code = $2 AND pl.limit_code = 'max_pos_sessions'),
         1
       ) AS max_pos_sessions`,
    [companyId, planCode]
  );
  return rows[0];
}

export async function countActiveSessions(db, companyId, sessionType) {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS cnt FROM core.active_session
     WHERE company_id = $1 AND session_type = $2 AND expires_at > NOW()`,
    [companyId, sessionType]
  );
  return Number(rows[0]?.cnt ?? 0);
}

export async function registerSession(db, staffPk, companyId, sessionType, expiresAt) {
  await db.query(
    `INSERT INTO core.active_session (staff_pk, company_id, session_type, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (staff_pk, session_type) DO UPDATE SET
       expires_at = EXCLUDED.expires_at,
       created_at = NOW()`,
    [staffPk, companyId, sessionType, expiresAt]
  );
}

export async function unregisterSession(db, staffPk, sessionType) {
  if (staffPk == null) return;
  await db.query(
    'DELETE FROM core.active_session WHERE staff_pk = $1 AND session_type = $2',
    [staffPk, sessionType]
  );
}

export async function logAuthEvent(db, { companyId, staffPk, eventType, ipAddress, metadata }) {
  try {
    await db.query(
      `INSERT INTO core.auth_event_log (company_id, staff_pk, event_type, ip_address, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        companyId ?? null,
        staffPk ?? null,
        eventType,
        ipAddress ?? null,
        metadata != null ? JSON.stringify(metadata) : null,
      ]
    );
  } catch {
    // Auth log is non-critical — never block the main flow.
  }
}
