'use strict';

/**
 * @fileoverview The inbox and match lifecycle.
 */

const express = require('express');
const { asyncHandler } = require('./asyncHandler');

function matchesRouter({ messaging, matching }, { requireAuth, requireApproved }) {
  const router = express.Router();
  router.use(requireAuth, requireApproved);

  router.get('/', asyncHandler(async (req, res) => {
    const rows = await messaging.inbox(req.member);
    res.json({ matches: rows, unread: rows.reduce((sum, r) => sum + r.unread, 0) });
  }));

  /** Unmatching closes the conversation for both sides and cannot be undone. */
  router.delete('/:id', asyncHandler(async (req, res) => {
    const match = await matching.unmatch(req.member.id, req.params.id, { reason: req.body?.reason });
    res.json({ match });
  }));

  return router;
}

module.exports = { matchesRouter };
