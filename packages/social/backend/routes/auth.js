'use strict';

/**
 * @fileoverview Registration, sign-in, sign-out and session management.
 *
 * Every failure path returns the same shape and the same timing-insensitive
 * message, so these endpoints cannot be used to enumerate accounts.
 */

const express = require('express');
const { asyncHandler } = require('./asyncHandler');
const rateLimits = require('../middleware/rateLimits');
const { ValidationError } = require('../errors');

function authRouter({ auth, members, entitlements, profiles, applications, sessionStore, activity }) {
  const router = express.Router();

  router.post('/register', rateLimits.auth, asyncHandler(async (req, res) => {
    const { email, password, fullName, side, city } = req.body || {};
    const member = await auth.register({ email, password, fullName, side, city });

    // Seed the profile with what they already told us, so the application does
    // not open with fields they have just filled in sitting empty.
    await profiles.upsert(member.id, {
      firstName: String(fullName).trim().split(/\s+/)[0],
      city
    }).catch(() => {});

    req.session.memberId = member.id;
    res.status(201).json({
      member: members.selfView(member),
      next: 'apply'
    });
  }));

  router.post('/login', rateLimits.auth, asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw new ValidationError('Enter your email and password');
    const member = await auth.login(email, password);

    // A fresh session id on privilege change defeats session fixation.
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.memberId = member.id;

    const { entitlements: allowed, tier } = await entitlements.resolve(member);
    res.json({ member: { ...members.selfView(member, allowed), tier } });
  }));

  router.post('/logout', asyncHandler(async (req, res) => {
    const memberId = req.session?.memberId;
    if (memberId) await activity.log('member.signed_out', 'signed out', { memberId });
    req.session.destroy(() => {
      res.clearCookie('exclusivity.sid');
      res.json({ ok: true });
    });
  }));

  /** The client's boot call: who am I, what may I do, what should I see next. */
  router.get('/me', asyncHandler(async (req, res) => {
    const memberId = req.session?.memberId;
    if (!memberId) return res.status(200).json({ member: null });

    const member = await members.get(memberId);
    if (!member) {
      req.session.destroy(() => {});
      return res.status(200).json({ member: null });
    }

    const { entitlements: allowed, tier } = await entitlements.resolve(member);
    const application = await applications.forMember(member.id);
    const profile = await profiles.get(member.id);

    return res.json({
      member: { ...members.selfView(member, allowed), tier },
      application: application
        ? {
          id: application.id,
          state: application.state,
          step: application.step,
          decision: application.decision,
          interview: application.interview,
          submittedAt: application.submittedAt
        }
        : null,
      hasProfile: Boolean(profile),
      next: nextStepFor(member, application)
    });
  }));

  /** Where the client should land, decided server-side from real state. */
  function nextStepFor(member, application) {
    if (members.isStaff(member)) return 'admin';
    switch (member.status) {
      case 'pending': return application?.state === 'draft' ? 'apply' : 'apply';
      case 'in_review': return 'status';
      case 'interview': return 'status';
      case 'info_requested': return 'apply';
      case 'waitlisted': return 'status';
      case 'declined': return 'status';
      case 'dormant': return 'membership';
      case 'paused': return 'settings';
      case 'suspended': return 'status';
      case 'active': return 'discover';
      default: return 'status';
    }
  }

  router.post('/password', rateLimits.auth, asyncHandler(async (req, res) => {
    const memberId = req.session?.memberId;
    if (!memberId) return res.status(401).json({ error: 'Sign in to continue', code: 'auth_required' });
    const member = await members.getOrThrow(memberId);
    await auth.changePassword(member, {
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword
    });

    // Changing a password signs out every other device.
    await new Promise((resolve) => sessionStore.destroyForMember(member.id, () => resolve()));
    return res.json({ ok: true, signedOutEverywhere: true });
  }));

  router.delete('/sessions', asyncHandler(async (req, res) => {
    const memberId = req.session?.memberId;
    if (!memberId) return res.status(401).json({ error: 'Sign in to continue', code: 'auth_required' });
    await new Promise((resolve) => sessionStore.destroyForMember(memberId, () => resolve()));
    return res.json({ ok: true });
  }));

  return router;
}

module.exports = { authRouter };
