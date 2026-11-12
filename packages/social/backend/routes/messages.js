'use strict';

/**
 * @fileoverview Message history and sending.
 *
 * Both this and the socket path call messagingService.send, which is where the
 * participation check lives. Neither transport trusts the other's checks.
 */

const express = require('express');
const { asyncHandler } = require('./asyncHandler');
const rateLimits = require('../middleware/rateLimits');

function messagesRouter({ messaging }, { requireAuth, requireApproved }) {
  const router = express.Router();
  router.use(requireAuth, requireApproved);

  router.get('/:matchId', asyncHandler(async (req, res) => {
    const history = await messaging.history(req.member, req.params.matchId, {
      limit: Math.min(Number(req.query.limit) || 50, 100),
      before: req.query.before || null
    });
    res.json(history);
  }));

  router.post('/:matchId', rateLimits.messaging, asyncHandler(async (req, res) => {
    const message = await messaging.send(
      req.member,
      req.params.matchId,
      req.body?.text,
      req.body?.idempotencyKey
    );
    res.status(201).json(message);
  }));

  router.post('/:matchId/read', asyncHandler(async (req, res) => {
    res.json(await messaging.markRead(req.member, req.params.matchId));
  }));

  return router;
}

module.exports = { messagesRouter };
