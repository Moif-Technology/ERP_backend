/**
 * Data access for biz.sub_sub_group_master.
 * Actual schema: PK = id (bigint auto-inc), business key = (company_id, sub_sub_group_id).
 * Soft-delete via is_deleted boolean.
 * branch_id and group_id added via migration 083.
 */

export async function nextSubSubGroupId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(sub_sub_group_id), 0) + 1 AS next_id
     FROM biz.sub_sub_group_master
     WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].next_id);
}

function emptyToNull(v) {
  if (v == null || v === '') return null;
  return v;
}

function mapRow(row) {
  return {
    subSubGroupId: Number(row.sub_sub_group_id),
    companyId: Number(row.company_id),
    branchId: row.branch_id != null ? Number(row.branch_id) : null,
    groupId: row.group_id != null ? Number(row.group_id) : null,
    subGroupId: Number(row.sub_group_id),
    subSubGroupCode: row.sub_sub_group_code,
    subSubGroupDescription: emptyToNull(row.sub_sub_group_description),
    subSubGroupDescriptionArabic: emptyToNull(row.sub_sub_group_description_arabic),
    rStatus: row.r_status,
    createdOn: row.created_on ?? null,
    modifiedOn: row.modified_on ?? null,
  };
}

export async function subGroupExistsForCompanyBranch(pool, companyId, branchId, groupId, subGroupId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM biz.sub_group_master
     WHERE company_id = $1 AND branch_id = $2 AND group_id = $3 AND sub_group_id = $4
       AND (r_status IS NULL OR r_status = 'ACTIVE')
     LIMIT 1`,
    [companyId, branchId, groupId, subGroupId]
  );
  return rows.length > 0;
}

export async function insertSubSubGroup(client, params) {
  const {
    subSubGroupId,
    companyId,
    branchId,
    groupId,
    subGroupId,
    subSubGroupCode,
    subSubGroupDescription,
    subSubGroupDescriptionArabic,
  } = params;
  const { rows } = await client.query(
    `INSERT INTO biz.sub_sub_group_master (
        sub_sub_group_id, company_id, branch_id, group_id, sub_group_id,
        sub_sub_group_code, sub_sub_group_description, sub_sub_group_description_arabic,
        r_status, is_deleted
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', false
      )
      RETURNING sub_sub_group_id, company_id, branch_id, group_id, sub_group_id,
                sub_sub_group_code, sub_sub_group_description, sub_sub_group_description_arabic,
                r_status, created_on, modified_on`,
    [
      subSubGroupId,
      companyId,
      branchId,
      groupId,
      subGroupId,
      subSubGroupCode,
      subSubGroupDescription,
      subSubGroupDescriptionArabic,
    ]
  );
  return mapRow(rows[0]);
}

export async function listSubSubGroupsByCompanyBranch(pool, companyId, branchId, groupIdFilter, subGroupIdFilter) {
  const params = [companyId, branchId];
  let sql = `SELECT sub_sub_group_id, company_id, branch_id, group_id, sub_group_id,
                    sub_sub_group_code, sub_sub_group_description, sub_sub_group_description_arabic,
                    r_status, created_on, modified_on
             FROM biz.sub_sub_group_master
             WHERE company_id = $1 AND branch_id = $2
               AND (is_deleted IS NULL OR is_deleted = false)
               AND (r_status IS NULL OR r_status = 'ACTIVE')`;
  if (groupIdFilter != null && Number.isFinite(Number(groupIdFilter))) {
    params.push(Number(groupIdFilter));
    sql += ` AND group_id = $${params.length}`;
  }
  if (subGroupIdFilter != null && Number.isFinite(Number(subGroupIdFilter))) {
    params.push(Number(subGroupIdFilter));
    sql += ` AND sub_group_id = $${params.length}`;
  }
  sql += ` ORDER BY group_id ASC, sub_group_id ASC, sub_sub_group_code ASC`;
  const { rows } = await pool.query(sql, params);
  return rows.map(mapRow);
}
