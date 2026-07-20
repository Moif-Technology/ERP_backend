import { withTransaction } from '../../config/db.js';
import * as repo from '../repositories/category.repository.js';
import { requiredStr, trimOrNull, toIntOrNull, requireCompanyId, actorStaffId } from '../../utils/crmHelpers.js';

export async function list(pool, authStaff) {
  const companyId = requireCompanyId(authStaff);
  return repo.listByCompany(pool, companyId);
}

export async function getById(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const row = await repo.findById(pool, companyId, Number(id));
  if (!row) { const e = new Error('Category not found'); e.status = 404; throw e; }
  return row;
}

function buildPayload(body) {
  return {
    categoryName: requiredStr(body.categoryName ?? body.category_name, 'categoryName', 150),
    description: trimOrNull(body.description, 500),
    sortOrder: toIntOrNull(body.sortOrder ?? body.sort_order) ?? 0,
  };
}

export async function create(pool, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const payload = buildPayload(body);
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`service.category_master:${companyId}`]);
    const categoryId = await repo.nextCategoryId(client, companyId);
    return repo.insert(client, { ...payload, companyId, categoryId, actorStaffId: actorStaffId(authStaff) });
  });
}

export async function update(pool, id, body, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const payload = buildPayload(body);
  const updated = await repo.update(pool, companyId, Number(id), { ...payload, actorStaffId: actorStaffId(authStaff) });
  if (!updated) { const e = new Error('Category not found'); e.status = 404; throw e; }
  return updated;
}

export async function remove(pool, id, authStaff) {
  const companyId = requireCompanyId(authStaff);
  const categoryId = Number(id);
  const inUse = await repo.hasActiveServices(pool, companyId, categoryId);
  if (inUse) { const e = new Error('Category has services. Move or delete them first.'); e.status = 409; throw e; }
  const ok = await repo.softDelete(pool, companyId, categoryId, actorStaffId(authStaff));
  if (!ok) { const e = new Error('Category not found'); e.status = 404; throw e; }
  return { ok: true };
}
