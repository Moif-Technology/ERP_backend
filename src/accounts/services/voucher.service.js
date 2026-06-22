import * as voucherRepo from '../repositories/voucher.repository.js';
import * as accountHeadRepo from '../repositories/accountHead.repository.js';
import { withTransaction } from '../../config/db.js';
import {
  isInventoryPurchasePaymentVoucher,
  resolvePurchasePaymentVoucherTypeIds,
  tryRestorePurchaseOutstandingForVoucher,
} from '../../backoffice/lib/purchasePaymentOutstanding.js';

function resolveCompanyBranch(authStaff, body) {
  const companyId = Number(authStaff.company_id);
  if (!Number.isFinite(companyId) || companyId < 1) {
    const err = new Error('Invalid company on session');
    err.status = 400;
    throw err;
  }
  let branchId = body?.branchId != null ? Number(body.branchId) : Number(authStaff.branch_id);
  if (!Number.isFinite(branchId) || branchId < 1) {
    const err = new Error('Branch is required');
    err.status = 400;
    throw err;
  }
  return { companyId, branchId };
}

function parseOptionalBranchId(raw) {
  if (raw == null || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : undefined;
}

async function resolveVoucherBranch(pool, companyId, voucherMasterId, hintBranchId = null) {
  const hint = parseOptionalBranchId(hintBranchId);
  if (hint) {
    const found = await voucherRepo.getVoucherWithDetails(pool, companyId, hint, voucherMasterId);
    if (found) return hint;
  }
  const byId = await voucherRepo.getVoucherWithDetailsById(pool, companyId, voucherMasterId);
  if (!byId) return null;
  return Number(byId.master.branch_id);
}

export async function listVouchers(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  let voucherTypeId = query.voucherTypeId ? Number(query.voucherTypeId) : undefined;
  if (!voucherTypeId && query.voucherTypeCode) {
    voucherTypeId = await voucherRepo.getVoucherTypeIdByCode(pool, companyId, String(query.voucherTypeCode).trim());
  }
  const branchId = parseOptionalBranchId(query.branchId);
  return voucherRepo.listVouchers(pool, companyId, {
    branchId,
    voucherTypeId,
    postStatus: query.postStatus || undefined,
    dateFrom: query.dateFrom || undefined,
    dateTo: query.dateTo || undefined,
    page: query.page ? Number(query.page) : 1,
    pageSize: query.pageSize ? Math.min(Number(query.pageSize), 100) : 20,
  });
}

export async function getVoucher(pool, authStaff, voucherMasterId) {
  const companyId = Number(authStaff.company_id);
  const branchId = authStaff.branch_id != null ? Number(authStaff.branch_id) : null;
  let data = null;
  if (branchId) {
    data = await voucherRepo.getVoucherWithDetails(pool, companyId, branchId, voucherMasterId);
  }
  if (!data) {
    data = await voucherRepo.getVoucherWithDetailsById(pool, companyId, voucherMasterId);
  }
  if (!data) {
    const err = new Error('Voucher not found');
    err.status = 404;
    throw err;
  }
  return data;
}

export async function createVoucher(pool, authStaff, body) {
  const { companyId, branchId } = resolveCompanyBranch(authStaff, body);
  const { voucherTypeId, referenceNo, remarks, voucherDate, lines } = body;

  if (!voucherTypeId) {
    const err = new Error('voucherTypeId is required');
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    const err = new Error('At least one line is required');
    err.status = 400;
    throw err;
  }

  let totalDebit = 0, totalCredit = 0;
  for (const line of lines) {
    const dr = Number(line.debitAmount || 0);
    const cr = Number(line.creditAmount || 0);
    if (dr < 0 || cr < 0) {
      const err = new Error('Amounts cannot be negative');
      err.status = 400;
      throw err;
    }
    if (dr === 0 && cr === 0) {
      const err = new Error('Each line must have a debit or credit amount');
      err.status = 400;
      throw err;
    }
    totalDebit += dr;
    totalCredit += cr;
  }

  const diff = Math.abs(totalDebit - totalCredit);
  if (diff > 0.01) {
    const err = new Error(`Debit (${totalDebit.toFixed(2)}) and Credit (${totalCredit.toFixed(2)}) must balance`);
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    const voucherMasterId = await voucherRepo.nextVoucherMasterId(client, companyId, branchId);
    const autoVoucherNo = await voucherRepo.nextAutoVoucherNo(client, companyId, branchId, voucherTypeId);
    const prefix = await voucherRepo.getVoucherPrefix(client, companyId, voucherTypeId);
    const createdBy = authStaff.staff_name || authStaff.user_name || 'system';

    await voucherRepo.insertVoucherMaster(client, {
      companyId, branchId, voucherMasterId, voucherTypeId,
      autoVoucherNo, voucherPrefix: prefix,
      voucherDate: voucherDate || new Date(),
      referenceNo: referenceNo || null,
      voucherAmount: totalDebit,
      remarks: remarks || null,
      postStatus: 'PENDING',
      creationMode: 'MANUAL',
      voucherPostedId: 0,
      counterCloseNo: 0,
      recordStatus: 'ACTIVE',
      createdBy,
    });

    let detailIdBase = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);
    for (const line of lines) {
      await voucherRepo.insertVoucherDetail(client, {
        companyId, branchId,
        voucherDetailId: detailIdBase++,
        voucherMasterId,
        accountId: Number(line.accountId),
        debitAmount: Number(line.debitAmount || 0),
        creditAmount: Number(line.creditAmount || 0),
        outstandingBalance: 0,
        narration: line.narration || null,
        postStatus: 'PENDING',
        recordStatus: 'ACTIVE',
        createdBy,
      });
    }

    return {
      voucherMasterId,
      autoVoucherNo,
      voucherPrefix: prefix,
      voucherNo: `${prefix}${autoVoucherNo}`,
      voucherAmount: totalDebit,
    };
  });
}

