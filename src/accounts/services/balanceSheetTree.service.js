import * as trialBalanceRepo from '../repositories/trialBalance.repository.js';
import { getProfitAndLossTree } from './profitAndLossTree.service.js';
import { resolveReportBranchId } from '../utils/reportBranch.js';

const HISTORIC_FROM = '1900-01-01';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysIso(iso, days) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() + days);
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

/** Cumulative group balance with opening (legacy GroupBalanceSummaryWithOs_BS). */
function groupBalanceWithOs(accounts, movementMap, accountNoPrefix) {
  let dr = 0;
  let cr = 0;
  const prefix = String(accountNoPrefix || '');
  for (const acc of accounts) {
    if (!String(acc.accountNo || '').startsWith(prefix)) continue;
    const os = Number(acc.openingBalance || 0);
    if (os > 0) dr += os;
    else if (os < 0) cr += -os;
    if (!acc.postingAllowed) continue;
    const m = movementMap.get(acc.accountId);
    if (m) {
      dr += m.dr;
      cr += m.cr;
    }
  }
  return signedNet(dr, cr);
}

function ledgerBalanceWithOs(acc, movementMap) {
  let dr = 0;
  let cr = 0;
  const os = Number(acc.openingBalance || 0);
  if (os > 0) dr += os;
  else if (os < 0) cr += -os;
  const m = movementMap.get(acc.accountId);
  if (m) {
    dr += m.dr;
    cr += m.cr;
  }
  return signedNet(dr, cr);
}

function findGroupByAliases(accounts, ...aliases) {
  for (const aliasName of aliases) {
    const target = String(aliasName || '').trim().toUpperCase();
    const hit = accounts.find((a) => String(a.alias || '').toUpperCase() === target)
      || accounts.find((a) => String(a.accountHead || '').toUpperCase() === target);
    if (hit) return hit;
  }
  return null;
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
    });
    return id;
  };
  return { nodes, add };
}

