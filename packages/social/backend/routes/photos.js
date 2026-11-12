'use strict';

/**
 * @fileoverview Photo upload, management and authorised streaming.
 *
 * Nothing under .application/media is served statically. Every byte comes
 * through the GET below, and unauthorised reads answer 404 rather than 403 so
 * the endpoint never confirms that a photo — and therefore a member — exists.
 */

const express = require('express');
const { asyncHandler } = require('./asyncHandler');
const { singleImage } = require('../middleware/upload');
const rateLimits = require('../middleware/rateLimits');
const { NotFoundError } = require('../errors');

function photosRouter({ media, members, moderation, matching, profiles }, { requireAuth }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', asyncHandler(async (req, res) => {
    const photos = await media.forMember(req.member.id);
    res.json(photos.map((p) => ({
      id: p.id,
      isPrimary: p.isPrimary,
      moderationState: p.moderationState,
      uploadedAt: p.uploadedAt
    })));
  }));

  router.post('/', rateLimits.upload, singleImage('photo'), asyncHandler(async (req, res) => {
    const photo = await media.ingest({
      memberId: req.member.id,
      buffer: req.file?.buffer,
      mimetype: req.file?.mimetype
    });
    res.status(201).json({
      id: photo.id, isPrimary: photo.isPrimary, moderationState: photo.moderationState
    });
  }));

  router.put('/:id/primary', asyncHandler(async (req, res) => {
    const photos = await media.setPrimary(req.member.id, req.params.id);
    res.json(photos.map((p) => ({ id: p.id, isPrimary: p.isPrimary, moderationState: p.moderationState })));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    await media.remove(req.member.id, req.params.id);
    res.json({ ok: true });
  }));

  /**
   * Decides, per request, whether this viewer may see this photo. A viewer may
   * see a photo when they own it, when they are staff, or when they may see
   * the owner's profile at all — which means not blocked in either direction,
   * and either matched or mutually discoverable.
   */
  router.get('/:id/:size', rateLimits.profileReads, asyncHandler(async (req, res) => {
    const photo = await media.get(req.params.id);
    if (!photo) throw new NotFoundError('Photo not found');

    let canSeeProfile = false;
    if (photo.memberId !== req.member.id && !members.isStaff(req.member)) {
      const blocked = await moderation.isBlocked(req.member.id, photo.memberId);
      if (!blocked) {
        const owner = await members.get(photo.memberId);
        canSeeProfile = Boolean(owner && owner.status === 'active');
      }
    }

    const allowed = await media.authorizeRead(req.member, photo, { canSeeProfile });
    if (!allowed) throw new NotFoundError('Photo not found');

    const buffer = await media.read(photo.id, req.params.size).catch(() => null);
    if (!buffer) throw new NotFoundError('Photo not found');

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  }));

  return router;
}

module.exports = { photosRouter };
