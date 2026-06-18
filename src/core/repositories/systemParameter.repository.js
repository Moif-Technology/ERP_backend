/**
 * Generic system parameter repository.
 * Definitions: core.parameter_definition (module, parameter_key)
 * Values:      core.company_parameter_value (company_id, module, settings JSONB)
 */

/** Load all active parameter definitions, optionally filtered by module. */
export async function getDefinitions(pool, module = null) {
  const { rows } = await pool.query(
    `SELECT module, parameter_key, parameter_name, value_type, default_value, category, sort_order
     FROM core.parameter_definition
     WHERE is_active = true ${module ? 'AND module = $1' : ''}
     ORDER BY module ASC, sort_order ASC, parameter_key ASC`,
    module ? [module] : []
  );
  return rows;
}

/** Load all stored company overrides, optionally filtered by module. */
export async function getCompanyValues(pool, companyId, module = null) {
  const { rows } = await pool.query(
    `SELECT module, settings
     FROM core.company_parameter_value
     WHERE company_id = $1 ${module ? 'AND module = $2' : ''}`,
    module ? [companyId, module] : [companyId]
  );
  // Return as { MODULE: { key: value, ... } }
  const result = {};
  for (const row of rows) {
    result[row.module] = row.settings ?? {};
  }
  return result;
}

/**
 * Upsert a patch into one module's settings for a company.
 * Uses JSONB || so only supplied keys are changed.
 */
export async function upsertModuleValues(pool, companyId, module, patch, updatedBy = 'api') {
  if (!patch || Object.keys(patch).length === 0) return;
  await pool.query(
    `INSERT INTO core.company_parameter_value (company_id, module, settings, updated_at, updated_by)
     VALUES ($1, $2, $3::jsonb, NOW(), $4)
     ON CONFLICT (company_id, module) DO UPDATE
       SET settings   = core.company_parameter_value.settings || EXCLUDED.settings,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by`,
    [companyId, module, JSON.stringify(patch), updatedBy]
  );
}
