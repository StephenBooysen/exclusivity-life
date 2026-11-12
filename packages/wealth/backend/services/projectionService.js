'use strict';

const { runProjection } = require('./projectionEngine');
const { cycleStartContaining, cycleEndFor } = require('./cycleDates');

function createProjectionService({ accounts, settings, scenarios, debitOrders, transactions, incomeStreams, versionedCache }) {
  async function forScenario(scenarioId) {
    return versionedCache.remember(`projection:${scenarioId || 'base'}`, async () => {
      const accountList = await accounts.list();
      const currentAccount = accountList.find((a) => a.type === 'cash' && a.vehicleType !== 'savings');

      const [appSettings, scenario, monthlyDebitOrders, monthlyIncome] = await Promise.all([
        settings.get(),
        scenarios.get(scenarioId),
        debitOrders.monthlyTotal(),
        incomeStreams.monthlyTotal()
      ]);

      // "This month" means the current pay cycle (payday to payday), not the calendar month —
      // a debit-order or expense dated a few days into next month can still belong to today's
      // cycle. Matches how Cash Flow and the Home dashboard both read "this month".
      let monthTransactionTotals = {};
      if (currentAccount) {
        const todayIso = new Date().toISOString().slice(0, 10);
        const cycleStart = cycleStartContaining(todayIso, appSettings.paydayDay || 25);
        const cycleEnd = cycleEndFor(cycleStart, appSettings.paydayDay || 25);
        monthTransactionTotals = await transactions.totalsForCycle(currentAccount.id, cycleStart, cycleEnd);
      }

      const discretionaryMonthly = Object.values(monthTransactionTotals).reduce((sum, v) => sum + v, 0);

      const settingsWithFlow = {
        ...appSettings,
        monthlyIncome,
        monthlyFixedAndDiscretionary: monthlyDebitOrders + discretionaryMonthly
      };

      const result = runProjection({ accounts: accountList, settings: settingsWithFlow, scenario });
      return { scenarioId: scenario.id, scenarioName: scenario.name, ...result };
    });
  }

  async function compare(scenarioIds) {
    return Promise.all(scenarioIds.map((id) => forScenario(id)));
  }

  return { forScenario, compare };
}

module.exports = { createProjectionService };
