import * as trialBalanceRepo from '../repositories/trialBalance.repository.js';
import { resolveReportBranchId } from '../utils/reportBranch.js';

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
    alias: String(r.alias || r.account_head || '').trim(),
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

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function signedNet(dr, cr) {
  const d = Number(dr) || 0;
  const c = Number(cr) || 0;
  if (d > c) return d - c;
  if (c > d) return -(c - d);
  return 0;
}

/** Period group balance (legacy GroupBalanceSummaryWithOs1 — opening bal unused). */
function groupPeriodBalance(accounts, periodMap, accountNoPrefix) {
  let dr = 0;
  let cr = 0;
  const prefix = String(accountNoPrefix || '');
  for (const acc of accounts) {
    if (!acc.postingAllowed) continue;
    if (!String(acc.accountNo || '').startsWith(prefix)) continue;
    const m = periodMap.get(acc.accountId);
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

function findGroupByAlias(accounts, aliasName) {
  const target = String(aliasName || '').trim().toUpperCase();
  return accounts.find((a) => String(a.alias || '').toUpperCase() === target)
    || accounts.find((a) => String(a.accountHead || '').toUpperCase() === target)
    || null;
}

function createNodeFactory() {
  let nextId = 1;
  const nodes = [];
  const add = (parentId, payload) => {
    const id = nextId++;
    nodes.push({
      id,
      parentId: parentId || 0,
      accountId: payload.accountId != null ? Number(payload.accountId) : 0,
      levelType: payload.levelType,
      name: payload.name,
      amount: round2(payload.amount),
      caluNo: Number(payload.caluNo) || 0,
    });
    return id;
  };
  return { nodes, add };
}

function appendChildren(accounts, childrenByParent, periodMap, side, parentNodeId, groupAccountId, depthRemaining) {
  if (depthRemaining <= 0 || !groupAccountId) return;
  const children = childrenByParent.get(groupAccountId) || [];
  for (const child of children) {
    if (child.postingAllowed) {
      const amt = ledgerPeriodBalance(child.accountId, periodMap);
      if (Math.abs(amt) < 0.005) continue;
      side.add(parentNodeId, {
        accountId: child.accountId,
        levelType: 'LEDGER',
        name: child.accountHead,
        amount: Math.abs(amt),
        caluNo: 1,
      });
    } else {
      const subAmt = groupPeriodBalance(accounts, periodMap, child.accountNo);
      if (Math.abs(subAmt) < 0.005) continue;
      const subId = side.add(parentNodeId, {
        accountId: child.accountId,
        levelType: 'GROUP',
        name: child.accountHead,
        amount: Math.abs(subAmt),
        caluNo: 1,
      });
      appendChildren(accounts, childrenByParent, periodMap, side, subId, child.accountId, depthRemaining - 1);
    }
  }
}

function rollupGroups(nodes) {
  const childrenByParent = new Map();
  for (const n of nodes) {
    const pid = n.parentId || 0;
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid).push(n);
  }
  const sumSubtree = (parentId) => {
    let total = 0;
    for (const c of childrenByParent.get(parentId) || []) {
      if (c.levelType === 'GROUP') total += sumSubtree(c.id);
      else total += Number(c.amount) || 0;
    }
    return total;
  };
  for (const n of nodes) {
    if (n.levelType !== 'GROUP') continue;
    const kids = childrenByParent.get(n.id) || [];
    if (!kids.length) continue;
    n.amount = round2(sumSubtree(n.id));
  }
}

/**
 * Legacy ACCProfitAndLossFrmNew tree P&L.
 * Expense tree (Dr) | Income tree (Cr) with Opening/Closing stock, Gross, Nett.
 */
export async function getProfitAndLossTree(pool, authStaff, query) {
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

  const [periodRows, stockValue] = await Promise.all([
    trialBalanceRepo.sumMovementsByAccount(pool, companyId, { branchId, dateFrom, dateTo }),
    trialBalanceRepo.sumStockValue(pool, companyId, branchId),
  ]);
  const periodMap = movementMapFromRows(periodRows);

  // Proxy: current stock as both opening & closing (same limitation as TB)
  const openingStock = stockValue;
  const closingStock = stockValue;

  const expense = createNodeFactory();
  const income = createNodeFactory();

  // Opening stock
  if (openingStock > 0.005) {
    expense.add(0, { accountId: -99, levelType: 'INFO', name: 'Opening Stock', amount: openingStock, caluNo: 1 });
  } else if (openingStock < -0.005) {
    income.add(0, { accountId: -99, levelType: 'INFO', name: 'Opening Stock', amount: -openingStock, caluNo: 1 });
  }

  /** Legacy AccounHeadAmountDisplay: signed > 0 → Dr, else → Cr. */
  const addNamedGroup = (aliasName, caluNo) => {
    const grp = findGroupByAlias(accounts, aliasName);
    if (!grp) return null;
    const signed = groupPeriodBalance(accounts, periodMap, grp.accountNo);
    if (Math.abs(signed) < 0.005) return null;

    const side = signed > 0 ? expense : income;
    const amount = Math.abs(signed);
    const nodeId = side.add(0, {
      accountId: grp.accountId,
      levelType: 'GROUP',
      name: grp.alias || grp.accountHead || aliasName,
      amount,
      caluNo,
    });
    appendChildren(accounts, childrenByParent, periodMap, side, nodeId, grp.accountId, 12);
    return { side, nodeId, amount, signed };
  };

  addNamedGroup('PURCHASE ACCOUNTS', 1);
  addNamedGroup('SALES ACCOUNTS', 1);

  // Closing stock
  if (closingStock < -0.005) {
    expense.add(0, { accountId: -99, levelType: 'INFO', name: 'Closing Stock', amount: -closingStock, caluNo: 1 });
  } else if (closingStock > 0.005) {
    income.add(0, { accountId: -99, levelType: 'INFO', name: 'Closing Stock', amount: closingStock, caluNo: 1 });
  }

  const sumCalu = (nodes, caluNos) => nodes
    .filter((n) => (n.parentId || 0) === 0 && caluNos.includes(n.caluNo))
    .reduce((s, n) => s + (Number(n.amount) || 0), 0);

  let drTot = sumCalu(expense.nodes, [1]);
  let crTot = sumCalu(income.nodes, [1]);

  let grossProfit = 0;
  let grossLoss = 0;
  if (drTot < crTot) {
    grossProfit = crTot - drTot;
    expense.add(0, { accountId: 0, levelType: 'INFO', name: 'Gross Profit c/o', amount: grossProfit, caluNo: 2 });
  } else if (drTot > crTot) {
    grossLoss = drTot - crTot;
    income.add(0, { accountId: 0, levelType: 'INFO', name: 'Gross Loss c/o', amount: grossLoss, caluNo: 2 });
  } else {
    expense.add(0, { accountId: 0, levelType: 'INFO', name: 'Gross Profit c/o', amount: 0, caluNo: 2 });
  }

  if (grossLoss > 0.005) {
    expense.add(0, { accountId: 0, levelType: 'INFO', name: 'Gross Loss b/f', amount: grossLoss, caluNo: 3 });
  } else if (grossProfit > 0.005) {
    income.add(0, { accountId: 0, levelType: 'INFO', name: 'Gross Profit b/f', amount: grossProfit, caluNo: 3 });
  }

  addNamedGroup('DIRECT INCOMES', 3);
  addNamedGroup('INDIRECT INCOMES', 3);
  addNamedGroup('DIRECT EXPENSES', 3);
  addNamedGroup('INDIRECT EXPENSES', 3);

  drTot = sumCalu(expense.nodes, [3]);
  crTot = sumCalu(income.nodes, [3]);

  let netProfit = 0;
  let netLoss = 0;
  if (drTot < crTot) {
    netProfit = crTot - drTot;
    expense.add(0, { accountId: 0, levelType: 'INFO', name: 'Nett Profit', amount: netProfit, caluNo: 4 });
  } else if (drTot > crTot) {
    netLoss = drTot - crTot;
    income.add(0, { accountId: 0, levelType: 'INFO', name: 'Nett Loss', amount: netLoss, caluNo: 4 });
  } else {
    expense.add(0, { accountId: 0, levelType: 'INFO', name: 'Nett Profit', amount: 0, caluNo: 4 });
  }

  rollupGroups(expense.nodes);
  rollupGroups(income.nodes);

  const totalDebit = sumCalu(expense.nodes, [3, 4]);
  const totalCredit = sumCalu(income.nodes, [3, 4]);

  return {
    dateFrom,
    dateTo,
    branchId: branchId || null,
    expenseNodes: expense.nodes,
    incomeNodes: income.nodes,
    totalDebit: round2(totalDebit),
    totalCredit: round2(totalCredit),
    grossProfit: round2(grossProfit || -grossLoss),
    netProfit: round2(netProfit || -netLoss),
    openingStock: round2(openingStock),
    closingStock: round2(closingStock),
  };
}
