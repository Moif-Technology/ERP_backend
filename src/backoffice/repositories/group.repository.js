/**
 * Data access for biz.group_master (company + branch scoped).
 */

export async function nextGroupId(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(group_id), 0) + 1 AS next_id
     FROM biz.group_master
     WHERE company_id = $1 AND branch_id = $2`,
    [companyId, branchId]
  );
  return Number(rows[0].next_id);
}

function emptyToNull(v) {
  if (v == null || v === '') return null;
  return v;
}

/** DB stores 0 for “no key”; API exposes null like optional fields. */
function keyNumericFromDb(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

function mapRow(row) {
  return {
    groupId: Number(row.group_id),
    companyId: Number(row.company_id),
    branchId: row.branch_id != null ? Number(row.branch_id) : null,
    createdByStaffId:
      row.created_by_staff_id != null ? Number(row.created_by_staff_id) : null,
    groupCode: row.group_code,
    groupDescription: emptyToNull(row.group_description),
    groupDescriptionArabic: emptyToNull(row.group_description_arabic),
    keyCode: keyNumericFromDb(row.key_code),
    keyShift: keyNumericFromDb(row.key_shift),
    sortOrder: row.sort_order != null ? Number(row.sort_order) : 0,
    rStatus: row.r_status,
    createdOn: row.created_on ?? null,
    modifiedOn: row.modified_at ?? row.modified_on ?? null,
  };
}

const GROUP_SELECT = `group_id, company_id, branch_id, created_by_staff_id, group_code, group_description,
            group_description_arabic, key_code, key_shift, sort_order, r_status`;

export async function nextSortOrder(client, companyId, branchId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort
     FROM biz.group_master
     WHERE company_id = $1
       AND branch_id = $2
       AND (r_status IS NULL OR r_status = 'ACTIVE')
       AND COALESCE(is_deleted, FALSE) = FALSE`,
    [companyId, branchId],
  );
  return Number(rows[0]?.next_sort ?? 1);
}

export async function insertGroup(client, params) {
  const {
    groupId,
    companyId,
    branchId,
    groupCode,
    groupDescription,
    groupDescriptionArabic,
    keyCode,
    keyShift,
    sortOrder,
    createdByStaffId,
  } = params;
  const { rows } = await client.query(
    `INSERT INTO biz.group_master (
        group_id, company_id, branch_id, group_code, group_description, group_description_arabic,
        key_code, key_shift, sort_order, r_status, created_by_staff_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', $10
      )
      RETURNING ${GROUP_SELECT}`,
    [
      groupId,
      companyId,
      branchId,
      groupCode,
      groupDescription,
      groupDescriptionArabic,
      keyCode,
      keyShift,
      sortOrder ?? 0,
      createdByStaffId ?? null,
    ]
  );
  return mapRow(rows[0]);
}

export async function listGroupsByCompanyAndBranch(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT ${GROUP_SELECT}
     FROM biz.group_master
     WHERE company_id = $1
       AND branch_id = $2
       AND (r_status IS NULL OR r_status = 'ACTIVE')
     ORDER BY sort_order ASC, group_description ASC NULLS LAST, group_id ASC`,
    [companyId, branchId]
  );
  return rows.map(mapRow);
}

export async function updateGroup(client, params) {
  const {
    groupId,
    companyId,
    branchId,
    groupCode,
    groupDescription,
    groupDescriptionArabic,
    keyCode,
    keyShift,
    sortOrder,
    modifiedByStaffId,
  } = params;
  const { rows } = await client.query(
    `UPDATE biz.group_master
     SET group_code = $4,
         group_description = $5,
         group_description_arabic = $6,
         key_code = $7,
         key_shift = $8,
         sort_order = COALESCE($9, sort_order),
         mod_by = 'group_update',
         mod_on = CURRENT_TIMESTAMP,
         modified_by = $10,
         modified_at = NOW()
     WHERE company_id = $1
       AND branch_id = $2
       AND group_id = $3
       AND (r_status IS NULL OR r_status = 'ACTIVE')
       AND is_deleted = FALSE
     RETURNING ${GROUP_SELECT}, modified_at`,
    [
      companyId,
      branchId,
      groupId,
      groupCode,
      groupDescription,
      groupDescriptionArabic,
      keyCode,
      keyShift,
      sortOrder != null && Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : null,
      modifiedByStaffId ?? null,
    ]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * Persist display order for POS / counter group tiles.
 * @param {number[]} orderedGroupIds — group_id values in desired order (1-based sort_order)
 */
export async function reorderGroups(client, { companyId, branchId, orderedGroupIds, modifiedByStaffId }) {
  for (let i = 0; i < orderedGroupIds.length; i += 1) {
    const groupId = Number(orderedGroupIds[i]);
    if (!Number.isFinite(groupId) || groupId < 1) continue;
    await client.query(
      `UPDATE biz.group_master
       SET sort_order = $4,
           mod_by = 'group_reorder',
           mod_on = CURRENT_TIMESTAMP,
           modified_by = $5,
           modified_at = NOW()
       WHERE company_id = $1
         AND branch_id = $2
         AND group_id = $3
         AND (r_status IS NULL OR r_status = 'ACTIVE')
         AND COALESCE(is_deleted, FALSE) = FALSE`,
      [companyId, branchId, groupId, i + 1, modifiedByStaffId ?? null],
    );
  }
  return listGroupsByCompanyAndBranch(client, companyId, branchId);
}

export async function softDeleteGroup(client, params) {
  const { groupId, companyId, branchId, deletedByStaffId } = params;
  const { rows } = await client.query(
    `UPDATE biz.group_master
     SET r_status = 'DELETED',
         mod_by = 'group_delete',
         mod_on = CURRENT_TIMESTAMP,
         deleted_by = $4,
         deleted_at = NOW(),
         is_deleted = TRUE,
         modified_by = $4,
         modified_at = NOW()
     WHERE company_id = $1
       AND branch_id = $2
       AND group_id = $3
       AND (r_status IS NULL OR r_status = 'ACTIVE')
       AND is_deleted = FALSE
     RETURNING ${GROUP_SELECT}, modified_at`,
    [companyId, branchId, groupId, deletedByStaffId ?? null]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}
