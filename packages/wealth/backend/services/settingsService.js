'use strict';

const config = require('../config');

const CONTAINER = 'app_settings';

const DEFAULTS = {
  profileName: 'Stephen Booysen',
  profileEmail: 'stephenrbooysen@gmail.com',
  pushNotifications: true,
  emailSummaries: false,
  horizonAge: config.defaults.horizonAge,
  retirementAge: config.defaults.retirementAge,
  currentAge: 41,
  inflationRate: config.defaults.inflationRate,
  drawdownRate: config.defaults.drawdownRate,
  propertyAppreciationRate: config.defaults.propertyAppreciationRate,
  cashGrowthRate: config.defaults.cashGrowthRate,
  utilisationWarningThreshold: config.defaults.utilisationWarningThreshold,
  otherMonthlyExpenses: 17500,
  paydayDay: 25,
  minRetirementIncome: 15000
};

function createSettingsService({ store, versionedCache }) {
  async function get() {
    const all = await store.list(CONTAINER);
    if (all.length > 0) return all[0];
    return store.create(CONTAINER, DEFAULTS);
  }

  async function update(patch) {
    const current = await get();
    const updated = await store.update(CONTAINER, current.id, patch);
    await versionedCache.bump();
    return updated;
  }

  return { get, update, DEFAULTS };
}

module.exports = { createSettingsService, CONTAINER, DEFAULTS };
