'use strict';

/**
 * @fileoverview Reports and blocks — the member-facing half of trust & safety.
 */

const express = require('express');
const { asyncHandler } = require('./asyncHandler');
const rateLimits = require('../middleware/rateLimits');
const { ValidationError } = require('../errors');

/**
 * Mounted at the API root, so the gates are attached per route rather than
 * with `router.use`. A router-level `use` here matches every path under /api
 * and would silently gate unrelated routes mounted after it.
 */
function safetyRouter({ moderation }, { requireAuth, requireApproved }) {
  const router = express.Router();
  const gated = [requireAuth, requireApproved];

  router.post('/reports', gated, rateLimits.reports, asyncHandler(async (req, res) => {
    const { targetId, category, note, messageId, matchId } = req.body || {};
    if (!targetId) throw new ValidationError('Who are you reporting?');
    const report = await moderation.report(req.member.id, { targetId, category, note, messageId, matchId });
    res.status(201).json({
      report: { id: report.id, category: report.category, createdAt: report.createdAt },
      // Reporting also hides them immediately, before a moderator looks.
      blocked: true
    });
  }));

  router.get('/reports/categories', requireAuth, (req, res) => {
    res.json(moderation.REPORT_CATEGORIES);
  });

  router.post('/blocks', gated, asyncHandler(async (req, res) => {
    const { memberId } = req.body || {};
    if (!memberId) throw new ValidationError('Who are you blocking?');
    await moderation.block(req.member.id, memberId, { reason: req.body?.reason });
    res.status(201).json({ ok: true });
  }));

  // Readable while paused or dormant — a member must always be able to see and
  // undo who they have blocked.
  router.get('/blocks', requireAuth, asyncHandler(async (req, res) => {
    res.json(await moderation.blockedBy(req.member.id));
  }));

  router.delete('/blocks/:memberId', requireAuth, asyncHandler(async (req, res) => {
    const removed = await moderation.unblock(req.member.id, req.params.memberId);
    res.json({ ok: removed });
  }));

  return router;
}

module.exports = { safetyRouter };