export async function updateVoucher(pool, authStaff, voucherMasterId, body) {
  const companyId = Number(authStaff.company_id);
  const branchId = await resolveVoucherBranch(
    pool, companyId, voucherMasterId, body?.branchId ?? authStaff.branch_id,
  );
  if (!branchId) {
    const err = new Error('Voucher not found');
    err.status = 404;
    throw err;
  }
  const existing = await voucherRepo.getVoucherWithDetails(pool, companyId, branchId, voucherMasterId);
  if (!existing) {
    const err = new Error('Voucher not found');
    err.status = 404;
    throw err;
  }
  if (existing.master.post_status === 'POSTED') {
    const err = new Error('Cannot edit a posted voucher. Unpost it first.');
    err.status = 409;
    throw err;
  }

  const { lines, referenceNo, remarks, voucherDate } = body;

  return withTransaction(async (client) => {
    if (referenceNo !== undefined || remarks !== undefined || voucherDate !== undefined) {
      const sets = [];
      const params = [companyId, branchId, voucherMasterId];
      let idx = 4;
      if (referenceNo !== undefined) { sets.push(`reference_no = $${idx++}`); params.push(referenceNo); }
      if (remarks !== undefined) { sets.push(`remarks = $${idx++}`); params.push(remarks); }
      if (voucherDate !== undefined) { sets.push(`voucher_date = $${idx++}`); params.push(voucherDate); }
      sets.push('modified_at = NOW()');
      if (sets.length > 1) {
        await client.query(
          `UPDATE accounts.voucher_master SET ${sets.join(', ')}
           WHERE company_id = $1 AND branch_id = $2 AND voucher_master_id = $3`,
          params
        );
      }
    }

    if (Array.isArray(lines) && lines.length > 0) {
      let totalDebit = 0, totalCredit = 0;
      for (const l of lines) {
        totalDebit += Number(l.debitAmount || 0);
        totalCredit += Number(l.creditAmount || 0);
      }
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        const err = new Error('Debit and Credit must balance');
        err.status = 400;
        throw err;
      }

      await voucherRepo.deleteVoucherDetails(client, companyId, branchId, voucherMasterId);
      const createdBy = authStaff.staff_name || authStaff.user_name || 'system';
      let detailIdBase = await voucherRepo.nextVoucherDetailId(client, companyId, branchId);
      for (const line of lines) {
        await voucherRepo.insertVoucherDetail(client, {
          companyId, branchId,
          voucherDetailId: detailIdBase++,
          voucherMasterId,
          accountId: Number(line.accountId),
          debitAmount: Number(line.debitAmount || 0),
          creditAmount: Number(line.creditAmount || 0),
          outstandingBalance: 0,
          narration: line.narration || null,
          postStatus: existing.master.post_status,
          recordStatus: 'ACTIVE',
          createdBy,
        });
      }

      await client.query(
        `UPDATE accounts.voucher_master SET voucher_amount = $4, modified_at = NOW()
         WHERE company_id = $1 AND branch_id = $2 AND voucher_master_id = $3`,
        [companyId, branchId, voucherMasterId, totalDebit]
      );
    }

    return { voucherMasterId, updated: true };
  });
}

