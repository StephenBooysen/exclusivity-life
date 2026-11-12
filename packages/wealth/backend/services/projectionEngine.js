'use strict';

/**
 * Pure math for the wealth projection. No I/O — takes a plain snapshot of
 * accounts + settings + scenario overrides and returns a yearly series.
 * Kept separate from projectionService so the formulas can be reasoned
 * about (and unit tested) without the storage layer in the way.
 */

/** Standard amortization remaining-balance formula, closed form (no month-by-month loop). */
function remainingBalance(principal, annualRate, monthlyPayment, months) {
  if (months <= 0) return Math.max(0, principal);
  if (monthlyPayment <= 0) return Math.max(0, principal);
  const r = annualRate / 12;
  if (r === 0) return Math.max(0, principal - monthlyPayment * months);
  const growth = (1 + r) ** months;
  const remaining = principal * growth - monthlyPayment * ((growth - 1) / r);
  return Math.max(0, remaining);
}

/** Months until a debt reaches zero under its current payment; Infinity if the payment never catches interest. */
function monthsToPayoff(principal, annualRate, monthlyPayment) {
  if (principal <= 0) return 0;
  if (monthlyPayment <= 0) return Infinity;
  const r = annualRate / 12;
  if (r === 0) return Math.ceil(principal / monthlyPayment);
  if (monthlyPayment <= principal * r) return Infinity;
  return Math.ceil(Math.log(monthlyPayment / (monthlyPayment - principal * r)) / Math.log(1 + r));
}

/** Year-by-year value of a retirement/investment account: compounds while contributing, draws down after retirement. */
function buildAccountSeries(account, years, { currentAge, retirementAge, drawdownRate, inflationRate, growthRateDelta }) {
  const series = [account.balance || 0];
  const growthRate = (account.growthRateAssumed || 0) + (growthRateDelta || 0);
  let drawdownAmount = null;

  for (let y = 1; y <= years; y += 1) {
    const age = currentAge + y;
    let value = series[y - 1];

    if (age <= retirementAge) {
      value = value * (1 + growthRate) + (account.contributionMonthly || 0) * 12;
    } else {
      if (drawdownAmount === null) {
        drawdownAmount = value * drawdownRate;
      } else {
        drawdownAmount *= 1 + inflationRate;
      }
      value = Math.max(0, value * (1 + growthRate) - drawdownAmount);
    }

    series.push(value);
  }

  return series;
}

/**
 * Runs the full projection.
 * @param {{accounts: Array, settings: Object, scenario: Object}} input
 * @return {{years: Array, milestones: Array, assumptions: Object, incomeShortfallAge: ?number}}
 */
