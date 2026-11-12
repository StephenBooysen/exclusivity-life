'use strict';

/**
 * One-time bootstrap: income used to live as a single static number
 * (settings.monthlyIncome) that projections read directly. Income Streams
 * replace that with an editable, historized entity like accounts, so on
 * first boot after the upgrade we carry the existing number forward as a
 * "Salary" stream rather than silently dropping it.
 */
async function migrateIncomeFromSettings({ incomeStreams, settings, logger }) {
  const existing = await incomeStreams.list();
  if (existing.length > 0) return;

  const appSettings = await settings.get();
  if (!appSettings.monthlyIncome) return;

  await incomeStreams.create({
    name: 'Salary',
    type: 'salary',
    amount: appSettings.monthlyIncome,
    frequency: 'monthly'
  });
  logger.info('[migrate] created "Salary" income stream from legacy settings.monthlyIncome');
}

module.exports = { migrateIncomeFromSettings };