export async function postVoucher(pool, authStaff, voucherMasterId) {
  const companyId = Number(authStaff.company_id);
  const branchId = await resolveVoucherBranch(pool, companyId, voucherMasterId, authStaff.branch_id);
  if (!branchId) {
    const err = new Error('Voucher not found');
    err.status = 404;
    throw err;
  }
  return withTransaction(async (client) => {
    await voucherRepo.updateVoucherPostStatus(client, companyId, branchId, voucherMasterId, 'POSTED');
    return { voucherMasterId, postStatus: 'POSTED' };
  });
}

export async function unpostVoucher(pool, authStaff, voucherMasterId) {
  const companyId = Number(authStaff.company_id);
  const branchId = await resolveVoucherBranch(pool, companyId, voucherMasterId, authStaff.branch_id);
  if (!branchId) {
    const err = new Error('Voucher not found');
    err.status = 404;
    throw err;
  }
  const existing = await voucherRepo.getVoucherWithDetails(pool, companyId, branchId, voucherMasterId);
  if (!existing) {
    const err = new Error('Voucher not found');
    err.status = 404;
    throw err;
  }
  return withTransaction(async (client) => {
    let purchaseOutstandingRestored = false;
    const restore = await tryRestorePurchaseOutstandingForVoucher(
      client, companyId, branchId, existing.master, existing.details,
    );
    purchaseOutstandingRestored = Boolean(restore.restored);
    await voucherRepo.updateVoucherPostStatus(client, companyId, branchId, voucherMasterId, 'PENDING');
    return { voucherMasterId, postStatus: 'PENDING', purchaseOutstandingRestored };
  });
}

export async function deleteVoucher(pool, authStaff, voucherMasterId) {
  const companyId = Number(authStaff.company_id);
  const branchId = await resolveVoucherBranch(pool, companyId, voucherMasterId, authStaff.branch_id);
  if (!branchId) {
    const err = new Error('Voucher not found');
    err.status = 404;
    throw err;
  }
  const existing = await voucherRepo.getVoucherWithDetails(pool, companyId, branchId, voucherMasterId);
  if (!existing) {
    const err = new Error('Voucher not found');
    err.status = 404;
    throw err;
  }

  const { paymentVoucherTypeId } = await resolvePurchasePaymentVoucherTypeIds(pool, companyId, branchId);
  const isPurchasePayment = isInventoryPurchasePaymentVoucher(existing.master, paymentVoucherTypeId);

  if (existing.master.post_status === 'POSTED' && !isPurchasePayment) {
    const err = new Error('Cannot delete a posted voucher. Unpost first.');
    err.status = 409;
    throw err;
  }

  return withTransaction(async (client) => {
    let purchaseOutstandingRestored = false;
    if (isPurchasePayment) {
      const restore = await tryRestorePurchaseOutstandingForVoucher(
        client, companyId, branchId, existing.master, existing.details,
      );
      purchaseOutstandingRestored = Boolean(restore.restored);
    }
    await voucherRepo.softDeleteVoucher(client, companyId, branchId, voucherMasterId);
    return { deleted: true, purchaseOutstandingRestored };
  });
}

