/**
 * Company / branch application parameters (core.app_parameter + company overrides).
 */

const GV_TAX_KEYS = ['gvtax', 'gv_tax', 'gov_tax', 'tax1'];

function parseRate(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

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

const CURRENCY_PRECISION_KEYS = [
  'currency_precision',
  'currencyprecession',
  'currency_precession',
];

/** Decimal places for money display (legacy currencyPrecession / currency_precision). */
export async function resolveCurrencyPrecision(db, companyId, branchId = null) {
  for (const key of CURRENCY_PRECISION_KEYS) {
    const fromApp = await getAppParameterNumeric(db, companyId, branchId, key);
    if (fromApp != null) return Math.min(6, Math.max(0, Math.trunc(fromApp)));
  }

  const fromPos = await getCompanyModuleSetting(db, companyId, 'POS', 'currency_precision');
  if (fromPos != null) return Math.min(6, Math.max(0, Math.trunc(fromPos)));

  const fromDef = await getParameterDefinitionDefault(db, 'POS', 'currency_precision');
  if (fromDef != null) return Math.min(6, Math.max(0, Math.trunc(fromDef)));

  return 2;
}

const AUTO_ROUND_OFF_KEYS = ['autoroundoff', 'auto_round_off', 'auto_roundoff'];

/** POS bill round-off to nearest 0.25 — 1 = enabled, 0 = disabled (default). */
export async function resolveAutoRoundOff(db, companyId, branchId = null) {
  for (const key of AUTO_ROUND_OFF_KEYS) {
    const fromApp = await getAppParameterNumeric(db, companyId, branchId, key);
    if (fromApp != null) return fromApp === 1 ? 1 : 0;
  }

  const fromPos = await getCompanyModuleSetting(db, companyId, 'POS', 'autoroundoff');
  if (fromPos != null) return fromPos === 1 ? 1 : 0;

  const fromDef = await getParameterDefinitionDefault(db, 'POS', 'autoroundoff');
  if (fromDef != null) return fromDef === 1 ? 1 : 0;

  return 0;
}

/** Branch-specific row wins over company-wide (branch_id IS NULL). */
export async function getAppParameterString(db, companyId, branchId, parameterKey) {
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
      `SELECT ap.string_value, ap.numeric_value, ap.branch_id
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
    const s = rows[0].string_value != null ? String(rows[0].string_value).trim() : '';
    if (s) return s;
    if (rows[0].numeric_value != null) return String(rows[0].numeric_value);
    return null;
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return null;
    throw e;
  }
}

/** Company / branch receipt header (same source as tax invoice print). */
export async function resolveReceiptCompanyHeader(db, companyId, branchId = null) {
  try {
    const { rows } = await db.query(
      `SELECT co.company_name,
              co.company_address,
              co.phone AS company_phone,
              br.branch_name
       FROM core.company_master co
       LEFT JOIN core.branch_master br
         ON br.company_id = co.company_id AND br.branch_id = $2
       WHERE co.company_id = $1
       LIMIT 1`,
      [companyId, branchId],
    );
    const r = rows[0] ?? {};
    const taxRegistrationNo = await resolveTaxRegistrationNo(db, companyId, branchId);
    return {
      companyName: r.company_name != null ? String(r.company_name).trim() : null,
      companyAddress: r.company_address != null ? String(r.company_address).trim() : null,
      companyPhone: r.company_phone != null ? String(r.company_phone).trim() : null,
      branchName: r.branch_name != null ? String(r.branch_name).trim() : null,
      taxRegistrationNo,
    };
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return null;
    throw e;
  }
}

const TRN_KEYS = ['tax_registration_no', 'trn', 'company_trn', 'tax_reg_no'];

/** Company TRN for tax invoice printing. */
export async function resolveTaxRegistrationNo(db, companyId, branchId = null) {
  for (const key of TRN_KEYS) {
    const fromApp = await getAppParameterString(db, companyId, branchId, key);
    if (fromApp) return fromApp;
  }
  try {
    const { rows } = await db.query(
      `SELECT settings->>'tax_registration_no' AS trn
       FROM core.company_parameter_value
       WHERE company_id = $1 AND module = 'POS'
       LIMIT 1`,
      [companyId],
    );
    const trn = rows[0]?.trn != null ? String(rows[0].trn).replace(/"/g, '').trim() : '';
    if (trn) return trn;
  } catch (e) {
    if (e.code !== '42P01' && e.code !== '42703') throw e;
  }
  return null;
}
