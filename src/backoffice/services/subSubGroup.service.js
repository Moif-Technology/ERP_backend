import { withTransaction } from '../../config/db.js';
import * as subSubGroupRepo from '../repositories/subSubGroup.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function parseId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export async function listSubSubGroups(pool, authStaff, branchIdQuery, groupIdQuery, subGroupIdQuery) {
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
  const gid = groupIdQuery != null && groupIdQuery !== '' ? parseId(groupIdQuery) : null;
  const sgid = subGroupIdQuery != null && subGroupIdQuery !== '' ? parseId(subGroupIdQuery) : null;
  return subSubGroupRepo.listSubSubGroupsByCompanyBranch(pool, companyId, bid, gid, sgid);
}

export async function createSubSubGroup(pool, body, authStaff) {
  const manualCode = (body.subSubGroupCode ?? '').trim();
  if (manualCode.length > 50) {
    const err = new Error('Sub-sub-group code must be at most 50 characters');
    err.status = 400;
    throw err;
  }

  const branchId = parseBranchId(body.branchId);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }

  const groupId = parseId(body.groupId);
  if (groupId == null) {
    const err = new Error('groupId is required');
    err.status = 400;
    throw err;
  }

  const subGroupId = parseId(body.subGroupId);
  if (subGroupId == null) {
    const err = new Error('subGroupId is required');
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

  const subGroupOk = await subSubGroupRepo.subGroupExistsForCompanyBranch(
    pool, companyId, branchId, groupId, subGroupId
  );
  if (!subGroupOk) {
    const err = new Error('Sub-group not found for this branch/group');
    err.status = 400;
    throw err;
  }

  const desc = body.subSubGroupDescription != null
    ? String(body.subSubGroupDescription).trim().slice(0, 200)
    : '';
  const descAr = body.subSubGroupDescriptionArabic != null
    ? String(body.subSubGroupDescriptionArabic).trim() || null
    : null;

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `biz.sub_sub_group_master:${companyId}`,
    ]);
    const subSubGroupCode = manualCode || await nextDocNo(client, {
      companyId,
      branchId,
      sequenceCode: 'SUB_SUB_GROUP',
    });
    const subSubGroupId = await subSubGroupRepo.nextSubSubGroupId(client, companyId);
    return subSubGroupRepo.insertSubSubGroup(client, {
      subSubGroupId,
      companyId,
      branchId,
      groupId,
      subGroupId,
      subSubGroupCode,
      subSubGroupDescription: desc,
      subSubGroupDescriptionArabic: descAr,
    });
  });
}
