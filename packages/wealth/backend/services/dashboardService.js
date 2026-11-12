'use strict';

const NETWORTH_SNAPSHOT_CONTAINER = 'networth_snapshots';
const TREND_LENGTH = 12;

function nextPayday(paydayDay, from = new Date()) {
  const day = Math.min(Math.max(paydayDay || 25, 1), 28);
  const candidate = new Date(from.getFullYear(), from.getMonth(), day);
  if (candidate < from) candidate.setMonth(candidate.getMonth() + 1);
  return candidate;
}

function computeBreakdown(accounts) {
  let cash = 0;
  let investments = 0;
  let propertyEquity = 0;
  let otherDebt = 0;

  for (const account of accounts) {
    if (account.status === 'closed') continue;
    const balance = account.balance || 0;

    switch (account.type) {
      case 'cash':
        cash += balance;
        break;
      case 'retirement':
      case 'investment':
        investments += balance;
        break;
      case 'home_loan':
        propertyEquity += (account.propertyValue || 0) - balance;
        break;
      case 'credit_card':
      case 'loan':
        otherDebt += balance;
        break;
      default:
        break;
    }
  }

  return { cash, investments, propertyEquity, otherDebt };
}

function createDashboardService({ accounts, debitOrders, settings, store, versionedCache }) {
  async function computeSummary() {
    const [accountList, upcoming, appSettings] = await Promise.all([
      accounts.list(),
      debitOrders.upcoming(7),
      settings.get()
    ]);

    const breakdown = computeBreakdown(accountList);
    const netWorth = breakdown.cash + breakdown.investments + breakdown.propertyEquity - breakdown.otherDebt;

    const cashAccounts = accountList.filter((a) => a.type === 'cash' && a.status !== 'closed');
    const currentAccountBalance = cashAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
    const payday = nextPayday(appSettings.paydayDay);
    const dueBeforePayday = await debitOrders.upcoming(
      Math.ceil((payday - new Date()) / (24 * 60 * 60 * 1000)) || 1
    );
    const availableToSpend = currentAccountBalance - dueBeforePayday.reduce((sum, o) => sum + o.amount, 0);

    const creditCards = accountList.filter((a) => a.type === 'credit_card' && a.status !== 'closed');
    const highUtilisationCards = creditCards.filter(
      (c) => c.limit > 0 && c.balance / c.limit >= appSettings.utilisationWarningThreshold
    );

    return {
      netWorth,
      breakdown,
      availableToSpend,
      payday: payday.toISOString().slice(0, 10),
      upcomingDebitOrders: upcoming,
      alerts: highUtilisationCards.map((c) => ({
        type: 'credit-utilisation',
        message: `${c.name} is at ${Math.round((c.balance / c.limit) * 100)}% utilisation`,
        accountId: c.id
      })),
      generatedAt: new Date().toISOString()
    };
  }

  async function trend() {
    const snapshots = await store.list(NETWORTH_SNAPSHOT_CONTAINER);
    const sorted = snapshots.sort((a, b) => new Date(a.date) - new Date(b.date));
    return sorted.slice(-TREND_LENGTH).map((s) => ({ date: s.date, netWorth: s.netWorth }));
  }

  async function deltaOverDays(days = 30) {
    const snapshots = (await store.list(NETWORTH_SNAPSHOT_CONTAINER)).sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );
    if (snapshots.length === 0) return 0;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const reference = [...snapshots].reverse().find((s) => new Date(s.date).getTime() <= cutoff);
    const baseline = reference || snapshots[0];
    const latest = snapshots[snapshots.length - 1];
    return latest.netWorth - baseline.netWorth;
  }

  async function recordSnapshot() {
    const summary = await computeSummary();
    const today = new Date().toISOString().slice(0, 10);
    const existingToday = (await store.list(NETWORTH_SNAPSHOT_CONTAINER)).find((s) => s.date === today);
    const payload = {
      date: today,
      netWorth: summary.netWorth,
      cash: summary.breakdown.cash,
      propertyEquity: summary.breakdown.propertyEquity,
      retirementInvestments: summary.breakdown.investments,
      debt: summary.breakdown.otherDebt
    };
    if (existingToday) {
      await store.update(NETWORTH_SNAPSHOT_CONTAINER, existingToday.id, payload);
    } else {
      await store.create(NETWORTH_SNAPSHOT_CONTAINER, payload);
    }
    return payload;
  }

  async function get() {
    return versionedCache.remember('dashboard', async () => {
      const [summary, trendData, delta30d] = await Promise.all([computeSummary(), trend(), deltaOverDays(30)]);
      return { ...summary, trend: trendData, delta30d };
    });
  }

  return { get, recordSnapshot, computeSummary };
}

module.exports = { createDashboardService, NETWORTH_SNAPSHOT_CONTAINER, computeBreakdown, nextPayday };