export async function listVoucherTypes(pool, authStaff) {
  const companyId = Number(authStaff.company_id);
  const rows = await voucherRepo.listVoucherTypes(pool, companyId);
  return {
    voucherTypes: rows.map((r) => ({
      voucherTypeId: Number(r.voucher_type_id),
      voucherTypeCode: r.voucher_type_code,
      voucherName: r.voucher_name,
      voucherPrefix: r.voucher_prefix,
    })),
  };
}

export async function getLedgerTransactions(pool, authStaff, accountId, query) {
  const companyId = Number(authStaff.company_id);
  const account = await accountHeadRepo.findAccountHead(pool, companyId, accountId);
  if (!account) {
    const err = new Error('Account not found');
    err.status = 404;
    throw err;
  }

  const accountIds = await accountHeadRepo.listDescendantAccountIds(pool, companyId, accountId);
  const childIds = accountIds.filter((id) => id !== accountId);
  const childHeads = childIds.length
    ? await accountHeadRepo.listAccountHeadsByIds(pool, companyId, childIds)
    : [];

  const data = await voucherRepo.getLedgerTransactions(pool, companyId, accountIds, {
    branchId: parseOptionalBranchId(query.branchId),
    dateFrom: query.dateFrom || undefined,
    dateTo: query.dateTo || undefined,
    page: query.page ? Number(query.page) : 1,
    pageSize: query.pageSize ? Math.min(Number(query.pageSize), 500) : 30,
  });
  return {
    account: {
      accountId: Number(account.account_id),
      accountNo: account.account_no,
      accountHead: account.account_head,
    },
    includeChildren: childIds.length > 0,
    childAccounts: childHeads.map((h) => ({
      accountId: Number(h.account_id),
      accountNo: h.account_no,
      accountHead: h.account_head,
    })),
    accountScopeIds: accountIds,
    ...data,
  };
}

export async function getAgingSummary(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId = parseOptionalBranchId(query.branchId);
  const rows = await voucherRepo.getAgingSummary(pool, companyId, {
    branchId,
    summaryType: query.summaryType || 'receivable',
    postStatus: query.postStatus || undefined,
    dateFrom: query.dateFrom || undefined,
    dateTo: query.dateTo || undefined,
  });
  return {
    summaryType: query.summaryType || 'receivable',
    rows: rows.map((r) => ({
      accountId: Number(r.account_id),
      accountNo: r.account_no,
      accountHead: r.account_head,
      accountType: r.account_type,
      billCount: Number(r.bill_count),
      totalDebit: Number(r.total_debit),
      totalCredit: Number(r.total_credit),
      outstanding: Number(r.outstanding),
      lastBillDate: r.last_bill_date,
      age0_30: Number(r.age_0_30),
      age30_60: Number(r.age_30_60),
      age60_120: Number(r.age_60_120),
      age120Plus: Number(r.age_120_plus),
    })),
  };
}

export async function getTrialBalance(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const rows = await voucherRepo.getTrialBalance(pool, companyId, {
    branchId: parseOptionalBranchId(query.branchId),
    dateTo: query.dateTo || undefined,
  });
  let grandDebit = 0, grandCredit = 0;
  const accounts = rows.map((r) => {
    const dr = Number(r.total_debit);
    const cr = Number(r.total_credit);
    grandDebit += dr;
    grandCredit += cr;
    return {
      accountId: Number(r.account_id),
      accountNo: r.account_no,
      accountHead: r.account_head,
      accountType: r.account_type,
      totalDebit: dr,
      totalCredit: cr,
      balance: dr - cr,
    };
  });
  return { accounts, grandDebit, grandCredit };
}
