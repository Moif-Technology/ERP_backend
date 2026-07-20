import * as financialReportRepo from '../repositories/financialReport.repository.js';
import { resolveReportBranchId } from '../utils/reportBranch.js';

const ASSET_ROOT_PREFIXES = ['03', '07', '10'];
const LIABILITY_ROOT_PREFIXES = ['01', '02', '04', '11'];
const TRADING_ROOT_PREFIXES = ['05', '06', '12', '13'];
const PL_ROOT_PREFIXES = ['08', '09'];

function mapBalanceRow(r) {
  const dr = Number(r.total_debit || 0);
  const cr = Number(r.total_credit || 0);
  return {
    accountId: Number(r.account_id),
    accountNo: r.account_no,
    accountHead: r.account_head,
    accountType: r.account_type || '',
    parentAccId: r.parent_acc_id != null ? Number(r.parent_acc_id) : null,
    postingAllowed: Boolean(Number(r.posting_allowed) === 1 || r.posting_allowed === true),
    levelNo: Number(r.level_no || 0),
    groupType: r.group_type || '',
    balanceType: r.account_balance_type || '',
    totalDebit: dr,
    totalCredit: cr,
    balance: dr - cr,
  };
}

function rootPrefix(account, byId) {
  let node = account;
  let guard = 0;
  while (node?.parentAccId && byId.has(node.parentAccId) && guard < 20) {
    node = byId.get(node.parentAccId);
    guard += 1;
  }
  const no = String(node?.accountNo || '');
  return no.length >= 2 ? no.slice(0, 2) : no;
}

function sideAmount(acc, side) {
  const net = acc.balance;
  if (side === 'asset') return net > 0.005 ? net : (net < -0.005 ? -net : 0);
  return net < -0.005 ? -net : (net > 0.005 ? net : 0);
}

function buildPostingRows(accounts, prefixes, side) {
  const byId = new Map(accounts.map((a) => [a.accountId, a]));
  const rows = [];
  for (const acc of accounts) {
    if (!acc.postingAllowed) continue;
    if (!prefixes.includes(rootPrefix(acc, byId))) continue;
    const amount = sideAmount(acc, side);
    if (amount <= 0.005) continue;
    rows.push({
      accountId: acc.accountId,
      accountNo: acc.accountNo,
      accountHead: acc.accountHead,
      level: acc.levelNo || 1,
      amount,
    });
  }
  rows.sort((a, b) => String(a.accountNo).localeCompare(String(b.accountNo), undefined, { numeric: true }));
  return rows;
}

function sumPlNet(accounts) {
  let income = 0;
  let expense = 0;
  for (const acc of accounts) {
    if (acc.accountType !== 'PL' || !acc.postingAllowed) continue;
    if (acc.balance < -0.005) income += -acc.balance;
    if (acc.balance > 0.005) expense += acc.balance;
  }
  return income - expense;
}

export async function getFullTrialBalance(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const branchId = resolveReportBranchId(query, authStaff);
  const rows = await financialReportRepo.getAccountBalances(pool, companyId, {
    branchId,
    dateFrom: query.dateFrom || undefined,
    dateTo: query.dateTo || undefined,
    postStatus: query.postStatus || undefined,
  });

  let grandDebit = 0;
  let grandCredit = 0;
  const accounts = rows.map((r) => {
    const mapped = mapBalanceRow(r);
    grandDebit += mapped.totalDebit;
    grandCredit += mapped.totalCredit;
    return mapped;
  });

  const includeZero = query.includeZero === 'true' || query.includeZero === '1';
  const filtered = includeZero
    ? accounts
    : accounts.filter((a) => a.totalDebit > 0.005 || a.totalCredit > 0.005);

  return { accounts: filtered, grandDebit, grandCredit };
}

