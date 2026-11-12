'use strict';

/**
 * @fileoverview Member administration: search, detail, enforcement, badges.
 */

const express = require('express');
const { asyncHandler } = require('../asyncHandler');
const { ValidationError } = require('../../errors');

function adminMembersRouter({ admin, moderation, verification, members, membership, realtime, sessionStore }) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await admin.memberSearch(req.query.q || '', { limit: Math.min(Number(req.query.limit) || 25, 100) }));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await admin.memberDetail(req.params.id));
  }));

  /** suspend | ban | reinstate — every one recorded with actor and reason. */
  router.post('/:id/action', asyncHandler(async (req, res) => {
    const { action, reason, durationDays } = req.body || {};
    if (!['suspend', 'ban', 'reinstate'].includes(action)) throw new ValidationError('Invalid action');
    const record = await moderation.actOnMember(req.params.id, {
      action, reason, durationDays, moderatorId: req.member.id
    });
    if (['suspend', 'ban'].includes(action)) {
      await realtime.disconnectMember(req.params.id).catch(() => {});
      await new Promise((resolve) => sessionStore.destroyForMember(req.params.id, () => resolve()));
    }
    res.json(record);
  }));

  router.post('/:id/badges', asyncHandler(async (req, res) => {
    const { badge, note } = req.body || {};
    await verification.grant(req.params.id, badge, {
      evidence: 'reviewer_assessment', reviewerId: req.member.id, note
    });
    res.json(await admin.memberDetail(req.params.id));
  }));

  router.delete('/:id/badges/:badge', asyncHandler(async (req, res) => {
    await verification.revoke(req.params.id, req.params.badge, {
      reviewerId: req.member.id, reason: req.body?.reason
    });
    res.json(await admin.memberDetail(req.params.id));
  }));

  /** Grants a membership without payment, recorded as comped. */
  router.post('/:id/comp', asyncHandler(async (req, res) => {
    const subscription = await admin.compMembership(req.params.id, {
      tier: req.body?.tier,
      days: Number(req.body?.days) || 30,
      adminId: req.member.id
    });
    res.json(subscription);
  }));

  /** Batch approval off the waitlist, when capacity opens. */
  router.post('/waitlist/approve', asyncHandler(async (req, res) => {
    const ids = req.body?.memberIds || [];
    if (!Array.isArray(ids) || !ids.length) throw new ValidationError('No members selected');
    const approved = [];
    for (const id of ids) {
      const member = await members.get(id);
      if (!member || member.status !== members.STATUS.WAITLISTED) continue;
      const status = member.side === 'female' ? members.STATUS.ACTIVE : members.STATUS.DORMANT;
      await members.setStatus(id, status, { reason: 'waitlist_released' });
      approved.push(id);
    }
    res.json({ approved: approved.length, memberIds: approved });
  }));

  return router;
}

module.exports = { adminMembersRouter };
