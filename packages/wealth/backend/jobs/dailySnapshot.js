/**
 * @fileoverview Worker-thread activity dispatched by the scheduling service
 * (see backend/app.js). Runs once at boot and then every 24h, writing a
 * dated net-worth snapshot so the dashboard trend/30-day-delta has history
 * to read even on a freshly seeded install.
 *
 * Worker threads get their own module registry, so this talks to storage
 * directly through the file dataservice provider rather than pulling in
 * the whole app (which is wired to a specific Express instance it can't see).
 */

'use strict';

const Dataservicefiles = require('digital-technologies-core/src/dataservice/providers/dataservicefiles');
const { computeBreakdown } = require('../services/dashboardService');

const NETWORTH_SNAPSHOT_CONTAINER = 'networth_snapshots';
const ACCOUNTS_CONTAINER = 'accounts';

async function run(data) {
  const dataDir = data && data.dataDir;
  const provider = new Dataservicefiles({ dataDir });

  const accounts = await provider.find(ACCOUNTS_CONTAINER, '');
  const breakdown = computeBreakdown(accounts);
  const netWorth = breakdown.cash + breakdown.investments + breakdown.propertyEquity - breakdown.otherDebt;

  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    date: today,
    netWorth,
    cash: breakdown.cash,
    propertyEquity: breakdown.propertyEquity,
    retirementInvestments: breakdown.investments,
    debt: breakdown.otherDebt
  };

  const existing = (await provider.find(NETWORTH_SNAPSHOT_CONTAINER, '')).find((s) => s.date === today);
  if (existing) {
    await provider.update(NETWORTH_SNAPSHOT_CONTAINER, existing.id, { ...existing, ...payload });
  } else {
    const id = await provider.add(NETWORTH_SNAPSHOT_CONTAINER, payload);
    await provider.update(NETWORTH_SNAPSHOT_CONTAINER, id, { ...payload, id });
  }

  return { message: 'daily net worth snapshot recorded', ...payload };
}

module.exports = { run };
