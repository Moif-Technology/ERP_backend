import * as trialBalanceRepo from '../repositories/trialBalance.repository.js';
import { getProfitAndLoss } from './financialReport.service.js';
import { resolveReportBranchId } from '../utils/reportBranch.js';

const HISTORIC_FROM = '1900-01-01';
const INCOME_EXPENSE_GROUP_TYPES = new Set(['Income', 'Expenses']);

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mapAccount(r) {
  const postingRaw = r.posting_allowed;
  const postingAllowed = postingRaw === true
    || postingRaw === 1
    || String(postingRaw).toLowerCase() === 'true'
    || String(postingRaw) === '1';
  return {
    accountId: Number(r.account_id),
    parentAccId: r.parent_acc_id != null ? Number(r.parent_acc_id) : null,
    accountNo: r.account_no,
    accountHead: r.account_head,
    alias: r.alias || r.account_head,
    accountType: r.account_type || '',
    groupType: r.group_type || '',
    levelNo: Number(r.level_no || 0),
    displayOrder: Number(r.display_order || 0),
    postingAllowed,
    openingBalance: Number(r.opening_balance || 0),
  };
}

function movementMapFromRows(rows) {
  const map = new Map();
  for (const r of rows) {
    map.set(Number(r.account_id), {
      dr: Number(r.total_debit || 0),
      cr: Number(r.total_credit || 0),
    });
  }
  return map;
}

function signedNet(dr, cr) {
  const d = Number(dr) || 0;
  const c = Number(cr) || 0;
  if (d > c) return d - c;
  if (c > d) return -(c - d);
  return 0;
}

function splitDrCr(signedAmount) {
  const amt = Number(signedAmount) || 0;
  if (Math.abs(amt) < 0.005) return { dr: 0, cr: 0 };
  if (amt > 0) return { dr: amt, cr: 0 };
  return { dr: 0, cr: -amt };
}

function groupBalanceSummary(accounts, movementMap, accountNoPrefix, { includeOpening }) {
  let dr = 0;
  let cr = 0;
  const prefix = String(accountNoPrefix || '');
  for (const acc of accounts) {
    if (!String(acc.accountNo || '').startsWith(prefix)) continue;
    if (includeOpening) {
      const os = Number(acc.openingBalance || 0);
      if (os > 0) dr += os;
      else if (os < 0) cr += -os;
    }
    const m = movementMap.get(acc.accountId);
    if (m) {
      dr += m.dr;
      cr += m.cr;
    }
  }
  return signedNet(dr, cr);
}

function ledgerPeriodBalance(accountId, periodMap) {
  const m = periodMap.get(accountId) || { dr: 0, cr: 0 };
  return signedNet(m.dr, m.cr);
}

function formatVoucherLabel(row) {
  const d = row.voucher_date ? String(row.voucher_date).slice(0, 10) : '';
  const parts = d.split('-');
  const ddmmyyyy = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : d;
  const vNo = row.auto_voucher_no != null
    ? String(row.auto_voucher_no)
    : '';
  const head = row.counter_head || '';
  return [ddmmyyyy, vNo, head].filter(Boolean).join('  ');
}

