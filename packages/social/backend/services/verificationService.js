'use strict';

/**
 * @fileoverview Verification badges and their evidence.
 *
 * Means standing is established by **interview**, not documents — no financial
 * paperwork is collected, so there is no document retention burden to manage.
 * The liveness selfie is the one biometric artefact held, and it is purged on
 * the schedule in .docs §9.
 *
 * A badge always records what backed it and who granted it. Badges are never
 * granted for payment.
 */

const sharp = require('sharp');
const config = require('../config');
const { C } = require('./containers');
const { ValidationError, NotFoundError } = require('../errors');

const BADGES = {
  IDENTITY: 'identity',
  PHOTO: 'photo',
  MEANS: 'means',
  PROFESSIONAL: 'professional'
};

const EVIDENCE = {
  LIVENESS: 'liveness_selfie',
  INTERVIEW: 'interview',
  REVIEWER: 'reviewer_assessment',
  EMPLOYER: 'employer_confirmation'
};

function createVerificationService({ store, filing, members, activity, versionedCache }) {
  const livenessKey = (memberId, id) => `liveness/${memberId}/${id}.jpg`;

  /**
   * Stores the prompted-pose capture used to match against profile photos.
   * Re-encoded like any other upload, so EXIF never lands on disk.
   */
  async function storeLiveness({ memberId, buffer, mimetype }) {
    if (!buffer?.length) throw new ValidationError('No image received');
    if (!config.media.acceptedMime.includes(mimetype)) {
      throw new ValidationError('That image format is not supported');
    }
    let canonical;
    try {
      canonical = await sharp(buffer, { failOn: 'error' }).rotate().resize({ width: 720 }).jpeg({ quality: 88 }).toBuffer();
    } catch {
      throw new ValidationError('That file is not a readable image');
    }

    const existing = await store.findOne(C.VERIFICATIONS, (v) => v.memberId === memberId && v.type === 'liveness' && !v.purgedAt);
    if (existing) {
      await filing.delete(livenessKey(memberId, existing.id)).catch(() => {});
      await store.remove(C.VERIFICATIONS, existing.id);
    }

    const record = await store.create(C.VERIFICATIONS, {
      memberId,
      type: 'liveness',
      capturedAt: new Date().toISOString(),
      matchedAt: null,
      matchedBy: null,
      purgedAt: null
    });
    await filing.create(livenessKey(memberId, record.id), canonical);
    return record;
  }

  async function livenessFor(memberId) {
    return store.findOne(C.VERIFICATIONS, (v) => v.memberId === memberId && v.type === 'liveness' && !v.purgedAt);
  }

  async function readLiveness(id, memberId) {
    return filing.read(livenessKey(memberId, id));
  }

  /** Deletes the biometric artefact, keeping only the fact of the check. */
  async function purgeLiveness(record) {
    await filing.delete(livenessKey(record.memberId, record.id)).catch(() => {});
    return store.update(C.VERIFICATIONS, record.id, { purgedAt: new Date().toISOString() });
  }

  async function grant(memberId, badge, { evidence, reviewerId, note } = {}) {
    if (!Object.values(BADGES).includes(badge)) throw new ValidationError('Unknown badge');
    const member = await members.getOrThrow(memberId);

    const grantedAt = new Date().toISOString();

    await store.create(C.VERIFICATIONS, {
      memberId,
      type: 'badge',
      badge,
      evidence: evidence || EVIDENCE.REVIEWER,
      grantedBy: reviewerId || null,
      note: note || null,
      grantedAt,
      revokedAt: null
    });

    // Same timestamp as the audit record — the profile shows this date as the
    // evidence behind the badge, so the two must not drift.
    await members.grantBadge(memberId, badge, grantedAt);
    await activity.log('verification.granted', `${badge} granted to ${member.email}`, {
      memberId: reviewerId, targetId: memberId, badge, evidence
    });
    await versionedCache.bumpAll(['members', 'profiles']);
    return badge;
  }

  async function revoke(memberId, badge, { reviewerId, reason } = {}) {
    const member = await members.getOrThrow(memberId);
    const grants = await store.findAll(
      C.VERIFICATIONS,
      (v) => v.memberId === memberId && v.type === 'badge' && v.badge === badge && !v.revokedAt
    );
    for (const grant of grants) {
      await store.update(C.VERIFICATIONS, grant.id, { revokedAt: new Date().toISOString(), revokeReason: reason || null });
    }
    await members.revokeBadge(memberId, badge);
    await activity.log('verification.revoked', `${badge} revoked from ${member.email}`, {
      memberId: reviewerId, targetId: memberId, badge, reason
    });
    await versionedCache.bumpAll(['members', 'profiles']);
    return badge;
  }

  async function history(memberId) {
    const records = await store.findAll(C.VERIFICATIONS, (v) => v.memberId === memberId);
    return records.sort((a, b) => new Date(b.grantedAt || b.capturedAt) - new Date(a.grantedAt || a.capturedAt));
  }

  /**
   * Badges an approval grants. Identity and photo come from the liveness match
   * every applicant completes; means comes only from a passed interview.
   */
  function badgesForApproval({ side, interviewPassed, employerConfirmed }) {
    const badges = [
      { badge: BADGES.IDENTITY, evidence: EVIDENCE.LIVENESS },
      { badge: BADGES.PHOTO, evidence: EVIDENCE.LIVENESS }
    ];
    if (side === 'male' && interviewPassed) {
      badges.push({ badge: BADGES.MEANS, evidence: EVIDENCE.INTERVIEW });
    }
    if (employerConfirmed) {
      badges.push({ badge: BADGES.PROFESSIONAL, evidence: EVIDENCE.EMPLOYER });
    }
    return badges;
  }

  return {
    storeLiveness, livenessFor, readLiveness, purgeLiveness,
    grant, revoke, history, badgesForApproval, BADGES, EVIDENCE
  };
}

module.exports = { createVerificationService, BADGES, EVIDENCE };
