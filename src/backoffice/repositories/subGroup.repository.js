/**
 * Data access for biz.sub_group_master (company-scoped ids; rows tied to branch + parent group).
 */

export async function nextSubGroupId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(sub_group_id), 0) + 1 AS next_id
     FROM biz.sub_group_master
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
    subGroupId: Number(row.sub_group_id),
    companyId: Number(row.company_id),
    branchId: row.branch_id != null ? Number(row.branch_id) : null,
    groupId: Number(row.group_id),
    subGroupCode: row.sub_group_code,
    subGroupDescription: emptyToNull(row.sub_group_description),
    subGroupDescriptionArabic: emptyToNull(row.sub_group_description_arabic),
    rStatus: row.r_status,
    createdOn: row.created_on ?? null,
    modifiedOn: row.modified_on ?? null,
  };
}

export async function groupExistsForCompanyBranch(pool, companyId, branchId, groupId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM biz.group_master
     WHERE company_id = $1 AND branch_id = $2 AND group_id = $3
       AND (r_status IS NULL OR r_status = 'ACTIVE')
     LIMIT 1`,
    [companyId, branchId, groupId]
  );
  return rows.length > 0;
}

export async function insertSubGroup(client, params) {
  const {
    subGroupId,
    companyId,
    branchId,
    groupId,
    subGroupCode,
    subGroupDescription,
    subGroupDescriptionArabic,
  } = params;
  const { rows } = await client.query(
    `INSERT INTO biz.sub_group_master (
        sub_group_id, company_id, group_id, branch_id, sub_group_code,
        sub_group_description, sub_group_description_arabic, r_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'ACTIVE'
      )
      RETURNING sub_group_id, company_id, branch_id, group_id, sub_group_code,
                sub_group_description, sub_group_description_arabic, r_status,
                created_on, modified_on`,
    [
      subGroupId,
      companyId,
      groupId,
      branchId,
      subGroupCode,
      subGroupDescription,
      subGroupDescriptionArabic,
    ]
  );
  return mapRow(rows[0]);
}

/**
 * Sub-groups for a company. Deliberately NOT filtered by branch.
 *
 * biz.sub_group_master is UNIQUE (company_id, sub_group_id) and
 * UNIQUE (company_id, sub_group_code) — both company-wide. A sub_group_id
 * therefore belongs to exactly one branch and no other branch can ever reuse it,
 * which makes the stored branch_id a record of where the row was created rather
 * than a scope. Filtering the list by it only hid rows.
 *
 * That bit the salon till directly: POS passes its STATION id in the branchId
 * slot (station 2), while the seeded sub-groups carry branch 1, so the till's
 * sub-group chips came back empty while backoffice on station 1 saw all nine.
 * Duplicating rows per branch is not possible under the unique constraint, and
 * offsetting the ids would break the join to core.product_master.subgroup_id,
 * which stores the base id company-wide.
 *
 * Verified before changing: no company in either database has sub-groups under
 * more than one branch_id, so no tenant loses branch separation here.
 * `branchId` is still accepted and validated by the caller so an invalid branch
 * is still rejected.
 */
export async function listSubGroupsByCompanyBranch(pool, companyId, _branchId, groupIdFilter) {
  const params = [companyId];
  let sql = `SELECT sub_group_id, company_id, branch_id, group_id, sub_group_code,
                    sub_group_description, sub_group_description_arabic, r_status,
                    created_on, modified_on
             FROM biz.sub_group_master
             WHERE company_id = $1
               AND (r_status IS NULL OR r_status = 'ACTIVE')`;
  if (groupIdFilter != null && Number.isFinite(Number(groupIdFilter))) {
    sql += ` AND group_id = $2`;
    params.push(Number(groupIdFilter));
  }
  sql += ` ORDER BY group_id ASC, sub_group_code ASC`;
  const { rows } = await pool.query(sql, params);
  return rows.map(mapRow);
}