export async function getTrialBalanceTree(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId = resolveReportBranchId(query, authStaff);
  const dateFrom = query.dateFrom || todayIso();
  const dateTo = query.dateTo || dateFrom;

  const accounts = (await trialBalanceRepo.listChartAccounts(pool, companyId)).map(mapAccount);
  const childrenByParent = new Map();
  for (const acc of accounts) {
    const pid = acc.parentAccId ?? 0;
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid).push(acc);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => String(a.accountNo).localeCompare(String(b.accountNo), undefined, { numeric: true }));
  }

  const topGroups = accounts
    .filter((a) => a.levelNo === 1)
    .sort((a, b) => a.displayOrder - b.displayOrder || String(a.accountNo).localeCompare(String(b.accountNo), undefined, { numeric: true }));

  const [periodRows, cumulativeRows, stockValue] = await Promise.all([
    trialBalanceRepo.sumMovementsByAccount(pool, companyId, { branchId, dateFrom, dateTo }),
    trialBalanceRepo.sumMovementsByAccount(pool, companyId, { branchId, dateFrom: HISTORIC_FROM, dateTo }),
    trialBalanceRepo.sumStockValue(pool, companyId, branchId),
  ]);

  const periodMap = movementMapFromRows(periodRows);
  const cumulativeMap = movementMapFromRows(cumulativeRows);

  let openingStock = stockValue;
  if (Math.abs(openingStock) < 0.005) openingStock = stockValue;

  const nodes = [];
  let nextId = 1;
  const addNode = (parentId, payload) => {
    const id = nextId++;
    nodes.push({
      id,
      parentId: parentId || 0,
      accountKey: payload.accountKey || '',
      levelType: payload.levelType,
      name: payload.name,
      debitAmount: payload.debitAmount || 0,
      creditAmount: payload.creditAmount || 0,
      calcFlag: payload.calcFlag ? 1 : 0,
    });
    return id;
  };

  if (openingStock > 0.005) {
    const { dr, cr } = splitDrCr(openingStock);
    addNode(0, {
      accountKey: '-99',
      levelType: 'OS',
      name: 'Opening Stock',
      debitAmount: dr,
      creditAmount: cr,
      calcFlag: true,
    });
  } else if (openingStock < -0.005) {
    const { dr, cr } = splitDrCr(openingStock);
    addNode(0, {
      accountKey: '-99',
      levelType: 'OS',
      name: 'Opening Stock',
      debitAmount: dr,
      creditAmount: cr,
      calcFlag: true,
    });
  }

  const postingAccountIds = [];

  function addChildLedgers(groupAccNo, groupType, parentNodeId) {
    const groupAcc = accounts.find((a) => a.accountNo === groupAccNo);
    if (!groupAcc) return;

    const children = childrenByParent.get(groupAcc.accountId) || [];
    const isIncomeExpense = INCOME_EXPENSE_GROUP_TYPES.has(groupType);
    const movementMap = isIncomeExpense ? periodMap : cumulativeMap;

    for (const child of children) {
      let amt;
      if (!child.postingAllowed) {
        amt = groupBalanceSummary(accounts, movementMap, child.accountNo, { includeOpening: true });
      } else {
        amt = ledgerPeriodBalance(child.accountId, periodMap);
      }
      if (Math.abs(amt) < 0.005) continue;

      const { dr, cr } = splitDrCr(amt);
      const nodeId = addNode(parentNodeId, {
        accountKey: String(child.accountId),
        levelType: child.postingAllowed ? 'LEDGER' : 'GROUP',
        name: child.accountHead,
        debitAmount: dr,
        creditAmount: cr,
        calcFlag: false,
      });

      if (!child.postingAllowed) {
        addChildLedgers(child.accountNo, groupType, nodeId);
      } else if (!(groupAccNo === '03' && child.accountNo === '03-03')) {
        postingAccountIds.push(child.accountId);
      }
    }

    if (groupAccNo === '03' && Math.abs(stockValue) > 0.005) {
      const stockAcc = accounts.find((a) => a.accountNo === '03-03');
      if (stockAcc) {
        const { dr, cr } = splitDrCr(stockValue);
        addNode(parentNodeId, {
          accountKey: String(stockAcc.accountId),
          levelType: 'LEDGER',
          name: stockAcc.accountHead,
          debitAmount: dr,
          creditAmount: cr,
          calcFlag: false,
        });
      }
    }
  }

  for (const grp of topGroups) {
    const groupType = grp.groupType || '';
    const isIncomeExpense = INCOME_EXPENSE_GROUP_TYPES.has(groupType);
    const movementMap = isIncomeExpense ? periodMap : cumulativeMap;
    let groupAmount = groupBalanceSummary(accounts, movementMap, grp.accountNo, { includeOpening: true });

    if (String(grp.alias || grp.accountHead).trim().toUpperCase() === 'CURRENT ASSETS') {
      groupAmount += stockValue;
    }

    if (Math.abs(groupAmount) < 0.005) continue;

    const { dr, cr } = splitDrCr(groupAmount);
    const groupNodeId = addNode(0, {
      accountKey: grp.accountNo,
      levelType: 'GROUP',
      name: grp.alias || grp.accountHead,
      debitAmount: dr,
      creditAmount: cr,
      calcFlag: true,
    });

    addChildLedgers(grp.accountNo, groupType, groupNodeId);
  }

  let drBeforePl = 0;
  let crBeforePl = 0;
  for (const n of nodes) {
    if (n.calcFlag === 1) {
      drBeforePl += n.debitAmount;
      crBeforePl += n.creditAmount;
    }
  }

  let plAmount = 0;
  try {
    const pl = await getProfitAndLoss(pool, authStaff, {
      branchId: branchId != null ? String(branchId) : '',
      allBranches: branchId == null ? '1' : undefined,
      dateFrom,
      dateTo,
      postStatus: query.postStatus || undefined,
    });
    plAmount = Math.abs(Number(pl.netProfit || 0));
  } catch {
    plAmount = Math.abs(drBeforePl - crBeforePl);
  }

  if (plAmount > 0.005) {
    if (crBeforePl > drBeforePl) {
      addNode(0, {
        accountKey: '-98',
        levelType: 'P&L',
        name: 'Profit And Loss A/C',
        debitAmount: plAmount,
        creditAmount: 0,
        calcFlag: true,
      });
    } else if (drBeforePl > crBeforePl) {
      addNode(0, {
        accountKey: '-98',
        levelType: 'P&L',
        name: 'Profit And Loss A/C',
        debitAmount: 0,
        creditAmount: plAmount,
        calcFlag: true,
      });
    }
  }

  let finalDr = 0;
  let finalCr = 0;
  for (const n of nodes) {
    if (n.calcFlag === 1) {
      finalDr += n.debitAmount;
      finalCr += n.creditAmount;
    }
  }

  const diff = Number((finalDr - finalCr).toFixed(2));
  if (Math.abs(diff) > 0.005) {
    const diffDr = diff > 0 ? 0 : -diff;
    const diffCr = diff > 0 ? diff : 0;
    addNode(0, {
      accountKey: '-97',
      levelType: 'DIFF',
      name: 'Diff. in Opening Balances',
      debitAmount: diffDr,
      creditAmount: diffCr,
      calcFlag: true,
    });
    finalDr += diffDr;
    finalCr += diffCr;
  }

  if (postingAccountIds.length) {
    const voucherLines = await trialBalanceRepo.listLedgerVoucherLines(pool, companyId, {
      branchId,
      dateFrom,
      dateTo,
      accountIds: [...new Set(postingAccountIds)],
    });
    const ledgerNodeByAccountId = new Map();
    for (const n of nodes) {
      if (n.levelType === 'LEDGER' && n.accountKey) {
        ledgerNodeByAccountId.set(Number(n.accountKey), n.id);
      }
    }
    for (const row of voucherLines) {
      const parentNodeId = ledgerNodeByAccountId.get(Number(row.account_id));
      if (!parentNodeId) continue;
      const dr = Number(row.debit_amount || 0);
      const cr = Number(row.credit_amount || 0);
      if (dr <= 0.005 && cr <= 0.005) continue;
      addNode(parentNodeId, {
        accountKey: String(row.voucher_master_id),
        levelType: 'VOUCHER',
        name: formatVoucherLabel(row),
        debitAmount: dr,
        creditAmount: cr,
        calcFlag: false,
      });
    }
  }

  let totalDebit = 0;
  let totalCredit = 0;
  for (const n of nodes) {
    if (n.calcFlag === 1) {
      totalDebit += n.debitAmount;
      totalCredit += n.creditAmount;
    }
  }

  return {
    dateFrom,
    dateTo,
    branchId: branchId || null,
    nodes,
    totalDebit,
    totalCredit,
    difference: Number((totalDebit - totalCredit).toFixed(2)),
  };
}
