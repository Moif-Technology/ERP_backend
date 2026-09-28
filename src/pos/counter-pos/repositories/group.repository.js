function mapGroup(row) {
  return {
    groupId:          Number(row.group_id),
    groupCode:        row.group_code,
    groupDescription: row.group_description,
    groupDescriptionArabic: row.group_description_arabic ?? null,
    keyShift:         row.key_shift != null ? Number(row.key_shift) : 0,
    sortOrder:        row.sort_order != null ? Number(row.sort_order) : 0,
  };
}

export async function listGroups(pool, companyId, branchId) {
  const params = [companyId];
  let branchSql = '';
  const bid = Number(branchId);
  if (Number.isFinite(bid) && bid > 0) {
    params.push(bid);
    branchSql = `AND (branch_id = $${params.length} OR branch_id IS NULL)`;
  } else {
    branchSql = 'AND branch_id IS NULL';
  }

  const { rows } = await pool.query(
    `SELECT group_id, group_code, group_description, group_description_arabic, key_shift, sort_order
     FROM biz.group_master
     WHERE company_id = $1
       ${branchSql}
       AND (r_status IS NULL OR UPPER(TRIM(r_status)) = 'ACTIVE')
     ORDER BY sort_order ASC, group_description ASC NULLS LAST, group_id ASC`,
    params,
  );
  return rows.map(mapGroup);
}
