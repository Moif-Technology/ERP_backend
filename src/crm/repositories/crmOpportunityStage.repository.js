/** Data access for biz.opportunity_stage_master (company scoped). */

function mapRow(r) {
  return {
    id: Number(r.id),
    stageId: Number(r.opportunity_stage_id),
    stageCode: r.stage_code,
    stageName: r.stage_name,
    probabilityPercent: r.probability_percent != null ? Number(r.probability_percent) : 0,
    isClosedStage: !!r.is_closed_stage,
    isWonStage: !!r.is_won_stage,
    isActive: !!r.is_active,
    displayOrder: r.display_order != null ? Number(r.display_order) : 0,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
  };
}

export async function nextStageId(client, companyId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(opportunity_stage_id), 0) + 1 AS n
       FROM biz.opportunity_stage_master WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0].n);
}

export async function listByCompany(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT * FROM biz.opportunity_stage_master
      WHERE company_id = $1
      ORDER BY display_order ASC, stage_name ASC`,
    [companyId]
  );
  return rows.map(mapRow);
}

export async function insert(client, p) {
  const { rows } = await client.query(
    `INSERT INTO biz.opportunity_stage_master
       (company_id, opportunity_stage_id, stage_code, stage_name,
        probability_percent, is_closed_stage, is_won_stage,
        is_active, display_order,
        created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
     RETURNING *`,
    [p.companyId, p.stageId, p.stageCode, p.stageName,
     p.probabilityPercent, p.isClosedStage, p.isWonStage,
     p.isActive, p.displayOrder, p.actorStaffId]
  );
  return mapRow(rows[0]);
}

export async function update(client, companyId, id, p) {
  const { rows } = await client.query(
    `UPDATE biz.opportunity_stage_master SET
        stage_code = $3, stage_name = $4, probability_percent = $5,
        is_closed_stage = $6, is_won_stage = $7, is_active = $8,
        display_order = $9,
        modified_by = $10, modified_at = NOW()
      WHERE company_id = $1 AND id = $2
      RETURNING *`,
    [companyId, id, p.stageCode, p.stageName, p.probabilityPercent,
     p.isClosedStage, p.isWonStage, p.isActive, p.displayOrder,
     p.actorStaffId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function remove(client, companyId, id) {
  const { rowCount } = await client.query(
    `DELETE FROM biz.opportunity_stage_master WHERE company_id = $1 AND id = $2`,
    [companyId, id]
  );
  return rowCount > 0;
}
