'use strict';

/**
 * @fileoverview Member records, status transitions and roles.
 *
 * Credentials live in the platform authservice (bcrypt, unique email); this
 * service owns everything else about a person — status, side, badges, city,
 * tier reference. The link between the two is the normalised email.
 */

const { C } = require('./containers');
const { sha256, normalizeEmail, isInLaunchCity } = require('./utils');
const { NotFoundError, ConflictError, ForbiddenError } = require('../errors');

/**
 * pending        registered, application not yet submitted
 * in_review      application submitted, awaiting a reviewer
 * interview      interview scheduled or awaiting outcome
 * info_requested reviewer asked for more, ball is with the applicant
 * waitlisted     good enough, no capacity (or outside the launch city)
 * declined       rejected; may appeal after the configured window
 * active         approved and (if male) subscribed
 * paused         self-hidden, conversations retained
 * dormant        subscription lapsed; reads conversations, nothing else
 * suspended      moderation hold, time-boxed
 * banned         permanent
 * deleted        tombstone pending the retention window
 */
const STATUS = {
  PENDING: 'pending',
  IN_REVIEW: 'in_review',
  INTERVIEW: 'interview',
  INFO_REQUESTED: 'info_requested',
  WAITLISTED: 'waitlisted',
  DECLINED: 'declined',
  ACTIVE: 'active',
  PAUSED: 'paused',
  DORMANT: 'dormant',
  SUSPENDED: 'suspended',
  BANNED: 'banned',
  DELETED: 'deleted'
};

/** Statuses that may hold a session and use the member API at all. */
const SIGNED_IN_STATUSES = new Set([
  STATUS.PENDING, STATUS.IN_REVIEW, STATUS.INTERVIEW, STATUS.INFO_REQUESTED,
  STATUS.WAITLISTED, STATUS.DECLINED, STATUS.ACTIVE, STATUS.PAUSED, STATUS.DORMANT
]);

function createMemberService({ store, versionedCache, activity }) {
  async function get(id) {
    if (!id) return null;
    return store.get(C.MEMBERS, id);
  }

  async function getOrThrow(id) {
    const member = await get(id);
    if (!member) throw new NotFoundError('Member not found');
    return member;
  }

  async function getByEmail(email) {
    const normalized = normalizeEmail(email);
    return store.findOne(C.MEMBERS, (m) => m.email === normalized);
  }

  /** Whole-member projection, cached — the deck and the inbox both read it. */
  async function all() {
    return versionedCache.remember('members', 'all', () => store.list(C.MEMBERS));
  }

  async function create({ email, side, displayName, city, role = 'member' }) {
    const normalized = normalizeEmail(email);
    const existing = await getByEmail(normalized);
    if (existing) throw new ConflictError('An account with that email already exists', 'email_taken');

    const emailHash = sha256(normalized);
    const banned = await store.findOne(C.BANNED_IDENTITIES, (b) => b.emailHash === emailHash);
    if (banned) throw new ForbiddenError('This account cannot be created', 'identity_banned');

    const member = await store.create(C.MEMBERS, {
      email: normalized,
      emailHash,
      side: side || null,
      displayName: displayName || null,
      role,
      status: STATUS.PENDING,
      tier: null,
      badges: [],
      city: city || null,
      inLaunchCity: city ? isInLaunchCity(city) : null,
      flags: {},
      incognito: false,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      lastActiveAt: new Date().toISOString(),
      suspendedUntil: null,
      banReason: null,
      pausedAt: null,
      deletedAt: null
    });

    await versionedCache.bump('members');
    await activity.log('member.created', `${normalized} registered`, { memberId: member.id, side });
    return member;
  }

  async function update(id, patch) {
    const updated = await store.update(C.MEMBERS, id, patch);
    if (!updated) throw new NotFoundError('Member not found');
    await versionedCache.bump('members');
    return updated;
  }

  async function setStatus(id, status, meta = {}) {
    const member = await getOrThrow(id);
    const patch = { status };
    if (status === STATUS.ACTIVE && !member.approvedAt) patch.approvedAt = new Date().toISOString();
    if (status === STATUS.PAUSED) patch.pausedAt = new Date().toISOString();
    if (status !== STATUS.PAUSED) patch.pausedAt = null;
    if (status === STATUS.SUSPENDED) patch.suspendedUntil = meta.until || null;
    if (status === STATUS.BANNED) patch.banReason = meta.reason || null;

    const updated = await update(id, patch);
    await activity.log('member.status', `${member.email} → ${status}`, {
      memberId: id, from: member.status, to: status, ...meta
    });
    return updated;
  }

  /**
   * The authoritative record of a grant — evidence type, granting reviewer,
   * date — is the verifications container. The date is mirrored here as well
   * because every profile shows it beside the badge, and reading the audit
   * container once per card would put a query behind every deck.
   *
   * @param {string} id
   * @param {string} badge
   * @param {string} [grantedAt] ISO date, passed by the caller that wrote the
   *   audit record so the two cannot disagree.
   */
  async function grantBadge(id, badge, grantedAt) {
    const member = await getOrThrow(id);
    if (member.badges.includes(badge)) return member;
    return update(id, {
      badges: [...member.badges, badge],
      badgeGrantedAt: { ...(member.badgeGrantedAt || {}), [badge]: grantedAt || new Date().toISOString() }
    });
  }

  async function revokeBadge(id, badge) {
    const member = await getOrThrow(id);
    const dates = { ...(member.badgeGrantedAt || {}) };
    delete dates[badge];
    return update(id, {
      badges: member.badges.filter((b) => b !== badge),
      badgeGrantedAt: dates
    });
  }

  async function touch(id) {
    // Deliberately does not bump the members cache — last-active drifting by a
    // few seconds is worth far more than flushing the projection on every request.
    await store.update(C.MEMBERS, id, { lastActiveAt: new Date().toISOString() });
  }

  /**
   * True when the member may use the product: approved, not paused, not
   * suspended, not banned. Every gated route funnels through this.
   */
  function isActive(member) {
    if (!member) return false;
    if (member.status === STATUS.SUSPENDED) {
      // A suspension whose clock has run out is no longer a suspension.
      if (member.suspendedUntil && new Date(member.suspendedUntil) < new Date()) return true;
      return false;
    }
    return member.status === STATUS.ACTIVE;
  }

  function canSignIn(member) {
    return Boolean(member) && SIGNED_IN_STATUSES.has(member.status);
  }

  function isStaff(member) {
    return Boolean(member) && ['moderator', 'admin'].includes(member.role);
  }

  /** Only ever exposes fields the member themself is allowed to see. */
  function selfView(member, entitlements = null) {
    if (!member) return null;
    return {
      id: member.id,
      email: member.email,
      side: member.side,
      displayName: member.displayName,
      role: member.role,
      status: member.status,
      tier: member.tier,
      badges: member.badges,
      badgesGrantedAt: member.badgeGrantedAt || {},
      city: member.city,
      inLaunchCity: member.inLaunchCity,
      incognito: member.incognito,
      createdAt: member.createdAt,
      approvedAt: member.approvedAt,
      suspendedUntil: member.suspendedUntil,
      entitlements
    };
  }

  return {
    get, getOrThrow, getByEmail, all, create, update, setStatus,
    grantBadge, revokeBadge, touch, isActive, canSignIn, isStaff, selfView,
    STATUS
  };
}

module.exports = { createMemberService, STATUS };
