import { withTransaction } from '../../config/db.js';
import * as subGroupRepo from '../repositories/subGroup.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function parseGroupId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export async function listSubGroups(pool, authStaff, branchIdQuery, groupIdQuery) {
  const companyId = Number(authStaff.company_id);
  let bid = parseBranchId(branchIdQuery);
  if (bid == null) {
    bid = parseBranchId(authStaff.branch_id);
  }
  if (bid == null) {
    const err = new Error('branchId is required (query branchId or set staff default branch)');
    err.status = 400;
    throw err;
  }
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, bid);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }
  const gid = groupIdQuery != null && groupIdQuery !== '' ? parseGroupId(groupIdQuery) : null;
  return subGroupRepo.listSubGroupsByCompanyBranch(pool, companyId, bid, gid);
}

/**
 * Allocates sub_group_id per company; parent group must exist for company + branch.
 */
export async function createSubGroup(pool, body, authStaff) {
  const code = (body.subGroupCode ?? '').trim();
  if (!code) {
    const err = new Error('Sub-group code is required');
    err.status = 400;
    throw err;
  }
  if (code.length > 50) {
    const err = new Error('Sub-group code must be at most 50 characters');
    err.status = 400;
    throw err;
  }

  const branchId = parseBranchId(body.branchId);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const groupId = parseGroupId(body.groupId);
  if (groupId == null) {
    const err = new Error('groupId is required');
    err.status = 400;
    throw err;
  }

  const companyId = Number(authStaff.company_id);
  const branchOk = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!branchOk) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  const groupOk = await subGroupRepo.groupExistsForCompanyBranch(pool, companyId, branchId, groupId);
  if (!groupOk) {
    const err = new Error('Group not found for this branch');
    err.status = 400;
    throw err;
  }

  const descRaw = body.subGroupDescription != null ? String(body.subGroupDescription).trim() : '';
  const desc = descRaw ? descRaw.slice(0, 300) : '';

  const descArRaw =
    body.subGroupDescriptionArabic != null ? String(body.subGroupDescriptionArabic).trim() : '';
  const descAr = descArRaw || null;

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `biz.sub_group_master:${companyId}`,
    ]);
    const subGroupId = await subGroupRepo.nextSubGroupId(client, companyId);
    return subGroupRepo.insertSubGroup(client, {
      subGroupId,
      companyId,
      branchId,
      groupId,
      subGroupCode: code,
      subGroupDescription: desc,
      subGroupDescriptionArabic: descAr,
    });
  });
}
