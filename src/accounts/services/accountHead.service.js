import * as branchRepo from '../../shared/repositories/branch.repository.js';
import * as accountHeadRepo from '../repositories/accountHead.repository.js';
import * as accountsParameterRepo from '../repositories/accountsParameter.repository.js';
import { replaceStandardChart } from '../repositories/accountsSeed.repository.js';
import { withTransaction } from '../../config/db.js';

function resolveCompanyId(authStaff) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }
  return companyId;
}

function mapRow(r) {
  return {
    accountId: Number(r.account_id),
    accountNo: r.account_no,
    accountHead: r.account_head,
    accountType: r.account_type || null,
    parentAccId: r.parent_acc_id ? Number(r.parent_acc_id) : null,
    postingAllowed: Boolean(Number(r.posting_allowed) === 1 || r.posting_allowed === true),
  };
}

export async function listAccountHeads(pool, authStaff, query) {
  const companyId = resolveCompanyId(authStaff);
  const branchId = parseOptionalBranchId(query.branchId);
  if (branchId != null) {
    const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
    if (!ok) {
      const err = new Error('Invalid branch for this company');
      err.status = 400;
      throw err;
    }
  }
  const postingOnly = query.postingOnly === 'true' || query.postingOnly === '1';
  const accountNoPrefix = query.accountNoPrefix != null ? String(query.accountNoPrefix) : '';
  const opts = {
    accountNoPrefix: accountNoPrefix.trim() !== '' ? accountNoPrefix.trim() : undefined,
    postingOnly,
  };
  let rows = await accountHeadRepo.listAccountHeads(pool, companyId, opts);
  if (rows.length === 0 && opts.accountNoPrefix) {
    rows = await accountHeadRepo.listAccountHeads(pool, companyId, { ...opts, accountNoPrefix: undefined });
  }
  if (rows.length === 0 && postingOnly) {
    rows = await accountHeadRepo.listAccountHeads(pool, companyId, {
      accountNoPrefix: undefined,
      postingOnly: false,
    });
  }
  return { accountHeads: rows.map(mapRow) };
}

