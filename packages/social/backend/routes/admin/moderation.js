'use strict';

/**
 * @fileoverview Moderation queue: reports, flagged messages, pending photos.
 */

const express = require('express');
const { asyncHandler } = require('../asyncHandler');
const { NotFoundError } = require('../../errors');

function moderationRouter({ moderation, media, profiles, messaging, members, realtime }) {
  const router = express.Router();

  router.get('/queue', asyncHandler(async (req, res) => {
    const [reports, photos, depth] = await Promise.all([
      moderation.queue({ state: req.query.state || 'open', category: req.query.category || null }),
      media.pendingQueue(),
      moderation.queueDepth()
    ]);

    const reportRows = [];
    for (const report of reports.slice(0, 100)) {
      const target = await members.get(report.targetId);
      reportRows.push({
        ...report,
        target: target ? { id: target.id, email: target.email, displayName: target.displayName } : null,
        ageHours: Math.round(((Date.now() - new Date(report.createdAt)) / 36e5) * 10) / 10
      });
    }

    const photoRows = [];
    for (const photo of photos.slice(0, 60)) {
      const owner = await members.get(photo.memberId);
      photoRows.push({
        id: photo.id,
        memberId: photo.memberId,
        uploadedAt: photo.uploadedAt,
        flags: photo.flags || [],
        owner: owner ? { id: owner.id, displayName: owner.displayName, status: owner.status } : null
      });
    }

    res.json({
      reports: reportRows,
      photos: photoRows,
      depth,
      categories: moderation.REPORT_CATEGORIES,
      actions: moderation.ACTIONS
    });
  }));

  router.get('/reports/:id', asyncHandler(async (req, res) => {
    const detail = await moderation.detail(req.params.id);
    if (detail.report.matchId) {
      detail.messages = await messaging.messagesForModeration(detail.report.matchId);
    }
    res.json(detail);
  }));

  router.post('/reports/:id/act', asyncHandler(async (req, res) => {
    const record = await moderation.act(req.params.id, {
      action: req.body?.action,
      reason: req.body?.reason,
      durationDays: req.body?.durationDays,
      moderatorId: req.member.id
    });
    // Enforcement must not be outlived by an open socket.
    if (['suspend', 'ban'].includes(req.body?.action)) {
      await realtime.disconnectMember(record.targetId).catch(() => {});
    }
    res.json(record);
  }));

  router.post('/photos/:id/:decision', asyncHandler(async (req, res) => {
    const decision = req.params.decision === 'approve' ? 'live' : 'rejected';
    const photo = await media.moderate(req.params.id, decision, {
      reviewerId: req.member.id,
      reason: req.body?.reason || null
    });
    res.json(photo);
  }));

  /** Pending free-text profile edits awaiting release. */
  router.get('/profile-edits', asyncHandler(async (req, res) => {
    const all = await profiles.all();
    const pending = all.filter((p) => p.pending);
    const rows = [];
    for (const profile of pending) {
      const member = await members.get(profile.memberId);
      rows.push({
        profileId: profile.id,
        memberId: profile.memberId,
        member: member ? { id: member.id, displayName: member.displayName } : null,
        live: { bio: profile.bio, occupation: profile.occupation, employer: profile.employer, prompts: profile.prompts },
        pending: profile.pending
      });
    }
    res.json(rows);
  }));

  router.post('/profile-edits/:profileId/:decision', asyncHandler(async (req, res) => {
    const approve = req.params.decision === 'approve';
    const profile = await profiles.resolvePending(req.params.profileId, approve, {
      reviewerId: req.member.id,
      reason: req.body?.reason
    });
    if (!profile) throw new NotFoundError('Profile not found');
    res.json(profile);
  }));

  return router;
}

module.exports = { moderationRouter };
