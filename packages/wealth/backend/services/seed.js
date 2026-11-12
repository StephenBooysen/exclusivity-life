'use strict';

/**
 * Populates realistic starter data on first boot only (accounts container
 * empty), so the app is immediately usable rather than opening on a wall of
 * empty states. Figures match the PRD's worked example for continuity.
 */
async function seedIfEmpty(services) {
  const existing = await services.accounts.list();
  if (existing.length > 0) return;

  services.logger.info('[seed] No accounts found — loading starter data');

  const cheque = await services.accounts.create({
    type: 'cash',
    name: 'Cheque Account',
    institution: 'FNB',
    balance: 64200
  });

  const bond = await services.accounts.create({
    type: 'home_loan',
    name: 'Absa Home Loan',
    institution: 'Absa',
    originalAmount: 1120000,
    balance: 845000,
    rate: 0.11,
    instalment: 14200,
    termMonths: 240,
    propertyValue: 1457000,
    appreciationRate: 0.06
  });

  await services.accounts.create({
    type: 'credit_card',
    name: 'Discovery Bank Card',
    institution: 'Discovery Bank',
    balance: 32450,
    limit: 60000,
    rate: 0.215,
    minPayment: 1620,
    statementDay: 25
  });

  await services.accounts.create({
    type: 'credit_card',
    name: 'Woolworths Account',
    institution: 'Woolworths Financial Services',
    balance: 8900,
    limit: 25000,
    rate: 0.199,
    minPayment: 450,
    statementDay: 20
  });

  await services.accounts.create({
    type: 'loan',
    name: 'Vehicle Finance',
    institution: 'WesBank',
    originalAmount: 320000,
    balance: 127000,
    rate: 0.1075,
    instalment: 6400,
    termMonths: 26
  });

  await services.accounts.create({
    type: 'retirement',
    name: 'Retirement Annuity',
    institution: 'Allan Gray',
    vehicleType: 'ra',
    balance: 612400,
    contributionMonthly: 4500,
    growthRateAssumed: 0.095,
    targetRetirementAge: 65
  });

  await services.accounts.create({
    type: 'retirement',
    name: 'Pension Fund',
    institution: 'Old Mutual',
    vehicleType: 'pension',
    balance: 498200,
    contributionMonthly: 0,
    growthRateAssumed: 0.085,
    targetRetirementAge: 65,
    preserved: true
  });

  await services.accounts.create({
    type: 'investment',
    name: 'TFSA',
    institution: 'EasyEquities',
    vehicleType: 'tfsa',
    balance: 156900,
    contributionMonthly: 2000,
    growthRateAssumed: 0.09,
    annualContributionCap: 36000,
    lifetimeContributionCap: 500000,
    annualContributed: 24000,
    lifetimeContributed: 156900
  });

  await services.accounts.create({
    type: 'investment',
    name: 'Emergency Fund',
    institution: 'Cash investment',
    vehicleType: 'emergency_fund',
    balance: 73300,
    contributionMonthly: 500,
    growthRateAssumed: 0.02,
    target: 120000
  });

  const debitOrderSeeds = [
    { payee: 'Absa Home Loan', amount: 14200, frequency: 'monthly', debitDay: 1, category: 'Home & Insurance', linkedAccountId: bond.id, status: 'active' },
    { payee: 'Discovery Medical Aid', amount: 4850, frequency: 'monthly', debitDay: 1, category: 'Home & Insurance', status: 'active' },
    { payee: 'Outsurance Household', amount: 1120, frequency: 'monthly', debitDay: 2, category: 'Home & Insurance', status: 'active' },
    { payee: 'Vitality Gym', amount: 899, frequency: 'monthly', debitDay: 5, category: 'Subscriptions', status: 'active' },
    { payee: 'Netflix', amount: 199, frequency: 'monthly', debitDay: 3, category: 'Subscriptions', status: 'active' },
    { payee: 'Cloud Storage', amount: 49, frequency: 'monthly', debitDay: 8, category: 'Subscriptions', status: 'paused' }
  ];
  for (const payload of debitOrderSeeds) {
    await services.debitOrders.create(payload); // eslint-disable-line no-await-in-loop
  }

  const categorySeeds = [
    { name: 'Groceries', group: 'Household', monthlyBudget: 5000 },
    { name: 'Fuel', group: 'Household', monthlyBudget: 2000 },
    { name: 'Dining Out', group: 'Lifestyle', monthlyBudget: 1800 },
    { name: 'Medical', group: 'Health', monthlyBudget: 1500 },
    { name: 'Shopping', group: 'Lifestyle', monthlyBudget: 1200 },
    { name: 'Other', group: 'Miscellaneous', monthlyBudget: 500 }
  ];
  for (const payload of categorySeeds) {
    await services.categories.create(payload); // eslint-disable-line no-await-in-loop
  }

  const month = new Date().toISOString().slice(0, 7);
  const expenseSeeds = [
    { date: `${month}-03`, amount: 1450, category: 'Groceries', note: 'Woolworths' },
    { date: `${month}-11`, amount: 1680, category: 'Groceries', note: 'Checkers' },
    { date: `${month}-22`, amount: 1070, category: 'Groceries', note: 'Pick n Pay' },
    { date: `${month}-05`, amount: 950, category: 'Fuel', note: 'Engen' },
    { date: `${month}-19`, amount: 900, category: 'Fuel', note: 'Shell' },
    { date: `${month}-08`, amount: 1240, category: 'Dining Out', note: 'Weekend dinner' },
    { date: `${month}-15`, amount: 860, category: 'Dining Out', note: 'Takeout' },
    { date: `${month}-21`, amount: 540, category: 'Dining Out', note: 'Coffee & lunches' },
    { date: `${month}-12`, amount: 980, category: 'Medical', note: 'Pharmacy' },
    { date: `${month}-09`, amount: 620, category: 'Shopping', note: 'Takealot' },
    { date: `${month}-17`, amount: 380, category: 'Other', note: 'Sundries' }
  ];
  for (const payload of expenseSeeds) {
    await services.transactions.create({ ...payload, accountId: cheque.id }); // eslint-disable-line no-await-in-loop
  }

  await services.incomeStreams.create({
    name: 'Salary',
    type: 'salary',
    amount: 58000,
    frequency: 'monthly'
  });

  await services.settings.update({
    paydayDay: 1,
    currentAge: 41,
    retirementAge: 65,
    horizonAge: 90,
    minRetirementIncome: 15000
  });

  await services.scenarios.list(); // ensures the "Moderate" base case exists
  await services.scenarios.create({ name: 'Conservative', overrides: { growthRateDelta: -0.03 } });
  await services.scenarios.create({ name: 'Optimistic', overrides: { growthRateDelta: 0.02 } });

  await services.dashboard.recordSnapshot();

  services.logger.info('[seed] Starter data loaded');
}

module.exports = { seedIfEmpty };