function formatMoneyPlain(n) {
  return round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatVoucherLabel(row) {
  const d = row.voucher_date ? String(row.voucher_date).slice(0, 10) : '';
  const parts = d.split('-');
  const ddmmyyyy = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : d;
  const vNo = row.auto_voucher_no != null ? String(row.auto_voucher_no) : '';
  const head = row.counter_head || '';
  return [ddmmyyyy, vNo, head].filter(Boolean).join('  ');
}

/**
 * Legacy ACCBalanceSheetNew tree balance sheet.
 * Liabilities | Assets with P&L A/C and Diff. in Opening Balances.
 */
export async function getBalanceSheetTree(pool, authStaff, query) {
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

  const [cumulativeRows, stockValue] = await Promise.all([
    trialBalanceRepo.sumMovementsByAccount(pool, companyId, {
      branchId,
      dateFrom: HISTORIC_FROM,
      dateTo,
    }),
    trialBalanceRepo.sumStockValue(pool, companyId, branchId),
  ]);
  const cumulativeMap = movementMapFromRows(cumulativeRows);
  const closingStock = stockValue;

  const liability = createNodeFactory();
  const asset = createNodeFactory();
  const postingAccountIds = [];

  function addChildNodes(dtSide, groupAccNo, parentNodeId, isCurrentAssetsRoot) {
    const groupAcc = accounts.find((a) => a.accountNo === groupAccNo);
    if (!groupAcc) return;
    const children = childrenByParent.get(groupAcc.accountId) || [];

    for (const child of children) {
      if (isCurrentAssetsRoot && child.accountNo === '03-03') continue;

      let amt;
      if (!child.postingAllowed) {
        amt = groupBalanceWithOs(accounts, cumulativeMap, child.accountNo);
      } else {
        amt = ledgerBalanceWithOs(child, cumulativeMap);
      }
      if (Math.abs(amt) < 0.005) continue;

      const childId = dtSide.add(parentNodeId, {
        accountId: child.accountId,
        levelType: child.postingAllowed ? 'LEDGER' : 'GROUP',
        name: child.accountHead,
        amount: Math.abs(amt),
      });

      if (!child.postingAllowed) {
        addChildNodes(dtSide, child.accountNo, childId, false);
      } else {
        postingAccountIds.push(child.accountId);
      }
    }
  }

  function buildSideTree(dtSide, ...aliases) {
    const grp = findGroupByAliases(accounts, ...aliases);
    if (!grp) return null;

    let groupBal = groupBalanceWithOs(accounts, cumulativeMap, grp.accountNo);
    const isCurrentAssets = String(aliases[0] || '').trim().toUpperCase() === 'CURRENT ASSETS';
    let stockAdded = 0;
    if (isCurrentAssets && Math.abs(closingStock) > 0.005) {
      stockAdded = closingStock;
      groupBal += closingStock;
    }
    if (Math.abs(groupBal) < 0.005) return null;

    const rootId = dtSide.add(0, {
      accountId: grp.accountId,
      levelType: 'GROUP',
      name: aliases[0],
      amount: Math.abs(groupBal),
    });

    addChildNodes(dtSide, grp.accountNo, rootId, isCurrentAssets);

    if (Math.abs(stockAdded) > 0.005) {
      dtSide.add(rootId, {
        accountId: -99,
        levelType: 'LEDGER',
        name: 'Closing Stock',
        amount: Math.abs(stockAdded),
      });
    }
    return rootId;
  }

  // Liabilities
  buildSideTree(liability, 'CURRENT LIABILITIES', 'CURRENT LIABILTIES');
  buildSideTree(liability, 'BRANCHES/DIVISIONS');
  buildSideTree(liability, 'CAPITAL ACCOUNT');
  buildSideTree(liability, 'LOANS');

  // Assets
  buildSideTree(asset, 'CURRENT ASSETS');
  buildSideTree(asset, 'FIXED ASSETS');
  buildSideTree(asset, 'INVESTMENTS');

  // P&L opening + current (legacy)
  let plOpening = 0;
  let plCurrent = 0;
  try {
    const dayBeforeFrom = addDaysIso(dateFrom, -1);
    const [opPl, curPl] = await Promise.all([
      getProfitAndLossTree(pool, authStaff, {
        branchId: branchId != null ? String(branchId) : '',
        allBranches: branchId == null ? '1' : undefined,
        dateFrom: HISTORIC_FROM,
        dateTo: dayBeforeFrom,
      }),
      getProfitAndLossTree(pool, authStaff, {
        branchId: branchId != null ? String(branchId) : '',
        allBranches: branchId == null ? '1' : undefined,
        dateFrom,
        dateTo,
      }),
    ]);
    plOpening = Number(opPl.netProfit || 0);
    plCurrent = Number(curPl.netProfit || 0);
  } catch {
    plOpening = 0;
    plCurrent = 0;
  }

  const plTotal = round2(plOpening + plCurrent);
  if (Math.abs(plTotal) > 0.005) {
    const side = plTotal > 0 ? liability : asset;
    const rootId = side.add(0, {
      accountId: -98,
      levelType: 'GROUP',
      name: 'Profit And Loss A/C',
      amount: Math.abs(plTotal),
    });
    side.add(rootId, {
      accountId: -98,
      levelType: 'INFO',
      name: `Opening Balance    ${formatMoneyPlain(plOpening)}`,
      amount: 0,
    });
    side.add(rootId, {
      accountId: -98,
      levelType: 'INFO',
      name: `Current Period     ${formatMoneyPlain(plCurrent)}`,
      amount: 0,
    });
  }

  const sumRootGroups = (nodes) => nodes
    .filter((n) => (n.parentId || 0) === 0 && n.levelType === 'GROUP')
    .reduce((s, n) => s + (Number(n.amount) || 0), 0);

  let liabTotal = sumRootGroups(liability.nodes);
  let assetTotal = sumRootGroups(asset.nodes);
  const diff = round2(assetTotal - liabTotal);

  if (Math.abs(diff) > 0.005) {
    if (diff > 0) {
      liability.add(0, {
        accountId: -97,
        levelType: 'GROUP',
        name: 'Diff. in Opening Balances',
        amount: Math.abs(diff),
      });
      liabTotal += Math.abs(diff);
    } else {
      asset.add(0, {
        accountId: -97,
        levelType: 'GROUP',
        name: 'Diff. in Opening Balances',
        amount: Math.abs(diff),
      });
      assetTotal += Math.abs(diff);
    }
  }

  // Voucher drill-down under posting ledgers (period dateFrom–dateTo)
  if (postingAccountIds.length) {
    const voucherLines = await trialBalanceRepo.listLedgerVoucherLines(pool, companyId, {
      branchId,
      dateFrom,
      dateTo,
      accountIds: [...new Set(postingAccountIds)],
    });

    const attachVouchers = (side) => {
      const ledgerByAccount = new Map();
      for (const n of side.nodes) {
        if (n.levelType === 'LEDGER' && n.accountId > 0) {
          ledgerByAccount.set(n.accountId, n.id);
        }
      }
      for (const row of voucherLines) {
        const parentId = ledgerByAccount.get(Number(row.account_id));
        if (!parentId) continue;
        const dr = Number(row.debit_amount || 0);
        const cr = Number(row.credit_amount || 0);
        const amt = Math.abs(dr - cr) > 0.005 ? Math.abs(dr - cr) : Math.max(dr, cr);
        if (amt <= 0.005) continue;
        side.add(parentId, {
          accountId: Number(row.voucher_master_id) || 0,
          levelType: 'VOUCHER',
          name: formatVoucherLabel(row),
          amount: amt,
        });
      }
    };
    attachVouchers(liability);
    attachVouchers(asset);
  }

  return {
    dateFrom,
    dateTo,
    branchId: branchId || null,
    liabilityNodes: liability.nodes,
    assetNodes: asset.nodes,
    totalLiabilities: round2(liabTotal),
    totalAssets: round2(assetTotal),
    difference: round2(assetTotal - liabTotal),
    plOpening: round2(plOpening),
    plCurrent: round2(plCurrent),
    netProfitLoss: plTotal,
    closingStock: round2(closingStock),
  };
}
