'use strict';

/**
 * @fileoverview Authorisation gates.
 *
 * Three independent checks that compose and are never substituted for each
 * other. Resource-level checks (is this member in this match, may they see
 * this photo) live in the domain services — middleware cannot know them.
 */

const { AuthError, ForbiddenError, EntitlementError } = require('../errors');

function createAuthMiddleware({ members, entitlements }) {
  /** Resolves the session into `req.member`, or 401. */
  function requireAuth(req, res, next) {
    const memberId = req.session?.memberId;
    if (!memberId) return next(new AuthError());

    members.get(memberId)
      .then((member) => {
        if (!member) {
          req.session.destroy(() => {});
          return next(new AuthError());
        }
        if (member.status === 'banned') {
          req.session.destroy(() => {});
          return next(new ForbiddenError('This account has been closed', 'account_closed'));
        }
        if (member.status === 'deleted') {
          req.session.destroy(() => {});
          return next(new AuthError());
        }
        req.member = member;
        // Fire-and-forget: last-active is not worth an await on every request.
        members.touch(member.id).catch(() => {});
        return next();
      })
      .catch(next);
  }

  /** Blocks anyone not through the door: pending, waitlisted, dormant, suspended. */
  function requireApproved(req, res, next) {
    const member = req.member;
    if (!member) return next(new AuthError());
    if (members.isStaff(member)) return next();
    if (!members.isActive(member)) {
      return next(new ForbiddenError(
        statusMessage(member.status),
        `status_${member.status}`
      ));
    }
    return next();
  }

  function statusMessage(status) {
    const map = {
      pending: 'Finish your application first',
      in_review: 'Your application is being reviewed',
      interview: 'Your introduction call is scheduled',
      info_requested: 'We need a little more information',
      waitlisted: "You're on the waitlist",
      declined: 'Your application was not successful',
      paused: 'Your account is paused',
      dormant: 'Choose a membership to continue',
      suspended: 'Your account is suspended'
    };
    return map[status] || 'Your account cannot access this yet';
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.member) return next(new AuthError());
      if (!roles.includes(req.member.role)) {
        // 404-shaped refusal: the console should not confirm it exists.
        return next(new ForbiddenError('Not found', 'forbidden'));
      }
      return next();
    };
  }

  /**
   * Tier gate. Resolved from live subscription state on every request — the
   * client never decides what a tier permits.
   */
  function requireEntitlement(key) {
    return (req, res, next) => {
      if (!req.member) return next(new AuthError());
      entitlements.resolve(req.member)
        .then(({ tier, entitlements: allowed }) => {
          if (!allowed[key]) return next(new EntitlementError(key, tier));
          req.entitlements = allowed;
          req.tier = tier;
          return next();
        })
        .catch(next);
    };
  }

  return { requireAuth, requireApproved, requireRole, requireEntitlement };
}

module.exports = { createAuthMiddleware };
