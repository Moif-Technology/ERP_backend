import { withTransaction } from '../../config/db.js';
import * as groupRepo from '../repositories/group.repository.js';
import * as branchRepo from '../../shared/repositories/branch.repository.js';
import { actorStaffPk } from '../../utils/actorStaff.js';
import { nextDocNo } from '../../shared/services/docSequence.service.js';

function parseOptionalNumeric(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Legacy NOT NULL on key_code / key_shift: use 0 when the user leaves them blank. */
function legacyKeyNumeric(v) {
  return parseOptionalNumeric(v) ?? 0;
}

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export async function listGroups(pool, authStaff, branchIdQuery) {
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
  return groupRepo.listGroupsByCompanyAndBranch(pool, companyId, bid);
}

/**
 * Allocates group_id per company + branch; company_id from JWT/session row.
 */
export async function createGroup(pool, body, authStaff) {
  // groupCode is now auto-generated from document_sequence.
  // If the caller provides a code (manual override), validate and use it.
  // If not provided (or empty), auto-generate.
  const manualCode = (body.groupCode ?? '').trim();
  if (manualCode.length > 50) {
    const err = new Error('Group code must be at most 50 characters');
    err.status = 400;
    throw err;
  }

  const branchId = parseBranchId(body.branchId);
  if (branchId == null) {
    const err = new Error('branchId is required');
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

  const descRaw = body.groupDescription != null ? String(body.groupDescription).trim() : '';
  const desc = descRaw ? descRaw.slice(0, 300) : '';

  const descArRaw =
    body.groupDescriptionArabic != null ? String(body.groupDescriptionArabic).trim() : '';
  const descAr = descArRaw;

  const keyCode = legacyKeyNumeric(body.keyCode);
  const keyShift = legacyKeyNumeric(body.keyShift);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
      `biz.group_master:${companyId}:${branchId}`,
    ]);

    // Auto-generate group code from document_sequence; use manual override if provided.
    const groupCode = manualCode || await nextDocNo(client, {
      companyId,
      branchId,
      sequenceCode: 'GROUP',
    });

    const groupId = await groupRepo.nextGroupId(client, companyId, branchId);
    return groupRepo.insertGroup(client, {
      groupId,
      companyId,
      branchId,
      groupCode,
      groupDescription: desc,
      groupDescriptionArabic: descAr,
      keyCode,
      keyShift,
      createdByStaffId: actorStaffPk(authStaff),
    });
  });
}
