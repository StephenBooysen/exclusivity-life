'use strict';

const express = require('express');
const path = require('node:path');

const config = require('./config');
const { initPlatform } = require('./services/platform');
const { createStore } = require('./services/store');
const { createVersionedCache } = require('./services/cacheVersion');
const { createActivityService } = require('./services/activityService');
const { createAccountsService } = require('./services/accountsService');
const { createDebitOrdersService } = require('./services/debitOrdersService');
const { createTransactionsService } = require('./services/transactionsService');
const { createTransfersService } = require('./services/transfersService');
const { createIncomeStreamsService } = require('./services/incomeStreamsService');
const { createCategoriesService } = require('./services/categoriesService');
const { createSettingsService } = require('./services/settingsService');
const { createScenariosService } = require('./services/scenariosService');
const { createDashboardService } = require('./services/dashboardService');
const { createProjectionService } = require('./services/projectionService');
const { seedIfEmpty } = require('./services/seed');
const { migrateIncomeFromSettings } = require('./services/migrateIncome');
const { buildApiRouter } = require('./routes');

/** Builds the Express app: platform-core wiring, domain services, API routes, static frontend. */
function createApp() {
  const app = express();
  app.use(express.json());

  const platform = initPlatform(app);
  const { logger, cache, dataService, scheduler } = platform;

  const store = createStore(dataService);
  const versionedCache = createVersionedCache(cache);
  const activity = createActivityService({ store, queue: platform.queue, logger });

  const accounts = createAccountsService({ store, versionedCache, activity });
  const debitOrders = createDebitOrdersService({ store, versionedCache, activity });
  const transactions = createTransactionsService({ store, accounts, versionedCache, activity });
  const transfers = createTransfersService({ accounts, transactions, versionedCache, activity });
  const incomeStreams = createIncomeStreamsService({ store, versionedCache, activity });
  const categories = createCategoriesService({ store, versionedCache });
  const settings = createSettingsService({ store, versionedCache });
  const scenarios = createScenariosService({ store, versionedCache });
  const dashboard = createDashboardService({ accounts, debitOrders, settings, store, versionedCache });
  const projection = createProjectionService({ accounts, settings, scenarios, debitOrders, transactions, incomeStreams, versionedCache });

  const services = {
    logger, cache, dataService, store, versionedCache, activity,
    accounts, debitOrders, transactions, transfers, incomeStreams, categories, settings, scenarios, dashboard, projection
  };

  activity.startDrainLoop();

  scheduler.start(
    'daily-net-worth-snapshot',
    'dailySnapshot.js',
    { dataDir: config.dataDir },
    24 * 60 * 60,
    (status, result) => {
      logger.info(`[scheduler] daily-net-worth-snapshot ${status}`, result);
    }
  ).catch((err) => logger.error('[scheduler] failed to start daily snapshot job', err.message));

  seedIfEmpty(services)
    .then(() => migrateIncomeFromSettings(services))
    .catch((err) => logger.error('[seed/migrate] startup task failed', err.message));

  app.use('/api', buildApiRouter(services));
  app.use(express.static(config.publicDir));
  app.get('/', (req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  return app;
}

module.exports = { createApp };
