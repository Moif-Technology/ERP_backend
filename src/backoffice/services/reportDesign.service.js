import * as repo from '../repositories/reportDesign.repository.js';

function parseBranchId(raw) {
  if (raw == null || raw === '' || raw === 'null') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

export async function getReportDesign(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId  = parseBranchId(query.branchId);
  const reportKey = String(query.reportKey || '').trim();
  if (!reportKey) throw badRequest('reportKey is required');

  const row = await repo.getDesign(pool, { companyId, branchId, reportKey });
  return { design: row?.design_json ?? null, branchId };
}

export async function saveReportDesign(pool, authStaff, body) {
  const companyId  = Number(authStaff.company_id);
  const branchId   = parseBranchId(body.branchId);
  const reportKey  = String(body.reportKey || '').trim();
  const designJson = body.design;

  if (!reportKey)                                        throw badRequest('reportKey is required');
  if (!designJson || typeof designJson !== 'object')     throw badRequest('design must be a JSON object');

  await repo.upsertDesign(pool, { companyId, branchId, reportKey, designJson });
  return { ok: true };
}

export async function deleteReportDesign(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId  = parseBranchId(query.branchId);
  const reportKey = String(query.reportKey || '').trim();
  if (!reportKey) throw badRequest('reportKey is required');

  await repo.deleteDesign(pool, { companyId, branchId, reportKey });
  return { ok: true };
}
