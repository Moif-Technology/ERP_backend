import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/crmLeadStatus.repository.js';
import {
  requiredStr, trimOrNull, toBool, toIntDefault, slugCode,
  requireCompanyId, actorStaffId,
} from '../utils/crmHelpers.js';

const VALID_TYPES = new Set(['OPEN', 'CLOSED', 'WON', 'LOST']);

function normType(v) {
  const s = String(v || '').trim().toUpperCase() || 'OPEN';
  return VALID_TYPES.has(s) ? s : 'OPEN';
}

export async function list(pool, authStaff) {
  return repo.listByCompany(pool, requireCompanyId(authStaff));
}

export async function create(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const statusName = requiredStr(body.statusName ?? body.status_name, 'statusName', 150);
  const statusCode = trimOrNull(body.statusCode ?? body.status_code, 30) || slugCode(statusName);
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))',
      [`biz.lead_status_master:${companyId}`]);
    const statusId = await repo.nextStatusId(client, companyId);
    return repo.insert(client, {
      companyId,
      statusId,
      statusCode,
      statusName,
      statusType: normType(body.statusType ?? body.status_type),
      isFinalStatus: toBool(body.isFinalStatus ?? body.is_final_status, false),
      isActive: toBool(body.isActive ?? body.is_active, true),
      displayOrder: toIntDefault(body.displayOrder ?? body.display_order, statusId),
      actorStaffId: actorStaffId(authStaff),
    });
  });
}

export async function update(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const statusName = requiredStr(body.statusName ?? body.status_name, 'statusName', 150);
  const statusCode = trimOrNull(body.statusCode ?? body.status_code, 30) || slugCode(statusName);
  const updated = await repo.update(pool, companyId, Number(id), {
    statusCode,
    statusName,
    statusType: normType(body.statusType ?? body.status_type),
    isFinalStatus: toBool(body.isFinalStatus ?? body.is_final_status, false),
    isActive: toBool(body.isActive ?? body.is_active, true),
    displayOrder: toIntDefault(body.displayOrder ?? body.display_order, 0),
    actorStaffId: actorStaffId(authStaff),
  });
  if (!updated) { const e = new Error('Lead status not found'); e.status = 404; throw e; }
  return updated;
}

export async function remove(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const ok = await repo.remove(pool, companyId, Number(id));
  if (!ok) { const e = new Error('Lead status not found'); e.status = 404; throw e; }
  return { ok: true };
}
