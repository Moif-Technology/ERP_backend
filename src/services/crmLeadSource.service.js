import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/crmLeadSource.repository.js';
import {
  requiredStr, trimOrNull, toBool, toIntDefault, slugCode,
  requireCompanyId, actorStaffId,
} from '../utils/crmHelpers.js';

export async function list(pool, authStaff) {
  const companyId = requireCompanyId(authStaff);
  return repo.listByCompany(pool, companyId);
}

export async function create(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const sourceName = requiredStr(body.sourceName ?? body.source_name, 'sourceName', 150);
  const sourceCode = trimOrNull(body.sourceCode ?? body.source_code, 30) || slugCode(sourceName);
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))',
      [`biz.lead_source_master:${companyId}`]);
    const sourceId = await repo.nextSourceId(client, companyId);
    return repo.insert(client, {
      companyId,
      sourceId,
      sourceCode,
      sourceName,
      description: trimOrNull(body.description ?? body.source_description, 300),
      isActive: toBool(body.isActive ?? body.is_active, true),
      displayOrder: toIntDefault(body.displayOrder ?? body.display_order, sourceId),
      actorStaffId: actorStaffId(authStaff),
    });
  });
}

export async function update(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const sourceName = requiredStr(body.sourceName ?? body.source_name, 'sourceName', 150);
  const sourceCode = trimOrNull(body.sourceCode ?? body.source_code, 30) || slugCode(sourceName);
  const updated = await repo.update(pool, companyId, Number(id), {
    sourceCode,
    sourceName,
    description: trimOrNull(body.description ?? body.source_description, 300),
    isActive: toBool(body.isActive ?? body.is_active, true),
    displayOrder: toIntDefault(body.displayOrder ?? body.display_order, 0),
    actorStaffId: actorStaffId(authStaff),
  });
  if (!updated) { const e = new Error('Lead source not found'); e.status = 404; throw e; }
  return updated;
}

export async function remove(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const ok = await repo.remove(pool, companyId, Number(id));
  if (!ok) { const e = new Error('Lead source not found'); e.status = 404; throw e; }
  return { ok: true };
}
