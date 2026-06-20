const ACTIVE_STATUS = 'A';

export async function nextUnitId(db, companyId) {
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(unit_id), 0) + 1 AS next_id FROM core.unit_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

export async function insertUnit(db, { companyId, unitId, unitCode, unitName, createdBy }) {
  const { rows } = await db.query(
    `INSERT INTO core.unit_master (company_id, unit_id, unit_code, unit_name, record_status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING company_id, unit_id, unit_code, unit_name, record_status`,
    [companyId, unitId, unitCode, unitName, ACTIVE_STATUS, createdBy || 'system']
  );
  return rows[0];
}

export async function updateUnit(db, { companyId, unitId, unitCode, unitName }) {
  const { rows } = await db.query(
    `UPDATE core.unit_master
     SET unit_code = $3, unit_name = $4
     WHERE company_id = $1 AND unit_id = $2 AND COALESCE(record_status, 'A') IN ('A', 'ACTIVE')
     RETURNING company_id, unit_id, unit_code, unit_name, record_status`,
    [companyId, unitId, unitCode, unitName]
  );
  return rows[0] ?? null;
}

export async function softDeleteUnit(db, companyId, unitId) {
  const { rowCount } = await db.query(
    `UPDATE core.unit_master SET record_status = 'D'
     WHERE company_id = $1 AND unit_id = $2 AND COALESCE(record_status, 'A') IN ('A', 'ACTIVE')`,
    [companyId, unitId]
  );
  return rowCount === 1;
}

export async function unitCodeExists(db, companyId, unitCode, excludeUnitId = null) {
  const { rows } = await db.query(
    `SELECT 1 FROM core.unit_master
     WHERE company_id = $1 AND UPPER(unit_code) = UPPER($2)
       AND COALESCE(record_status, 'A') IN ('A', 'ACTIVE')
       AND ($3::int IS NULL OR unit_id <> $3)
     LIMIT 1`,
    [companyId, unitCode, excludeUnitId]
  );
  return rows.length > 0;
}

function mapRow(row) {
  return {
    unitId: Number(row.unit_id),
    companyId: Number(row.company_id),
    unitCode: row.unit_code,
    unitName: row.unit_name,
    recordStatus: row.record_status,
  };
}

export async function listUnitsByCompany(db, companyId) {
  const { rows } = await db.query(
    `SELECT company_id, unit_id, unit_code, unit_name, record_status
     FROM core.unit_master
     WHERE company_id = $1
       AND COALESCE(record_status, 'A') IN ('A', 'ACTIVE')
     ORDER BY unit_code ASC`,
    [companyId]
  );
  return rows.map(mapRow);
}

export async function countUnitsByCompany(db, companyId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM core.unit_master
     WHERE company_id = $1
       AND COALESCE(record_status, 'A') IN ('A', 'ACTIVE')`,
    [companyId]
  );
  return Number(rows[0]?.n || 0);
}

export async function seedDefaultUnits(db, companyId, createdBy = 'system') {
  const defaults = [
    ['PCS', 'Pieces'],
    ['NOS', 'Numbers'],
    ['PKT', 'Packet'],
    ['BOX', 'Box'],
    ['CTN', 'Carton'],
    ['KG', 'Kilogram'],
    ['G', 'Gram'],
    ['LTR', 'Litre'],
    ['ML', 'Millilitre'],
    ['MTR', 'Metre'],
  ];

  const valuesSql = defaults
    .map((_, idx) => `($1, ${idx + 1}, $${idx * 2 + 2}, $${idx * 2 + 3}, '${ACTIVE_STATUS}', $${defaults.length * 2 + 2})`)
    .join(', ');
  const params = [
    companyId,
    ...defaults.flatMap(([code, name]) => [code, name]),
    createdBy,
  ];

  await db.query(
    `INSERT INTO core.unit_master (
       company_id, unit_id, unit_code, unit_name, record_status, created_by
     )
     VALUES ${valuesSql}
     ON CONFLICT (company_id, unit_code) DO NOTHING`,
    params
  );
}
