function mapGroup(row) {
  return {
    groupId:          Number(row.group_id),
    groupCode:        row.group_code,
    groupDescription: row.group_description,
    groupDescriptionArabic: row.group_description_arabic ?? null,
    keyShift:         row.key_shift != null ? Number(row.key_shift) : 0,
  };
}

export async function listGroups(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT group_id, group_code, group_description, group_description_arabic, key_shift
     FROM biz.group_master
     WHERE company_id = $1
       AND (branch_id = $2 OR branch_id IS NULL)
       AND (r_status IS NULL OR r_status = 'ACTIVE')
     ORDER BY group_description`,
    [companyId, branchId],
  );
  return rows.map(mapGroup);
}
