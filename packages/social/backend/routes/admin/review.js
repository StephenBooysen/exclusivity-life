'use strict';

/**
 * @fileoverview Application review: the queue, the detail screen, the
 * interview, and the decision.
 */

const express = require('express');
const config = require('../../config');
const { asyncHandler } = require('../asyncHandler');
const { NotFoundError } = require('../../errors');

function reviewRouter({ applications, verification, members }) {
  const router = express.Router();

  router.get('/queue', asyncHandler(async (req, res) => {
    const queue = await applications.queue({
      state: req.query.state || 'open',
      side: req.query.side || null,
      flagged: req.query.flagged === undefined ? null : req.query.flagged === 'true'
    });

    const rows = [];
    for (const application of queue.slice(0, 100)) {
      const member = await members.get(application.memberId);
      rows.push({
        id: application.id,
        state: application.state,
        side: application.side,
        priority: application.priority,
        submittedAt: application.submittedAt,
        slaDueAt: application.slaDueAt,
        hoursRemaining: application.slaDueAt
          ? Math.round(((new Date(application.slaDueAt) - Date.now()) / 36e5) * 10) / 10
          : null,
        flags: application.prescreenFlags || [],
        interview: application.interview
          ? { scheduledFor: application.interview.scheduledFor, outcome: application.interview.outcome }
          : null,
        member: member ? { id: member.id, email: member.email, displayName: member.displayName, city: member.city } : null
      });
    }

    res.json({
      queue: rows,
      total: queue.length,
      slaHours: config.review.slaHours,
      reasonCodes: applications.REASON_CODES
    });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await applications.reviewDetail(req.params.id));
  }));

  router.post('/:id/claim', asyncHandler(async (req, res) => {
    res.json(await applications.claim(req.params.id, req.member.id));
  }));

  /** The liveness capture, for matching against the profile photos. */
  router.get('/:id/liveness', asyncHandler(async (req, res) => {
    const application = await applications.getOrThrow(req.params.id);
    const record = await verification.livenessFor(application.memberId);
    if (!record) throw new NotFoundError('No verification selfie on file');
    const buffer = await verification.readLiveness(record.id, application.memberId).catch(() => null);
    if (!buffer) throw new NotFoundError('No verification selfie on file');
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, no-store');
    res.send(buffer);
  }));

  router.post('/:id/interview', asyncHandler(async (req, res) => {
    const application = await applications.scheduleInterview(req.params.id, {
      scheduledFor: req.body?.scheduledFor,
      note: req.body?.note,
      reviewerId: req.member.id
    });
    res.json(application);
  }));

  /**
   * The interview outcome is what establishes means standing — a pass is the
   * evidence behind the `means` badge granted on approval.
   */
  router.post('/:id/interview/outcome', asyncHandler(async (req, res) => {
    const application = await applications.recordInterview(req.params.id, {
      outcome: req.body?.outcome,
      notes: req.body?.notes,
      reviewerId: req.member.id
    });
    res.json(application);
  }));

  router.post('/:id/decide', asyncHandler(async (req, res) => {
    const application = await applications.decide(req.params.id, {
      outcome: req.body?.outcome,
      reasonCode: req.body?.reasonCode,
      note: req.body?.note,
      reviewerId: req.member.id
    });
    res.json(application);
  }));

  return router;
}

module.exports = { reviewRouter };
