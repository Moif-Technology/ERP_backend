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
    assignedWaiterId,
    createdBy,
    modifiedBy,
  } = params;

  const { rows } = await client.query(
    `INSERT INTO core.table_master (
        table_id, company_id, branch_id, area_id,
        table_no, table_name, table_name_arabic,
        no_of_chairs, table_format, assigned_waiter_id,
        sync_status, created_by, modified_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', $11, $12
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
      assignedWaiterId ?? null,
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
       AND is_deleted = FALSE
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
       AND is_deleted = FALSE
     ORDER BY area_id ASC, table_no ASC`,
    [companyId, branchId]
  );
  return rows.map(mapRow);
}

export async function nextTableNo(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(table_no), 0) + 1 AS n
       FROM core.table_master
      WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId],
  );
  return Number(rows[0]?.n || 1);
}

export async function findTableByName(pool, companyId, branchId, tableName, excludeTableId = null) {
  const name = String(tableName ?? '').trim().toUpperCase();
  if (!name) return null;
  const params = [companyId, branchId, name];
  let excludeSql = '';
  if (excludeTableId != null && Number(excludeTableId) > 0) {
    params.push(Number(excludeTableId));
    excludeSql = ` AND table_id <> $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT table_id
       FROM core.table_master
      WHERE company_id = $1 AND branch_id = $2
        AND UPPER(TRIM(table_name)) = $3
        AND COALESCE(is_deleted, FALSE) = FALSE
        ${excludeSql}
      LIMIT 1`,
    params,
  );
  return rows[0] ? Number(rows[0].table_id) : null;
}

export async function findTable(pool, companyId, branchId, tableId) {
  const { rows } = await pool.query(
    `SELECT
        table_id, company_id, branch_id, area_id,
        table_no, table_name, table_name_arabic,
        no_of_chairs, table_format,
        assigned_waiter_id, sync_status,
        created_at, modified_at
       FROM core.table_master
      WHERE company_id = $1 AND branch_id = $2 AND table_id = $3
        AND COALESCE(is_deleted, FALSE) = FALSE
      LIMIT 1`,
    [companyId, branchId, tableId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function updateTable(client, params) {
  const {
    companyId,
    branchId,
    tableId,
    areaId,
    tableNo,
    tableName,
    tableNameArabic,
    noOfChairs,
    tableFormat,
    assignedWaiterId,
    modifiedBy,
  } = params;
  const { rows } = await client.query(
    `UPDATE core.table_master SET
        area_id = $4,
        table_no = $5,
        table_name = $6,
        table_name_arabic = $7,
        no_of_chairs = $8,
        table_format = $9,
        assigned_waiter_id = $10,
        sync_status = 'PENDING',
        modified_by = $11,
        modified_at = CURRENT_TIMESTAMP
     WHERE company_id = $1 AND branch_id = $2 AND table_id = $3
       AND COALESCE(is_deleted, FALSE) = FALSE
     RETURNING
        table_id, company_id, branch_id, area_id,
        table_no, table_name, table_name_arabic,
        no_of_chairs, table_format,
        assigned_waiter_id, sync_status,
        created_at, modified_at`,
    [
      companyId,
      branchId,
      tableId,
      areaId,
      tableNo,
      tableName,
      tableNameArabic ?? null,
      noOfChairs,
      tableFormat,
      assignedWaiterId ?? null,
      modifiedBy,
    ],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listWaiters(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT s.staff_id, s.staff_name, s.designation
       FROM core.staff_master s
       LEFT JOIN core.role_master r
         ON r.company_id = s.company_id AND r.role_id = s.role_id
      WHERE s.company_id = $1
        AND s.record_status = 'ACTIVE'
        AND (
          UPPER(TRIM(COALESCE(s.designation, ''))) = 'WAITER'
          OR UPPER(TRIM(COALESCE(r.role_name, ''))) = 'WAITER'
        )
        AND ($2::bigint IS NULL OR s.branch_id = $2 OR s.branch_id IS NULL)
      ORDER BY s.staff_name ASC NULLS LAST`,
    [companyId, branchId ?? null],
  );
  return rows.map((row) => ({
    staffId: Number(row.staff_id),
    staffName: row.staff_name,
    designation: row.designation ?? 'WAITER',
  }));
}
