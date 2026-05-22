export async function nextColorId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(color_id), 0) + 1 AS next_id FROM garage.color_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

function mapRow(row) {
  return {
    id: Number(row.id),
    colorId: Number(row.color_id),
    companyId: Number(row.company_id),
    colorCode: row.color_code,
    colorName: row.color_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertColor(client, { colorId, companyId, colorCode, colorName }) {
  const { rows } = await client.query(
    `INSERT INTO garage.color_master (color_id, company_id, color_code, color_name)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [colorId, companyId, colorCode || null, colorName]
  );
  return mapRow(rows[0]);
}

export async function listColors(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT * FROM garage.color_master WHERE company_id = $1 ORDER BY color_name ASC`,
    [companyId]
  );
  return rows.map(mapRow);
}

export async function deleteColor(pool, companyId, colorId) {
  const { rowCount } = await pool.query(
    `DELETE FROM garage.color_master WHERE company_id = $1 AND color_id = $2`,
    [companyId, colorId]
  );
  return rowCount > 0;
}
