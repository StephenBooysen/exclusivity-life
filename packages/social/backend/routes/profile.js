'use strict';

/**
 * @fileoverview Own profile, and the authorised view of someone else's.
 */

const express = require('express');
const { asyncHandler } = require('./asyncHandler');
const rateLimits = require('../middleware/rateLimits');
const { NotFoundError } = require('../errors');

function profileRouter(
  { profiles, media, members, moderation, discovery },
  { requireAuth, requireApproved }
) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', asyncHandler(async (req, res) => {
    const profile = await profiles.get(req.member.id);
    const photos = await media.forMember(req.member.id);
    res.json(profile ? profiles.selfView(profile, photos) : null);
  }));

  router.put('/', asyncHandler(async (req, res) => {
    const profile = await profiles.upsert(req.member.id, req.body || {});
    const photos = await media.forMember(req.member.id);
    if (req.body?.firstName) {
      await members.update(req.member.id, { displayName: req.body.firstName });
    }
    res.json(profiles.selfView(profile, photos));
  }));

  router.get('/preferences', asyncHandler(async (req, res) => {
    res.json(await profiles.getPreferences(req.member.id));
  }));

  router.put('/preferences', asyncHandler(async (req, res) => {
    res.json(await profiles.updatePreferences(req.member.id, req.body || {}));
  }));

  /**
   * Another member's profile. Blocked in either direction reads as not found —
   * a block is silent, so it must not be detectable by probing.
   */
  router.get('/:memberId', requireApproved, rateLimits.profileReads, asyncHandler(async (req, res) => {
    const targetId = req.params.memberId;
    if (await moderation.isBlocked(req.member.id, targetId)) throw new NotFoundError('Profile not found');

    const target = await members.get(targetId);
    if (!target || target.status !== 'active') throw new NotFoundError('Profile not found');

    const profile = await profiles.get(targetId);
    if (!profile || profile.moderationState !== 'live') throw new NotFoundError('Profile not found');

    const photos = await media.liveForMember(targetId);
    const viewerProfile = await profiles.get(req.member.id);
    res.json(profiles.publicView(profile, target, photos, viewerProfile));
  }));

  return router;
}

module.exports = { profileRouter };
