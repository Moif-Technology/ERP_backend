function mapRow(row) {
  return {
    id:              Number(row.id),
    carSubGroupId:   Number(row.car_sub_group_id),
    companyId:       Number(row.company_id),
    carGroupId:      Number(row.car_group_id),
    carSubGroupName: row.car_sub_group_name,
    carGroupName:    row.car_group_name || '',
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}

export async function nextCarSubGroupId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(car_sub_group_id), 0) + 1 AS next_id
     FROM garage.car_sub_group WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

export async function insertCarSubGroup(client, { carSubGroupId, companyId, carGroupId, carSubGroupName }) {
  const { rows } = await client.query(
    `INSERT INTO garage.car_sub_group (car_sub_group_id, company_id, car_group_id, car_sub_group_name)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [carSubGroupId, companyId, carGroupId, carSubGroupName]
  );
  return { ...mapRow(rows[0]), car_group_name: '' };
}

export async function listCarSubGroups(pool, companyId, carGroupId) {
  if (carGroupId) {
    const { rows } = await pool.query(
      `SELECT sg.*, COALESCE(g.car_group_name, '') AS car_group_name
       FROM garage.car_sub_group sg
       LEFT JOIN garage.car_group g
         ON g.company_id = sg.company_id AND g.car_group_id = sg.car_group_id
       WHERE sg.company_id = $1 AND sg.car_group_id = $2
       ORDER BY sg.car_sub_group_name ASC`,
      [companyId, carGroupId]
    );
    return rows.map(mapRow);
  }
  const { rows } = await pool.query(
    `SELECT sg.*, COALESCE(g.car_group_name, '') AS car_group_name
     FROM garage.car_sub_group sg
     LEFT JOIN garage.car_group g
       ON g.company_id = sg.company_id AND g.car_group_id = sg.car_group_id
     WHERE sg.company_id = $1
     ORDER BY g.car_group_name ASC, sg.car_sub_group_name ASC`,
    [companyId]
  );
  return rows.map(mapRow);
}

export async function deleteCarSubGroup(pool, companyId, carSubGroupId) {
  const { rowCount } = await pool.query(
    `DELETE FROM garage.car_sub_group WHERE company_id = $1 AND car_sub_group_id = $2`,
    [companyId, carSubGroupId]
  );
  return rowCount > 0;
}

export async function carGroupExists(pool, companyId, carGroupId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM garage.car_group WHERE company_id = $1 AND car_group_id = $2`,
    [companyId, carGroupId]
  );
  return rows.length > 0;
}
