'use strict';

const express = require('express');

const { accountsRouter } = require('./accounts');
const { debitOrdersRouter } = require('./debitOrders');
const { transactionsRouter } = require('./transactions');
const { transfersRouter } = require('./transfers');
const { incomeStreamsRouter } = require('./incomeStreams');
const { categoriesRouter } = require('./categories');
const { settingsRouter } = require('./settings');
const { scenariosRouter } = require('./scenarios');
const { dashboardRouter } = require('./dashboard');
const { projectionRouter } = require('./projection');
const { activityRouter } = require('./activity');

function buildApiRouter(services) {
  const router = express.Router();

  router.use('/accounts', accountsRouter(services));
  router.use('/debit-orders', debitOrdersRouter(services));
  router.use('/transactions', transactionsRouter(services));
  router.use('/transfers', transfersRouter(services));
  router.use('/income-streams', incomeStreamsRouter(services));
  router.use('/categories', categoriesRouter(services));
  router.use('/settings', settingsRouter(services));
  router.use('/scenarios', scenariosRouter(services));
  router.use('/dashboard', dashboardRouter(services));
  router.use('/projection', projectionRouter(services));
  router.use('/activity', activityRouter(services));

  router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    services.logger.error(`[api] ${req.method} ${req.originalUrl} — ${err.message}`);
    res.status(400).json({ error: err.message });
  });

  return router;
}

module.exports = { buildApiRouter };
