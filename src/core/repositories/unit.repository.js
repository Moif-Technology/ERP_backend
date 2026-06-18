const ACTIVE_STATUS = 'A';

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
