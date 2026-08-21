/**
 * POS parameters: reads from core.parameter_definition and core.company_parameter_value.
 * Branch/counter receipt headings may also live in core.counter_parameter (legacy ParameterTableCounter).
 */

/** Receipt heading keys stored in company POS settings and/or counter_parameter. */
export const RECEIPT_SETTING_KEYS = [
  'heading1_counter',
  'heading2_counter',
  'heading3_counter',
  'heading4_counter',
  'heading5_counter',
  'heading6_counter',
  'heading7_counter',
  'tax_registration_no',
];

const RECEIPT_KEY_LOOKUP = RECEIPT_SETTING_KEYS.flatMap((key) => {
  const compact = key.replace(/_/g, '');
  const legacy = key.replace(/_counter$/, '').replace(/_/g, '');
  return [key, compact, legacy, key.replace(/_/g, ' ')];
});

const STABLE_COUNTER_PARAM_IDS = Object.fromEntries(
  RECEIPT_SETTING_KEYS.map((key, i) => [key, 101 + i]),
);

function isMissingTableError(err) {
  return err?.code === '42P01' || err?.code === '42703';
}

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

/**
 * Branch / station receipt headings from core.counter_parameter (ParameterTableCounter).
 * Station-specific row wins over branch-wide (station_id IS NULL).
 */
export async function getCounterReceiptSettings(client, companyId, branchId, stationId) {
  if (!companyId) return {};

  const readRows = async (bid, sid) => {
    // Build consecutive $n placeholders — skipping $2 when branch is omitted
    // triggers Postgres 42P18 ("could not determine data type of parameter $2").
    const params = [companyId];
    let branchSql = '';
    if (bid) {
      params.push(bid);
      branchSql = `AND branch_id = $${params.length}`;
    }
    params.push(sid ?? null);
    const sidIdx = params.length;
    params.push(RECEIPT_KEY_LOOKUP.map((k) => k.toLowerCase()));
    const keysIdx = params.length;

    const { rows } = await client.query(
      `SELECT parameter_key, parameter_name, string_value, station_id, counter_id
       FROM core.counter_parameter
       WHERE company_id = $1
         ${branchSql}
         AND is_active IS NOT FALSE
         AND (
           $${sidIdx}::bigint IS NULL
           OR station_id IS NULL
           OR station_id = $${sidIdx}
           OR counter_id = $${sidIdx}
         )
         AND (
           LOWER(parameter_key) = ANY($${keysIdx}::text[])
           OR LOWER(REPLACE(parameter_name, ' ', '')) = ANY($${keysIdx}::text[])
         )
       ORDER BY
         CASE WHEN station_id = $${sidIdx} OR counter_id = $${sidIdx} THEN 0 WHEN station_id IS NULL THEN 1 ELSE 2 END,
         modified_at DESC NULLS LAST`,
      params,
    );
    return rows;
  };

  try {
    let rows = [];
    if (branchId) {
      rows = await readRows(branchId, stationId);
    }
    if (!rows.length && stationId) {
      rows = await readRows(null, stationId);
    }

    const out = {};
    for (const row of rows) {
      const canonical = canonicalReceiptKey(row.parameter_key, row.parameter_name);
      if (!canonical || out[canonical]) continue;
      const val = row.string_value != null ? String(row.string_value).trim() : '';
      if (val) out[canonical] = val;
    }
    return out;
  } catch (err) {
    if (isMissingTableError(err)) return {};
    throw err;
  }
}

function canonicalReceiptKey(parameterKey, parameterName) {
  const candidates = [
    String(parameterKey ?? '').trim().toLowerCase(),
    String(parameterName ?? '').trim().toLowerCase().replace(/\s+/g, ''),
    String(parameterName ?? '').trim().toLowerCase().replace(/\s+/g, '_'),
  ];
  for (const key of RECEIPT_SETTING_KEYS) {
    const variants = [
      key,
      key.replace(/_/g, ''),
      key.replace(/_counter$/, '').replace(/_/g, ''),
    ];
    if (candidates.some((c) => variants.includes(c))) return key;
  }
  return null;
}

/** Upsert receipt headings for this branch + POS station (counter). */
export async function upsertCounterReceiptSettings(
  client,
  companyId,
  branchId,
  stationId,
  patch,
  updatedBy = 'pos_api',
) {
  if (!companyId || !branchId || !stationId || !patch || typeof patch !== 'object') return;

  for (const key of RECEIPT_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const val = String(patch[key] ?? '');
    const parameterId = STABLE_COUNTER_PARAM_IDS[key] ?? 900;
    const label = key.replace(/_counter$/, '').replace(/_/g, ' ');

    try {
      await client.query(
        `INSERT INTO core.counter_parameter (
           parameter_id, company_id, branch_id, counter_id, station_id,
           parameter_key, parameter_name, string_value, category, is_active,
           created_at, modified_at, created_by, modified_by
         ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, 'RECEIPT', TRUE, NOW(), NOW(), $8, $8)
         ON CONFLICT (company_id, branch_id, counter_id, parameter_key) DO UPDATE
           SET string_value = EXCLUDED.string_value,
               station_id   = EXCLUDED.station_id,
               modified_at  = NOW(),
               modified_by  = EXCLUDED.modified_by`,
        [parameterId, companyId, branchId, stationId, key, label, val, updatedBy],
      );
    } catch (err) {
      if (isMissingTableError(err)) return;
      throw err;
    }
  }
}
