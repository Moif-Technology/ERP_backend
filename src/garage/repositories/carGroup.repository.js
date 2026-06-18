function mapRow(row) {
  return {
    id:           Number(row.id),
    carGroupId:   Number(row.car_group_id),
    companyId:    Number(row.company_id),
    carGroupName: row.car_group_name,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

export async function nextCarGroupId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(car_group_id), 0) + 1 AS next_id
     FROM garage.car_group WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

export async function insertCarGroup(client, { carGroupId, companyId, carGroupName }) {
  const { rows } = await client.query(
    `INSERT INTO garage.car_group (car_group_id, company_id, car_group_name)
     VALUES ($1, $2, $3) RETURNING *`,
    [carGroupId, companyId, carGroupName]
  );
  return mapRow(rows[0]);
}

export async function listCarGroups(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT * FROM garage.car_group WHERE company_id = $1 ORDER BY car_group_name ASC`,
    [companyId]
  );
  return rows.map(mapRow);
}

export async function deleteCarGroup(pool, companyId, carGroupId) {
  const { rowCount } = await pool.query(
    `DELETE FROM garage.car_group WHERE company_id = $1 AND car_group_id = $2`,
    [companyId, carGroupId]
  );
  return rowCount > 0;
}
