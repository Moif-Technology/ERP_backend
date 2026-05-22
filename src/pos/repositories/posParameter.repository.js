/**
 * POS parameters: reads from core.parameter_definition and core.company_parameter_value.
 * Writes (upserts) go only to core.company_parameter_value.
 */

/** Load all active POS parameter definitions (product-level, no company). */
export async function getPosDefinitions(client) {
  const { rows } = await client.query(
    `SELECT parameter_key, parameter_name, value_type, default_value, category, sort_order
     FROM core.parameter_definition
     WHERE module = 'POS' AND is_active = true
     ORDER BY sort_order ASC, parameter_key ASC`
  );
  return rows;
}

/** Load the company's stored overrides (JSONB). Returns {} if no row yet. */
export async function getCompanyPosValues(client, companyId) {
  const { rows } = await client.query(
    `SELECT settings
     FROM core.company_parameter_value
     WHERE company_id = $1 AND module = 'POS'`,
    [companyId]
  );
  return rows[0]?.settings ?? {};
}

/**
 * Merge patch into the company's pos settings (INSERT on first write, UPDATE on repeat).
 * Uses JSONB || operator so only supplied keys are changed.
 */
export async function upsertCompanyPosValues(client, companyId, patch, updatedBy = 'pos_api') {
  await client.query(
    `INSERT INTO core.company_parameter_value (company_id, module, settings, updated_at, updated_by)
     VALUES ($1, 'POS', $2::jsonb, NOW(), $3)
     ON CONFLICT (company_id, module) DO UPDATE
       SET settings   = core.company_parameter_value.settings || EXCLUDED.settings,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by`,
    [companyId, JSON.stringify(patch), updatedBy]
  );
}