function runProjection({ accounts, settings, scenario }) {
  const overrides = (scenario && scenario.overrides) || {};
  const currentAge = settings.currentAge;
  const horizonAge = settings.horizonAge;
  const retirementAge = overrides.retirementAge ?? settings.retirementAge;
  const inflationRate = overrides.inflationRate ?? settings.inflationRate;
  const drawdownRate = overrides.drawdownRate ?? settings.drawdownRate;
  const growthRateDelta = overrides.growthRateDelta || 0;
  const extraBondPayment = overrides.extraBondPayment || 0;
  const propertyAppreciationRate = overrides.propertyAppreciationRate ?? settings.propertyAppreciationRate;
  const cashGrowthRate = settings.cashGrowthRate;
  const years = Math.max(0, horizonAge - currentAge);

  const homeLoans = accounts.filter((a) => a.type === 'home_loan' && a.status !== 'closed');
  const otherDebts = accounts.filter((a) => (a.type === 'loan' || a.type === 'credit_card') && a.status !== 'closed');
  const growthAccounts = accounts.filter((a) => (a.type === 'retirement' || a.type === 'investment') && a.status !== 'closed');
  const cashAccounts = accounts.filter((a) => a.type === 'cash' && a.status !== 'closed');

  const growthCommon = { currentAge, retirementAge, drawdownRate, inflationRate, growthRateDelta };
  const growthSeries = growthAccounts.map((account) => ({
    account,
    series: buildAccountSeries(account, years, growthCommon)
  }));

  const totalMonthlyContributions = growthAccounts.reduce((sum, a) => sum + (a.contributionMonthly || 0), 0);
  const netMonthlySurplus =
    (settings.monthlyIncome || 0) -
    (settings.monthlyFixedAndDiscretionary || 0) -
    totalMonthlyContributions -
    (settings.otherMonthlyExpenses || 0);

  const startCash = cashAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const cashSeries = [startCash];
  for (let y = 1; y <= years; y += 1) {
    const age = currentAge + y;
    const surplus = age <= retirementAge ? Math.max(0, netMonthlySurplus) * 12 : 0;
    cashSeries.push(cashSeries[y - 1] * (1 + cashGrowthRate) + surplus);
  }

  const milestones = [];
  if (retirementAge > currentAge && retirementAge <= horizonAge) {
    milestones.push({ label: 'Retirement', age: retirementAge });
  }

  const debtSeriesFor = (debts, extraPerAccount = () => 0) =>
    debts.map((account) => {
      const rate = account.rate || 0;
      const payment = (account.instalment || account.minPayment || 0) + extraPerAccount(account);
      const months = monthsToPayoff(account.balance || 0, rate, payment);
      if (Number.isFinite(months)) {
        const payoffAge = currentAge + months / 12;
        if (payoffAge <= horizonAge) {
          milestones.push({ label: `${account.name} settled`, age: Math.round(payoffAge * 10) / 10 });
        }
      }
      return { account, rate, payment };
    });

  const homeLoanMeta = debtSeriesFor(homeLoans, () => extraBondPayment);
  const otherDebtMeta = debtSeriesFor(otherDebts);

  const yearRows = [];
  for (let y = 0; y <= years; y += 1) {
    const age = currentAge + y;
    const months = y * 12;

    let propertyEquity = 0;
    for (const { account, rate, payment } of homeLoanMeta) {
      const propertyValue = (account.propertyValue || 0) * (1 + propertyAppreciationRate) ** y;
      const bondBalance = remainingBalance(account.balance || 0, rate, payment, months);
      propertyEquity += propertyValue - bondBalance;
    }

    let otherDebt = 0;
    for (const { account, rate, payment } of otherDebtMeta) {
      otherDebt += remainingBalance(account.balance || 0, rate, payment, months);
    }

    const retirementInvestments = growthSeries.reduce((sum, g) => sum + g.series[y], 0);
    const cash = cashSeries[y];
    const netWorth = cash + retirementInvestments + propertyEquity - otherDebt;

    yearRows.push({
      year: new Date().getFullYear() + y,
      age,
      cash: round2(cash),
      propertyEquity: round2(propertyEquity),
      retirementInvestments: round2(retirementInvestments),
      otherDebt: round2(otherDebt),
      netWorth: round2(netWorth)
    });
  }

  let incomeShortfallAge = null;
  for (const row of yearRows) {
    if (row.age <= retirementAge) continue;
    const yearsSinceRetirement = row.age - retirementAge;
    const inflatedMinimum = settings.minRetirementIncome * (1 + inflationRate) ** yearsSinceRetirement;
    const monthlyDrawdownIncome = (row.retirementInvestments * drawdownRate) / 12;
    if (monthlyDrawdownIncome < inflatedMinimum) {
      incomeShortfallAge = row.age;
      break;
    }
  }

  return {
    years: yearRows,
    milestones: milestones.sort((a, b) => a.age - b.age),
    incomeShortfallAge,
    assumptions: {
      currentAge,
      horizonAge,
      retirementAge,
      inflationRate,
      drawdownRate,
      propertyAppreciationRate,
      extraBondPayment
    }
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

module.exports = { runProjection, remainingBalance, monthsToPayoff, buildAccountSeries };
