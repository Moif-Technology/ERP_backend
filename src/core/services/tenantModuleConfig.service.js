// Tenant module configuration service
// Manages which modules are enabled/disabled per tenant (company)

function parseCompanyId(authStaff) {
  const companyId = Number(authStaff?.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid session company');
    err.status = 401;
    throw err;
  }
  return companyId;
}

/**
 * Get all module configurations for a company.
 * Returns: { module_code: is_enabled, ... }
 * Used to gate features at runtime.
 */
export async function getTenantModuleConfig(db, companyId) {
  try {
    const res = await db.query(
      `SELECT module_code, is_enabled
       FROM core.tenant_module_config
       WHERE company_id = $1
       ORDER BY module_code`,
      [companyId]
    );

    const config = {};
    for (const row of res.rows) {
      config[row.module_code] = row.is_enabled;
    }
    return config;
  } catch (err) {
    // Table doesn't exist (legacy install) — all modules enabled
    if (err.code === '42P01') return {};
    throw err;
  }
}

/**
 * Check if a specific module is enabled for a company.
 */
export async function isModuleEnabledForCompany(db, companyId, moduleCode) {
  try {
    const res = await db.query(
      `SELECT is_enabled FROM core.tenant_module_config
       WHERE company_id = $1 AND module_code = $2`,
      [companyId, moduleCode]
    );

    if (res.rows.length === 0) return true; // Default: enabled if not configured
    return res.rows[0].is_enabled === true;
  } catch (err) {
    if (err.code === '42P01') return true; // Legacy: all enabled
    throw err;
  }
}

/**
 * Get list of enabled modules for a company.
 * Returns: ['core', 'pos', 'backoffice', ...]
 */
export async function getEnabledModulesForCompany(db, companyId) {
  const config = await getTenantModuleConfig(db, companyId);
  return Object.keys(config).filter(mod => config[mod] === true);
}

/**
 * Update module enabled/disabled status for a company.
 * Called by Super Admin only.
 */
export async function updateTenantModuleConfig(db, authStaff, companyId, moduleCode, isEnabled) {
  // Only Super Admin (no company_id check needed — they manage all tenants)
  const adminCompanyId = Number(authStaff?.company_id);
  if (!Number.isFinite(adminCompanyId)) {
    const err = new Error('Only Super Admin can configure tenant modules');
    err.status = 403;
    throw err;
  }

  const enabled = isEnabled === true;
  const updatedBy = String(authStaff?.staff_name || authStaff?.login_name || 'admin').slice(0, 100);

  try {
    const res = await db.query(
      `UPDATE core.tenant_module_config
       SET is_enabled = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2
       WHERE company_id = $3 AND module_code = $4
       RETURNING module_code, is_enabled`,
      [enabled, updatedBy, companyId, moduleCode]
    );

    if (res.rows.length === 0) {
      // Module config doesn't exist — insert it
      await db.query(
        `INSERT INTO core.tenant_module_config (company_id, module_code, is_enabled, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id, module_code) DO UPDATE SET
           is_enabled = $3, updated_at = CURRENT_TIMESTAMP, updated_by = $5`,
        [companyId, moduleCode, enabled, updatedBy, updatedBy]
      );
    }

    return { moduleCode, isEnabled: enabled };
  } catch (err) {
    if (err.code === '42P01') {
      // Table doesn't exist in legacy install
      const e = new Error('Tenant module config not available in this system');
      e.status = 503;
      throw e;
    }
    throw err;
  }
}

/**
 * Bulk update module config for a company.
 * Input: { module_code: is_enabled, ... }
 */
export async function updateTenantModuleConfigBulk(db, authStaff, companyId, config) {
  if (!config || typeof config !== 'object') {
    const err = new Error('config must be an object');
    err.status = 400;
    throw err;
  }

  const updatedBy = String(authStaff?.staff_name || authStaff?.login_name || 'admin').slice(0, 100);
  const updates = [];

  for (const [moduleCode, isEnabled] of Object.entries(config)) {
    const enabled = isEnabled === true;
    updates.push(
      db.query(
        `UPDATE core.tenant_module_config
         SET is_enabled = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2
         WHERE company_id = $3 AND module_code = $4`,
        [enabled, updatedBy, companyId, moduleCode]
      )
    );
  }

  await Promise.all(updates);
  return await getTenantModuleConfig(db, companyId);
}
