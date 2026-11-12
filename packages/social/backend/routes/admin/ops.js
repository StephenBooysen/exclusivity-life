'use strict';

/**
 * @fileoverview Operations dashboard, invites and the audit export.
 */

const express = require('express');
const { asyncHandler } = require('../asyncHandler');

function opsRouter({ admin, realtime, jobs }) {
  const router = express.Router();

  router.get('/metrics', asyncHandler(async (req, res) => {
    const [funnel, ratios, health, safety, trend] = await Promise.all([
      admin.funnel({ days: Number(req.query.days) || 30 }),
      admin.ratios(),
      admin.health(),
      admin.safetyMetrics({ days: 7 }),
      admin.trend({ days: 14 })
    ]);
    res.json({
      funnel,
      ratios,
      health,
      safety,
      trend,
      connections: realtime.connectionCount()
    });
  }));

  router.get('/audit', asyncHandler(async (req, res) => {
    res.json(await admin.auditExport({ from: req.query.from, to: req.query.to }));
  }));

  router.get('/invites', asyncHandler(async (req, res) => {
    res.json(await admin.listInvites());
  }));

  router.post('/invites', asyncHandler(async (req, res) => {
    const invite = await admin.createInvite({
      tier: req.body?.tier || 'noir',
      memberId: req.body?.memberId || null,
      expiresInDays: Number(req.body?.expiresInDays) || 30,
      note: req.body?.note,
      createdBy: req.member.id
    });
    res.status(201).json(invite);
  }));

  router.delete('/invites/:id', asyncHandler(async (req, res) => {
    res.json(await admin.revokeInvite(req.params.id, { adminId: req.member.id }));
  }));

  /** Runs a scheduled job now — for testing and for catching up a missed window. */
  router.post('/jobs/:name/run', asyncHandler(async (req, res) => {
    const result = await jobs.runNow(req.params.name);
    res.json(result);
  }));

  router.get('/jobs', asyncHandler(async (req, res) => {
    res.json(jobs.status());
  }));

  return router;
}

module.exports = { opsRouter };
