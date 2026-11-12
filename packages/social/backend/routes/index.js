'use strict';

/**
 * @fileoverview API composition and the error boundary.
 *
 * Routes are thin by rule: parse, authorise, delegate, respond. No business
 * rule lives in a handler — rules are tested at the service layer where they
 * are not coupled to HTTP.
 */

const express = require('express');
const config = require('../config');
const { asyncHandler } = require('./asyncHandler');

const { authRouter } = require('./auth');
const { applicationsRouter } = require('./applications');
const { profileRouter } = require('./profile');
const { photosRouter } = require('./photos');
const { discoveryRouter } = require('./discovery');
const { matchesRouter } = require('./matches');
const { messagesRouter } = require('./messages');
const { membershipRouter } = require('./membership');
const { safetyRouter } = require('./safety');
const { settingsRouter } = require('./settings');
const { notificationsRouter } = require('./notifications');

const { reviewRouter } = require('./admin/review');
const { moderationRouter } = require('./admin/moderation');
const { adminMembersRouter } = require('./admin/members');
const { opsRouter } = require('./admin/ops');

function buildApiRouter(services, middleware) {
  const router = express.Router();
  const { requireAuth, requireRole } = middleware;

  router.get('/health', asyncHandler(async (req, res) => {
    res.json({
      name: config.name,
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      launchCity: config.launch.city,
      billingProvider: services.billing.provider,
      emailProvider: config.email.provider,
      connections: services.realtime.connectionCount(),
      jobs: services.jobs.status().map((j) => ({ name: j.name, lastRunAt: j.lastRunAt, ok: j.ok }))
    });
  }));

  router.use('/auth', authRouter(services));
  router.use('/applications', applicationsRouter(services, middleware));
  router.use('/profile', profileRouter(services, middleware));
  router.use('/photos', photosRouter(services, middleware));
  router.use('/discovery', discoveryRouter(services, middleware));
  router.use('/matches', matchesRouter(services, middleware));
  router.use('/messages', messagesRouter(services, middleware));
  router.use('/membership', membershipRouter(services, middleware));
  router.use('/', safetyRouter(services, middleware));
  router.use('/settings', settingsRouter(services, middleware));
  router.use('/notifications', notificationsRouter(services, middleware));

  // Staff only. requireRole answers 404-shaped so the console is not
  // discoverable by probing.
  const admin = express.Router();
  admin.use(requireAuth, requireRole('moderator', 'admin'));
  admin.use('/review', reviewRouter(services));
  admin.use('/moderation', moderationRouter(services));
  admin.use('/members', adminMembersRouter(services));
  admin.use('/ops', opsRouter(services));
  router.use('/admin', admin);

  router.use((req, res) => {
    res.status(404).json({ error: 'Not found', code: 'not_found' });
  });

  /**
   * The only place a domain error becomes an HTTP status. Internal errors
   * never leak a message or a stack to the client.
   */
  router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || 500;
    const log = status >= 500 ? services.logger.error : services.logger.warn;

    log.call(services.logger,
      `[api] ${req.method} ${req.originalUrl} ${status} — ${err.message}`,
      { memberId: req.member?.id, code: err.code });

    if (status >= 500) {
      services.logger.error(err.stack || String(err));
    }

    res.status(status).json({
      error: status >= 500 ? 'Something went wrong' : err.message,
      code: err.code || (status >= 500 ? 'internal_error' : 'error'),
      ...(err.details || {})
    });
  });

  return router;
}

module.exports = { buildApiRouter };
