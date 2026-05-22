/**
 * Data access for core.area_master (company + branch scoped).
 */

export async function nextAreaId(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(area_id), 0) + 1 AS next_id
     FROM core.area_master
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId]
  );
  return Number(rows[0].next_id);
}

function mapRow(row) {
  return {
    areaId: Number(row.area_id),
    companyId: Number(row.company_id),
    branchId: Number(row.branch_id),
    createdByStaffId:
      row.created_by_staff_id != null ? Number(row.created_by_staff_id) : null,
    areaName: row.area_name,
    areaNameArabic: row.area_name_arabic,
    tableCreationType: row.table_creation_type != null ? Number(row.table_creation_type) : null,
    supplyType: row.supply_type,
    kotPrefix: row.kot_prefix,
    isTabletShow: row.is_tablet_show,
    priceLevel: row.price_level,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
  };
}

export async function insertArea(client, params) {
  const {
    areaId,
    companyId,
    branchId,
    areaName,
    areaNameArabic,
    tableCreationType,
    supplyType,
    kotPrefix,
    isTabletShow,
    createdBy,
    modifiedBy,
    createdByStaffId,
  } = params;
  const { rows } = await client.query(
    `INSERT INTO core.area_master (
        area_id, company_id, branch_id, area_name, area_name_arabic,
        table_creation_type, supply_type, kot_prefix, is_tablet_show,
        created_by, modified_by, created_by_staff_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      RETURNING area_id, company_id, branch_id, created_by_staff_id, area_name, area_name_arabic,
                table_creation_type, supply_type, kot_prefix, is_tablet_show,
                price_level, created_at, modified_at`,
    [
      areaId,
      companyId,
      branchId,
      areaName,
      areaNameArabic,
      tableCreationType,
      supplyType,
      kotPrefix,
      isTabletShow,
      createdBy,
      modifiedBy,
      createdByStaffId ?? null,
    ]
  );
  return mapRow(rows[0]);
}

export async function listAreasByCompanyAndBranch(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT area_id, company_id, branch_id, created_by_staff_id, area_name, area_name_arabic,
            table_creation_type, supply_type, kot_prefix, is_tablet_show,
            price_level, created_at, modified_at
     FROM core.area_master
     WHERE company_id = $1 AND branch_id = $2
     ORDER BY area_name ASC`,
    [companyId, branchId]
  );
  return rows.map(mapRow);
}
