/**
 * Data access for biz.modifier_master (company + branch scoped).
 * Legacy SQL Server table: ModifierTable (kitchen messages / line modifiers).
 */

function emptyToNull(v) {
  if (v == null || v === '') return null;
  return v;
}

function mapRow(row) {
  const modifierId = Number(row.modifier_id);
  const modifier = row.modifier ?? '';
  const modifierArabic = emptyToNull(row.modifier_arabic) ?? '';
  const uploadStatus = emptyToNull(row.upload_status) ?? '';
  return {
    modifierId,
    modifier,
    modifierArabic,
    uploadStatus,
    rStatus: row.r_status,
    // PascalCase aliases used by the legacy till (Modifierfrm / Flutter chips).
    ModifierID: modifierId,
    Modifier: modifier,
    ModifierArabic: modifierArabic,
    UploadStatus: uploadStatus,
  };
}

const MODIFIER_SELECT = `modifier_id, modifier, modifier_arabic, upload_status, r_status`;

export async function listModifiersByCompanyAndBranch(pool, companyId, branchId) {
  const { rows } = await pool.query(
    `SELECT ${MODIFIER_SELECT}
     FROM biz.modifier_master
     WHERE company_id = $1
       AND branch_id = $2
       AND (r_status IS NULL OR r_status = 'ACTIVE')
       AND COALESCE(is_deleted, FALSE) = FALSE
     ORDER BY modifier_id ASC, modifier ASC`,
    [companyId, branchId],
  );
  return rows.map(mapRow);
}
