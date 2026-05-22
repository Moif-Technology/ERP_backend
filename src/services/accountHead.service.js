import * as branchRepo from '../repositories/branch.repository.js';
import * as accountHeadRepo from '../repositories/accountHead.repository.js';
import { withTransaction } from '../config/db.js';

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
  let branchId = query.branchId != null && String(query.branchId).trim() !== '' ? Number(query.branchId) : null;
  if (branchId == null && authStaff.branch_id != null) {
    branchId = Number(authStaff.branch_id);
  }
  if (branchId != null && Number.isFinite(branchId) && branchId >= 1) {
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

export async function createAccountHead(pool, authStaff, body) {
  const companyId = resolveCompanyId(authStaff);
  const { accountNo, accountHead, accountType, parentAccId, postingAllowed } = body;
  if (!accountNo || !accountHead) {
    const err = new Error('accountNo and accountHead are required');
    err.status = 400;
    throw err;
  }
  return withTransaction(async (client) => {
    if (parentAccId) {
      const parent = await accountHeadRepo.findAccountHead(pool, companyId, parentAccId);
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
      parentAccId: parentAccId || null,
      accountNo,
      accountHead,
      accountType: accountType || null,
      postingAllowed: postingAllowed !== false,
    });
    return { accountId, accountNo, accountHead, accountType, parentAccId, postingAllowed: postingAllowed !== false };
  });
}

export async function updateAccountHead(pool, authStaff, accountId, body) {
  const companyId = resolveCompanyId(authStaff);
  return withTransaction(async (client) => {
    const updated = await accountHeadRepo.updateAccountHead(client, companyId, accountId, body);
    if (!updated) {
      const err = new Error('Account not found or nothing to update');
      err.status = 404;
      throw err;
    }
    return { accountId, ...body };
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
