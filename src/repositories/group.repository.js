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
    rStatus: row.r_status,
    createdOn: row.created_on ?? null,
    modifiedOn: row.modified_on ?? null,
  };
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
    createdByStaffId,
  } = params;
  const { rows } = await client.query(
    `INSERT INTO biz.group_master (
        group_id, company_id, branch_id, group_code, group_description, group_description_arabic,
        key_code, key_shift, r_status, created_by_staff_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9
      )
      RETURNING group_id, company_id, branch_id, created_by_staff_id, group_code, group_description,
                group_description_arabic, key_code, key_shift, r_status`,
    [
      groupId,
      companyId,
      branchId,
      groupCode,
      groupDescription,
      groupDescriptionArabic,
      keyCode,
      keyShift,
      createdByStaffId ?? null,
    ]
  );
  return mapRow(rows[0]);
}

export async function listGroupsByCompanyAndBranch(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT group_id, company_id, branch_id, created_by_staff_id, group_code, group_description,
            group_description_arabic, key_code, key_shift, r_status
     FROM biz.group_master
     WHERE company_id = $1
       AND branch_id = $2
       AND (r_status IS NULL OR r_status = 'ACTIVE')
     ORDER BY group_code ASC`,
    [companyId, branchId]
  );
  return rows.map(mapRow);
}
