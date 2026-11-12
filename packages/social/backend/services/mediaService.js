'use strict';

/**
 * @fileoverview Photo ingest, derivation and authorised access.
 *
 * The most security-sensitive path in the application. Two rules hold
 * throughout:
 *
 *  - Re-encoding through sharp is a security control, not a resize. It strips
 *    EXIF (including GPS) and neutralises polyglot files that pass a MIME
 *    check but carry a payload.
 *  - Nothing under .application/media is served statically. Every byte goes
 *    through authorizeRead().
 */

const sharp = require('sharp');
const config = require('../config');
const { C } = require('./containers');
const { sha256 } = require('./utils');
const { ValidationError, NotFoundError, ForbiddenError } = require('../errors');

const MODERATION = { PENDING: 'pending', LIVE: 'live', REJECTED: 'rejected' };

function createMediaService({ filing, store, activity, versionedCache }) {
  const originalKey = (memberId, photoId) => `originals/${memberId}/${photoId}.jpg`;
  const derivedKey = (size, photoId) => `derived/${size}/${photoId}.jpg`;

  /**
   * Ingests one upload: validate, re-encode, derive sizes, hash, persist.
   * @param {{memberId: string, buffer: Buffer, mimetype: string}} input
   */
  async function ingest({ memberId, buffer, mimetype }) {
    if (!buffer || !buffer.length) throw new ValidationError('No image received');
    if (!config.media.acceptedMime.includes(mimetype)) {
      throw new ValidationError('That image format is not supported');
    }
    if (buffer.length > config.media.maxUploadBytes) {
      throw new ValidationError('That image is too large');
    }

    let image;
    let metadata;
    try {
      // Reading metadata is also the magic-byte check — a file that claims
      // image/jpeg but is not an image fails here, before anything is stored.
      image = sharp(buffer, { failOn: 'error' });
      metadata = await image.metadata();
    } catch (err) {
      throw new ValidationError('That file is not a readable image');
    }
    if (!metadata.width || !metadata.height) throw new ValidationError('That file is not a readable image');
    if (metadata.width < 400 || metadata.height < 400) {
      throw new ValidationError('Photos must be at least 400×400');
    }

    const existing = await store.findAll(C.PHOTOS, (p) => p.memberId === memberId && !p.deletedAt);
    if (existing.length >= config.media.maxPhotos) {
      throw new ValidationError(`You can have at most ${config.media.maxPhotos} photos`);
    }

    // rotate() with no argument applies the EXIF orientation before the
    // metadata is discarded, so the stored image is upright.
    const canonical = await sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer();
    const contentHash = sha256(canonical);

    const banned = await store.findOne(C.BANNED_IDENTITIES, (b) => b.photoHashes?.includes(contentHash));
    if (banned) throw new ForbiddenError('This image cannot be uploaded', 'identity_banned');

    const duplicate = await store.findOne(
      C.PHOTOS,
      (p) => p.contentHash === contentHash && p.memberId !== memberId && !p.deletedAt
    );

    const photo = await store.create(C.PHOTOS, {
      memberId,
      contentHash,
      width: metadata.width,
      height: metadata.height,
      moderationState: MODERATION.PENDING,
      isPrimary: existing.length === 0,
      uploadedAt: new Date().toISOString(),
      deletedAt: null,
      flags: duplicate ? ['duplicate_of_other_member'] : []
    });

    await filing.create(originalKey(memberId, photo.id), canonical);

    for (const [name, width] of Object.entries(config.media.sizes)) {
      const derived = await sharp(canonical)
        .resize({ width, height: width, fit: 'cover', position: 'attention' })
        .jpeg({ quality: name === 'thumb' ? 80 : 88 })
        .toBuffer();
      await filing.create(derivedKey(name, photo.id), derived);
    }

    await activity.log('photo.uploaded', `photo ${photo.id} uploaded`, {
      memberId, photoId: photo.id, duplicate: Boolean(duplicate)
    });
    await versionedCache.bump('moderation');
    return photo;
  }

  async function get(photoId) {
    return store.get(C.PHOTOS, photoId);
  }

  async function forMember(memberId, { includePending = true } = {}) {
    const photos = await store.findAll(C.PHOTOS, (p) => p.memberId === memberId && !p.deletedAt);
    const visible = includePending ? photos : photos.filter((p) => p.moderationState === MODERATION.LIVE);
    return visible.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0)
      || new Date(a.uploadedAt) - new Date(b.uploadedAt));
  }

  /** Only live photos are ever shown to another member. */
  async function liveForMember(memberId) {
    return forMember(memberId, { includePending: false });
  }

  /**
   * Decides whether `viewer` may read `photo`. Callers translate a false into
   * a 404 rather than a 403 — refusing with "not found" avoids confirming that
   * a photo (and therefore a member) exists.
   */
  async function authorizeRead(viewer, photo, { canSeeProfile }) {
    if (!photo || photo.deletedAt) return false;
    if (!viewer) return false;
    if (photo.memberId === viewer.id) return true;
    if (['moderator', 'admin'].includes(viewer.role)) {
      await activity.log('admin.photo_viewed', `${viewer.email} viewed photo ${photo.id}`, {
        memberId: viewer.id, targetId: photo.memberId, photoId: photo.id
      });
      return true;
    }
    if (photo.moderationState !== MODERATION.LIVE) return false;
    return canSeeProfile === true;
  }

  async function read(photoId, size) {
    const name = config.media.sizes[size] ? size : 'card';
    return filing.read(derivedKey(name, photoId));
  }

  async function setPrimary(memberId, photoId) {
    const photos = await forMember(memberId);
    const target = photos.find((p) => p.id === photoId);
    if (!target) throw new NotFoundError('Photo not found');
    if (target.moderationState !== MODERATION.LIVE) {
      throw new ValidationError('A photo must clear moderation before it can be your main photo');
    }
    for (const photo of photos) {
      if (photo.isPrimary !== (photo.id === photoId)) {
        await store.update(C.PHOTOS, photo.id, { isPrimary: photo.id === photoId });
      }
    }
    await versionedCache.bump('profiles');
    return forMember(memberId);
  }

  async function moderate(photoId, state, { reviewerId, reason } = {}) {
    const photo = await store.get(C.PHOTOS, photoId);
    if (!photo) throw new NotFoundError('Photo not found');
    const updated = await store.update(C.PHOTOS, photoId, {
      moderationState: state,
      moderatedAt: new Date().toISOString(),
      moderatedBy: reviewerId || null,
      moderationReason: reason || null
    });
    await activity.log('moderation.photo', `photo ${photoId} → ${state}`, {
      memberId: reviewerId, targetId: photo.memberId, photoId, state, reason
    });
    await versionedCache.bumpAll(['profiles', 'moderation']);
    return updated;
  }

  async function remove(memberId, photoId) {
    const photo = await store.get(C.PHOTOS, photoId);
    if (!photo || photo.memberId !== memberId) throw new NotFoundError('Photo not found');
    await store.update(C.PHOTOS, photoId, { deletedAt: new Date().toISOString(), isPrimary: false });
    await destroyBinaries(photo);
    await versionedCache.bump('profiles');
    return true;
  }

  /** Removes every stored byte for a photo. Used by delete and the retention sweep. */
  async function destroyBinaries(photo) {
    const keys = [originalKey(photo.memberId, photo.id),
      ...Object.keys(config.media.sizes).map((size) => derivedKey(size, photo.id))];
    for (const key of keys) {
      await filing.delete(key).catch(() => {});
    }
  }

  async function pendingQueue() {
    const photos = await store.findAll(C.PHOTOS, (p) => p.moderationState === MODERATION.PENDING && !p.deletedAt);
    return photos.sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));
  }

  return {
    ingest, get, forMember, liveForMember, authorizeRead, read,
    setPrimary, moderate, remove, destroyBinaries, pendingQueue, MODERATION
  };
}

module.exports = { createMediaService, MODERATION };
