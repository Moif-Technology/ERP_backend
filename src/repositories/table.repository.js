/**
 * Data access for core.table_master (company + branch + area scoped).
 */

export async function nextTableId(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(table_id), 0) + 1 AS next_id
     FROM core.table_master
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId]
  );
  return Number(rows[0].next_id);
}

export async function countActiveTables(db, companyId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM core.table_master
     WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0]?.n || 0);
}

function mapRow(row) {
  return {
    tableId: Number(row.table_id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    areaId: Number(row.area_id),
    tableNo: Number(row.table_no),
    tableName: row.table_name,
    tableNameArabic: row.table_name_arabic ?? null,
    noOfChairs: Number(row.no_of_chairs),
    tableFormat: row.table_format,
    assignedWaiterId: row.assigned_waiter_id != null ? Number(row.assigned_waiter_id) : null,
    syncStatus: row.sync_status ?? null,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
  };
}

export async function insertTable(client, params) {
  const {
    tableId,
    companyId,
    branchId,
    areaId,
    tableNo,
    tableName,
    tableNameArabic,
    noOfChairs,
    tableFormat,
    createdBy,
    modifiedBy,
  } = params;

  const { rows } = await client.query(
    `INSERT INTO core.table_master (
        table_id, company_id, branch_id, area_id,
        table_no, table_name, table_name_arabic,
        no_of_chairs, table_format,
        created_by, modified_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
      RETURNING
        table_id, company_id, branch_id, area_id,
        table_no, table_name, table_name_arabic,
        no_of_chairs, table_format,
        assigned_waiter_id, sync_status,
        created_at, modified_at`,
    [
      tableId,
      companyId,
      branchId,
      areaId,
      tableNo,
      tableName,
      tableNameArabic ?? null,
      noOfChairs,
      tableFormat,
      createdBy,
      modifiedBy,
    ]
  );
  return mapRow(rows[0]);
}

export async function listTablesByArea(pool, companyId, branchId, areaId) {
  const { rows } = await pool.query(
    `SELECT
        table_id, company_id, branch_id, area_id,
        table_no, table_name, table_name_arabic,
        no_of_chairs, table_format,
        assigned_waiter_id, sync_status,
        created_at, modified_at
     FROM core.table_master
     WHERE company_id = $1 AND branch_id = $2 AND area_id = $3
     ORDER BY table_no ASC`,
    [companyId, branchId, areaId]
  );
  return rows.map(mapRow);
}

export async function listTablesByBranch(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT
        table_id, company_id, branch_id, area_id,
        table_no, table_name, table_name_arabic,
        no_of_chairs, table_format,
        assigned_waiter_id, sync_status,
        created_at, modified_at
     FROM core.table_master
     WHERE company_id = $1 AND branch_id = $2
     ORDER BY area_id ASC, table_no ASC`,
    [companyId, branchId]
  );
  return rows.map(mapRow);
}
