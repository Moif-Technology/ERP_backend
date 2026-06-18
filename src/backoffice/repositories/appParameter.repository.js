/**
 * Company / branch application parameters (core.app_parameter + company overrides).
 */

const GV_TAX_KEYS = ['gvtax', 'gv_tax', 'gov_tax', 'tax1'];

function parseRate(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Branch-specific row wins over company-wide (branch_id IS NULL). */
export async function getAppParameterNumeric(db, companyId, branchId, parameterKey) {
  const params = [companyId, parameterKey];
  let branchSql = '';
  if (branchId != null) {
    params.push(branchId);
    branchSql = `AND (ap.branch_id IS NULL OR ap.branch_id = $${params.length})`;
  } else {
    branchSql = 'AND ap.branch_id IS NULL';
  }

  try {
    const { rows } = await db.query(
      `SELECT ap.numeric_value, ap.string_value, ap.branch_id
       FROM core.app_parameter ap
       WHERE ap.company_id = $1
         AND LOWER(ap.parameter_key) = LOWER($2)
         AND ap.is_active IS NOT FALSE
         ${branchSql}
       ORDER BY ap.branch_id DESC NULLS LAST
       LIMIT 1`,
      params,
    );
    if (!rows[0]) return null;
    return parseRate(rows[0].numeric_value) ?? parseRate(rows[0].string_value);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return null;
    throw e;
  }
}

export async function getCompanyModuleSetting(db, companyId, module, settingKey) {
  try {
    const { rows } = await db.query(
      `SELECT settings->$3 AS val
       FROM core.company_parameter_value
       WHERE company_id = $1 AND module = $2
       LIMIT 1`,
      [companyId, module, settingKey],
    );
    if (rows[0]?.val == null) return null;
    const raw = rows[0].val;
    if (raw == null) return null;
    if (typeof raw === 'number') return parseRate(raw);
    return parseRate(String(raw).replace(/"/g, ''));
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return null;
    throw e;
  }
}

export async function getParameterDefinitionDefault(db, module, parameterKey) {
  try {
    const { rows } = await db.query(
      `SELECT default_value
       FROM core.parameter_definition
       WHERE module = $1
         AND LOWER(parameter_key) = LOWER($2)
         AND is_active IS NOT FALSE
       LIMIT 1`,
      [module, parameterKey],
    );
    if (!rows[0]) return null;
    return parseRate(rows[0].default_value);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return null;
    throw e;
  }
}

/** Government / standard VAT % — legacy name gvtax (maps to tax1 in POS settings). */
export async function resolveGvTaxRate(db, companyId, branchId = null) {
  for (const key of GV_TAX_KEYS) {
    const fromApp = await getAppParameterNumeric(db, companyId, branchId, key);
    if (fromApp != null) return fromApp;
  }

  const fromPos = await getCompanyModuleSetting(db, companyId, 'POS', 'tax1');
  if (fromPos != null) return fromPos;

  const fromInv = await getCompanyModuleSetting(db, companyId, 'INVENTORY', 'tax1');
  if (fromInv != null) return fromInv;

  const fromDef = await getParameterDefinitionDefault(db, 'POS', 'tax1');
  if (fromDef != null) return fromDef;

  return 5;
}