export async function getAccountTree(pool, authStaff) {
  const companyId = resolveCompanyId(authStaff);
  const rows = await accountHeadRepo.getAccountTree(pool, companyId);
  const mapped = rows.map(mapRow);

  const byId = new Map();
  for (const r of mapped) byId.set(r.accountId, { ...r, children: [] });
  const roots = [];
  for (const node of byId.values()) {
    if (node.parentAccId && byId.has(node.parentAccId)) {
      byId.get(node.parentAccId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return { tree: roots, flat: mapped };
}

export async function getAccountHead(pool, authStaff, accountId) {
  const companyId = resolveCompanyId(authStaff);
  const row = await accountHeadRepo.findAccountHead(pool, companyId, accountId);
  if (!row) {
    const err = new Error('Account head not found');
    err.status = 404;
    throw err;
  }
  return mapRow(row);
}

export async function suggestAccountNumber(pool, authStaff, query) {
  const companyId = resolveCompanyId(authStaff);
  const parentAccId = Number(query.parentAccId);
  if (!Number.isFinite(parentAccId) || parentAccId < 1) {
    const err = new Error('parentAccId is required');
    err.status = 400;
    throw err;
  }
  const accountNo = await accountHeadRepo.suggestNextAccountNo(pool, companyId, parentAccId);
  return { accountNo, parentAccId };
}

export async function createAccountHead(pool, authStaff, body) {
  const companyId = resolveCompanyId(authStaff);
  const { accountHead, accountType, parentAccId, postingAllowed } = body;
  let accountNo = body.accountNo != null ? String(body.accountNo).trim() : '';

  if (!accountHead || !String(accountHead).trim()) {
    const err = new Error('accountHead is required');
    err.status = 400;
    throw err;
  }

  const pid = parentAccId != null && parentAccId !== '' ? Number(parentAccId) : null;

  return withTransaction(async (client) => {
    if (!accountNo) {
      if (!pid) {
        const err = new Error('Select a parent group to auto-generate account number');
        err.status = 400;
        throw err;
      }
      accountNo = await accountHeadRepo.suggestNextAccountNo(client, companyId, pid);
    }

    if (pid) {
      const parent = await accountHeadRepo.findAccountHead(client, companyId, pid);
      if (!parent) {
        const err = new Error('Parent account not found');
        err.status = 400;
        throw err;
      }
    }

    const accountId = await accountHeadRepo.nextAccountId(client, companyId);
    await accountHeadRepo.createAccountHead(client, {
      companyId,
      accountId,
      parentAccId: pid,
      accountNo,
      accountHead: String(accountHead).trim(),
      accountType: accountType || null,
      postingAllowed: postingAllowed !== false,
    });
    return {
      accountId,
      accountNo,
      accountHead: String(accountHead).trim(),
      accountType,
      parentAccId: pid,
      postingAllowed: postingAllowed !== false,
    };
  });
}

export async function updateAccountHead(pool, authStaff, accountId, body) {
  const companyId = resolveCompanyId(authStaff);
  const id = Number(accountId);
  if (!Number.isFinite(id) || id < 1) {
    const err = new Error('Invalid accountId');
    err.status = 400;
    throw err;
  }

  const existing = await accountHeadRepo.findAccountHead(pool, companyId, id);
  if (!existing) {
    const err = new Error('Account not found');
    err.status = 404;
    throw err;
  }

  if (body.parentAccId !== undefined && body.parentAccId != null && body.parentAccId !== '') {
    const parentId = Number(body.parentAccId);
    if (parentId === id) {
      const err = new Error('Account cannot be its own parent');
      err.status = 400;
      throw err;
    }
    const parent = await accountHeadRepo.findAccountHead(pool, companyId, parentId);
    if (!parent) {
      const err = new Error('Parent account not found');
      err.status = 400;
      throw err;
    }
  }

  const patch = {};
  if (body.accountNo !== undefined) patch.accountNo = String(body.accountNo).trim();
  if (body.accountHead !== undefined) patch.accountHead = String(body.accountHead).trim();
  if (body.accountType !== undefined) patch.accountType = body.accountType || null;
  if (body.parentAccId !== undefined) {
    patch.parentAccId = body.parentAccId != null && body.parentAccId !== '' ? Number(body.parentAccId) : null;
  }
  if (body.postingAllowed !== undefined) patch.postingAllowed = body.postingAllowed !== false;

  if (patch.accountNo === '') {
    const err = new Error('accountNo cannot be empty');
    err.status = 400;
    throw err;
  }
  if (patch.accountHead === '') {
    const err = new Error('accountHead cannot be empty');
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    const updated = await accountHeadRepo.updateAccountHead(client, companyId, id, patch);
    if (!updated) {
      const err = new Error('Account not found or nothing to update');
      err.status = 404;
      throw err;
    }
    const row = await accountHeadRepo.findAccountHead(client, companyId, id);
    return mapRow(row);
  });
}

export async function deleteAccountHead(pool, authStaff, accountId) {
  const companyId = resolveCompanyId(authStaff);
  const hasChildren = await accountHeadRepo.accountHasChildren(pool, companyId, accountId);
  if (hasChildren) {
    const err = new Error('Cannot delete: account has child accounts');
    err.status = 409;
    throw err;
  }
  let hasVouchers = false;
  try {
    hasVouchers = await accountHeadRepo.accountHasVouchers(pool, companyId, accountId);
  } catch { /* voucher_detail table may not exist */ }
  if (hasVouchers) {
    const err = new Error('Cannot delete: account has voucher entries');
    err.status = 409;
    throw err;
  }
  return withTransaction(async (client) => {
    const deleted = await accountHeadRepo.softDeleteAccountHead(client, companyId, accountId);
    if (!deleted) {
      const err = new Error('Account not found');
      err.status = 404;
      throw err;
    }
    return { deleted: true };
  });
}

function parseBranchId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function parseOptionalBranchId(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  return parseBranchId(raw);
}

/**
 * Idempotent bootstrap: default chart of accounts, voucher types, and branch ledger defaults.
 */
export async function seedStandardChart(pool, authStaff, body) {
  const companyId = resolveCompanyId(authStaff);
  const branchId = parseBranchId(body?.branchId ?? authStaff.branch_id);
  if (branchId == null) {
    const err = new Error('branchId is required');
    err.status = 400;
    throw err;
  }
  const ok = await branchRepo.branchBelongsToCompany(pool, companyId, branchId);
  if (!ok) {
    const err = new Error('Invalid branch for this company');
    err.status = 400;
    throw err;
  }

  const actor = authStaff.staff_id != null ? `staff:${authStaff.staff_id}` : 'erp-bootstrap';

  return withTransaction(async (client) => {
    await replaceStandardChart(client, { companyId, branchId, actor });
    const rows = await accountHeadRepo.listAccountHeads(client, companyId, {});
    const settings = await accountsParameterRepo.getBranchIntegrationSettings(client, companyId, branchId);
    const missingRequired = accountsParameterRepo.getMissingRequiredIntegrationFields(settings);
    return {
      ok: true,
      branchId,
      accountCount: rows.length,
      ...settings,
      integrationComplete: missingRequired.length === 0,
      missingRequired,
    };
  });
}
