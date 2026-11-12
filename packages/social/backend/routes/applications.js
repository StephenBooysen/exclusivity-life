'use strict';

/**
 * @fileoverview The applicant's own view of their application: save, resume,
 * submit, withdraw, appeal.
 */

const express = require('express');
const config = require('../config');
const interests = require('../services/interests');
const { asyncHandler } = require('./asyncHandler');
const { singleImage } = require('../middleware/upload');
const rateLimits = require('../middleware/rateLimits');

/** The application form's own length — the progress bar reads from this. */
const TOTAL_STEPS = 7;

function applicationsRouter({ applications, profiles, media, verification, members }, { requireAuth }) {
  const router = express.Router();
  router.use(requireAuth);

  /** Everything the multi-step form needs to render and resume. */
  router.get('/mine', asyncHandler(async (req, res) => {
    const application = await applications.forMember(req.member.id);
    const profile = await profiles.get(req.member.id);
    const photos = await media.forMember(req.member.id);
    const liveness = await verification.livenessFor(req.member.id);
    const preferences = await profiles.getPreferences(req.member.id);

    res.json({
      application,
      preferences,
      profile: profile ? profiles.selfView(profile, photos) : null,
      photos: photos.map((p) => ({
        id: p.id, isPrimary: p.isPrimary, moderationState: p.moderationState
      })),
      liveness: liveness ? { id: liveness.id, capturedAt: liveness.capturedAt } : null,
      requirements: {
        totalSteps: TOTAL_STEPS,
        minPhotos: config.media.minPhotos,
        maxPhotos: config.media.maxPhotos,
        needsMeans: req.member.side === 'male',
        interviewExpected: config.review.interviewRequiredFor.includes(req.member.side),
        interviewMinutes: config.review.interviewDurationMinutes,
        launchCity: config.launch.city,
        slaHours: config.review.slaHours,
        interestGroups: interests.GROUPS
      }
    });
  }));

  router.put('/mine', asyncHandler(async (req, res) => {
    const application = await applications.saveDraft(req.member.id, req.body || {});
    const profile = await profiles.get(req.member.id);
    res.json({ application, profile: profile ? profiles.selfView(profile, []) : null });
  }));

  router.post('/mine/submit', asyncHandler(async (req, res) => {
    const application = await applications.submit(req.member.id);
    const member = await members.getOrThrow(req.member.id);
    res.json({ application, member: members.selfView(member) });
  }));

  router.delete('/mine', asyncHandler(async (req, res) => {
    const application = await applications.withdraw(req.member.id);
    res.json({ application });
  }));

  router.post('/mine/appeal', asyncHandler(async (req, res) => {
    const application = await applications.appeal(req.member.id);
    res.status(201).json({ application });
  }));

  /** The prompted-pose capture. Never shown to another member. */
  router.post('/mine/liveness', rateLimits.upload, singleImage('photo'), asyncHandler(async (req, res) => {
    const record = await verification.storeLiveness({
      memberId: req.member.id,
      buffer: req.file?.buffer,
      mimetype: req.file?.mimetype
    });
    res.status(201).json({ liveness: { id: record.id, capturedAt: record.capturedAt } });
  }));

  return router;
}

module.exports = { applicationsRouter };
