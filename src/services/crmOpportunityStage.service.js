import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/crmOpportunityStage.repository.js';
import {
  requiredStr, trimOrNull, toBool, toIntDefault, toNumberOrNull, slugCode,
  requireCompanyId, actorStaffId,
} from '../utils/crmHelpers.js';

function clampPercent(v) {
  const n = toNumberOrNull(v);
  if (n == null) return 0;
  return Math.max(0, Math.min(100, n));
}

export async function list(pool, authStaff) {
  return repo.listByCompany(pool, requireCompanyId(authStaff));
}

export async function create(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const stageName = requiredStr(body.stageName ?? body.stage_name, 'stageName', 150);
  const stageCode = trimOrNull(body.stageCode ?? body.stage_code, 30) || slugCode(stageName);
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))',
      [`biz.opportunity_stage_master:${companyId}`]);
    const stageId = await repo.nextStageId(client, companyId);
    return repo.insert(client, {
      companyId,
      stageId,
      stageCode,
      stageName,
      probabilityPercent: clampPercent(body.probabilityPercent ?? body.probability_percent),
      isClosedStage: toBool(body.isClosedStage ?? body.is_closed_stage, false),
      isWonStage: toBool(body.isWonStage ?? body.is_won_stage, false),
      isActive: toBool(body.isActive ?? body.is_active, true),
      displayOrder: toIntDefault(body.displayOrder ?? body.display_order, stageId),
      actorStaffId: actorStaffId(authStaff),
    });
  });
}

export async function update(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const stageName = requiredStr(body.stageName ?? body.stage_name, 'stageName', 150);
  const stageCode = trimOrNull(body.stageCode ?? body.stage_code, 30) || slugCode(stageName);
  const updated = await repo.update(pool, companyId, Number(id), {
    stageCode,
    stageName,
    probabilityPercent: clampPercent(body.probabilityPercent ?? body.probability_percent),
    isClosedStage: toBool(body.isClosedStage ?? body.is_closed_stage, false),
    isWonStage: toBool(body.isWonStage ?? body.is_won_stage, false),
    isActive: toBool(body.isActive ?? body.is_active, true),
    displayOrder: toIntDefault(body.displayOrder ?? body.display_order, 0),
    actorStaffId: actorStaffId(authStaff),
  });
  if (!updated) { const e = new Error('Opportunity stage not found'); e.status = 404; throw e; }
  return updated;
}

export async function remove(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const ok = await repo.remove(pool, companyId, Number(id));
  if (!ok) { const e = new Error('Opportunity stage not found'); e.status = 404; throw e; }
  return { ok: true };
}