export async function getBalanceSheet(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const opts = {
    branchId: resolveReportBranchId(query, authStaff),
    dateTo: query.dateTo || undefined,
    postStatus: query.postStatus || 'POSTED',
  };
  const rows = await financialReportRepo.getAccountBalances(pool, companyId, opts);
  const bsAccounts = rows.filter((r) => r.account_type === 'BS').map(mapBalanceRow);
  const plAccounts = rows.filter((r) => r.account_type === 'PL').map(mapBalanceRow);

  const assets = buildPostingRows(bsAccounts, ASSET_ROOT_PREFIXES, 'asset');
  const liabilities = buildPostingRows(bsAccounts, LIABILITY_ROOT_PREFIXES, 'liability');

  const netPl = sumPlNet(plAccounts);
  if (Math.abs(netPl) > 0.005) {
    liabilities.push({
      accountId: null,
      accountNo: '',
      accountHead: netPl >= 0 ? 'Profit & Loss A/c (Net Profit)' : 'Profit & Loss A/c (Net Loss)',
      level: 0,
      isProfitLoss: true,
      amount: Math.abs(netPl),
    });
  }

  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);

  return {
    asOfDate: opts.dateTo || null,
    assets,
    liabilities,
    totalAssets,
    totalLiabilities,
    netProfitLoss: netPl,
  };
}

export async function getProfitAndLoss(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const opts = {
    branchId: resolveReportBranchId(query, authStaff),
    dateFrom: query.dateFrom || undefined,
    dateTo: query.dateTo || undefined,
    postStatus: query.postStatus || 'POSTED',
  };
  const rows = await financialReportRepo.getAccountBalances(pool, companyId, opts);
  const plAccounts = rows.filter((r) => r.account_type === 'PL').map(mapBalanceRow);
  const byId = new Map(plAccounts.map((a) => [a.accountId, a]));

  const buildSection = (prefixes) => {
    const items = [];
    for (const acc of plAccounts) {
      if (!acc.postingAllowed) continue;
      if (!prefixes.includes(rootPrefix(acc, byId))) continue;
      const expense = acc.balance > 0.005 ? acc.balance : 0;
      const income = acc.balance < -0.005 ? -acc.balance : 0;
      if (expense <= 0.005 && income <= 0.005) continue;
      items.push({
        accountId: acc.accountId,
        accountNo: acc.accountNo,
        accountHead: acc.accountHead,
        debit: expense,
        credit: income,
        amount: income > 0 ? income : expense,
        side: income > 0 ? 'income' : 'expense',
      });
    }
    items.sort((a, b) => String(a.accountNo).localeCompare(String(b.accountNo), undefined, { numeric: true }));
    return items;
  };

  const tradingExpenses = buildSection(TRADING_ROOT_PREFIXES).filter((i) => i.side === 'expense');
  const tradingIncome = buildSection(TRADING_ROOT_PREFIXES).filter((i) => i.side === 'income');
  const plExpenses = buildSection(PL_ROOT_PREFIXES).filter((i) => i.side === 'expense');
  const plIncome = buildSection(PL_ROOT_PREFIXES).filter((i) => i.side === 'income');

  const totalTradingExpenses = tradingExpenses.reduce((s, r) => s + r.amount, 0);
  const totalTradingIncome = tradingIncome.reduce((s, r) => s + r.amount, 0);
  const grossProfit = totalTradingIncome - totalTradingExpenses;

  const totalPlExpenses = plExpenses.reduce((s, r) => s + r.amount, 0);
  const totalPlIncome = plIncome.reduce((s, r) => s + r.amount, 0);
  const netProfit = grossProfit + totalPlIncome - totalPlExpenses;

  return {
    dateFrom: opts.dateFrom || null,
    dateTo: opts.dateTo || null,
    trading: {
      expenses: tradingExpenses,
      income: tradingIncome,
      totalExpenses: totalTradingExpenses,
      totalIncome: totalTradingIncome,
      grossProfit,
    },
    profitLoss: {
      expenses: plExpenses,
      income: plIncome,
      totalExpenses: totalPlExpenses,
      totalIncome: totalPlIncome,
    },
    netProfit,
  };
}

export async function listPartyAccounts(pool, authStaff, query) {
  const companyId = Number(authStaff.company_id);
  const partyType = query.partyType === 'payable' ? 'payable' : 'receivable';
  const rows = await financialReportRepo.listPartyLedgerAccounts(pool, companyId, { partyType });
  return {
    partyType,
    accounts: rows.map((r) => ({
      accountId: Number(r.account_id),
      accountNo: r.account_no,
      accountHead: r.account_head,
    })),
  };
}
