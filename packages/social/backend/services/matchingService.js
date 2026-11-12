'use strict';

/**
 * @fileoverview Likes, passes, matches and daily allowances.
 *
 * Allowances are counted server-side against a durable per-member per-day
 * record, so they survive a restart and cannot be reset by the client. The
 * remaining count is returned on every action for the UI to render from the
 * same source of truth the server enforces.
 */

const config = require('../config');
const { C, likesShard } = require('./containers');
const { todayIso, nextResetIso, addDays } = require('./utils');
const { UNLIMITED } = require('./entitlementService');
const { ValidationError, NotFoundError, ForbiddenError, AllowanceError, ConflictError } = require('../errors');

function createMatchingService({
  store, members, discovery, entitlements, moderation, notifications, activity, versionedCache, realtime
}) {
  /**
   * Per-member serialisation for the read-modify-write on interactions and
   * allowances. The store's mutex is per container; two likes from the same
   * member land in the same container and would still interleave.
   */
  const memberLocks = new Map();

  function withMemberLock(memberId, task) {
    const previous = memberLocks.get(memberId) || Promise.resolve();
    const next = previous.then(task, task);
    memberLocks.set(memberId, next.catch(() => {}));
    return next;
  }

  async function ensureInteractions(memberId) {
    const existing = await store.findOne(C.INTERACTIONS, (i) => i.memberId === memberId);
    if (existing) return existing;
    return store.create(C.INTERACTIONS, {
      memberId,
      acted: {},
      stats: { given: 0, received: 0, likedBack: 0 }
    });
  }

  async function ensureAllowance(memberId, date) {
    const existing = await store.findOne(
      C.ALLOWANCES,
      (a) => a.memberId === memberId && a.date === date
    );
    if (existing) return existing;
    return store.create(C.ALLOWANCES, { memberId, date, likes: 0, boosts: 0 });
  }

  /** Today's like usage against the tier allowance. */
  async function allowanceState(member) {
    const date = todayIso(config.timezone);
    const limit = await entitlements.allowance(member, 'likesPerDay');
    const record = await ensureAllowance(member.id, date);
    const used = record.likes || 0;
    return {
      limit: limit === UNLIMITED ? null : limit,
      used,
      remaining: limit === UNLIMITED ? null : Math.max(0, limit - used),
      unlimited: limit === UNLIMITED,
      resetsAt: nextResetIso(config.timezone)
    };
  }

  async function assertCanAct(member, targetId) {
    if (member.id === targetId) throw new ValidationError('You cannot act on your own profile');
    const target = await members.get(targetId);
    if (!target || target.status !== 'active') throw new NotFoundError('That member is no longer available');
    if (await moderation.isBlocked(member.id, targetId)) {
      throw new NotFoundError('That member is no longer available');
    }
    return target;
  }

  /**
   * Records a like. A mutual like creates the match and opens the conversation.
   * @param {Object} member the acting member
   * @param {string} targetId
   * @param {string} source deck | browse | liked_you
   */
  async function like(member, targetId, source = 'deck') {
    const target = await assertCanAct(member, targetId);

    return withMemberLock(member.id, async () => {
      const interactions = await ensureInteractions(member.id);
      if (interactions.acted?.[targetId]) {
        throw new ConflictError('You have already acted on this profile', 'already_acted');
      }

      const date = todayIso(config.timezone);
      const limit = await entitlements.allowance(member, 'likesPerDay');
      const allowance = await ensureAllowance(member.id, date);
      if (limit !== UNLIMITED && (allowance.likes || 0) >= limit) {
        throw new AllowanceError('likesPerDay', nextResetIso(config.timezone));
      }

      // Did they already like me? Read before writing, so the reciprocal check
      // sees a like recorded a moment ago by the other member.
      const myShard = likesShard(member.id);
      const theirLike = await store.findOne(
        myShard,
        (l) => l.fromMemberId === targetId && l.toMemberId === member.id && l.action === 'like'
      );

      await store.create(likesShard(targetId), {
        fromMemberId: member.id,
        toMemberId: targetId,
        action: 'like',
        source,
        createdAt: new Date().toISOString()
      });

      await store.mutate(C.INTERACTIONS, interactions.id, (current) => ({
        ...current,
        acted: { ...(current.acted || {}), [targetId]: 'like' },
        stats: {
          ...current.stats,
          given: (current.stats?.given || 0) + 1,
          // Liking someone who already liked you is a like-back — the signal
          // the reciprocity term is built on.
          likedBack: (current.stats?.likedBack || 0) + (theirLike ? 1 : 0)
        }
      }));

      const targetInteractions = await ensureInteractions(targetId);
      await store.mutate(C.INTERACTIONS, targetInteractions.id, (current) => ({
        ...current,
        stats: { ...current.stats, received: (current.stats?.received || 0) + 1 }
      }));

      await store.update(C.ALLOWANCES, allowance.id, { likes: (allowance.likes || 0) + 1 });
      await discovery.consumeCard(member.id, targetId);

      let match = null;
      if (theirLike) {
        match = await createMatch(member, target, source);
      }

      await versionedCache.bump('decks');
      return { matched: Boolean(match), match, allowance: await allowanceState(member) };
    });
  }

  async function pass(member, targetId, source = 'deck') {
    await assertCanAct(member, targetId);
    return withMemberLock(member.id, async () => {
      const interactions = await ensureInteractions(member.id);
      if (interactions.acted?.[targetId]) {
        return { passed: true, allowance: await allowanceState(member) };
      }
      await store.mutate(C.INTERACTIONS, interactions.id, (current) => ({
        ...current,
        acted: { ...(current.acted || {}), [targetId]: 'pass' }
      }));
      await discovery.consumeCard(member.id, targetId);
      await versionedCache.bump('decks');
      return { passed: true, allowance: await allowanceState(member) };
    });
  }

  /** Creates the match, then both sides of the conversation read model. */
  async function createMatch(a, b, source) {
    const existing = await findBetween(a.id, b.id);
    if (existing && existing.state === 'active') return existing;

    const now = new Date();
    const match = await store.create(C.MATCHES, {
      memberIds: [a.id, b.id],
      source,
      state: 'active',
      createdAt: now.toISOString(),
      expiresAt: addDays(now, config.matchExpiryDays).toISOString(),
      firstMessageAt: null,
      reminderSentAt: null,
      unmatchedBy: null,
      unmatchedAt: null
    });

    await store.create(C.CONVERSATIONS, {
      matchId: match.id,
      memberIds: [a.id, b.id],
      state: 'active',
      lastMessageAt: null,
      lastMessagePreview: null,
      lastSenderId: null,
      unread: { [a.id]: 0, [b.id]: 0 },
      createdAt: now.toISOString()
    });

    await Promise.all([
      notifications.notify(a.id, 'match.created', { matchId: match.id, withMemberId: b.id }),
      notifications.notify(b.id, 'match.created', { matchId: match.id, withMemberId: a.id })
    ]);

    realtime?.toMember(a.id, 'match:created', { matchId: match.id });
    realtime?.toMember(b.id, 'match:created', { matchId: match.id });

    await activity.log('match.created', `${a.id} matched ${b.id}`, {
      memberId: a.id, targetId: b.id, matchId: match.id, source
    });
    await versionedCache.bump('conversations');
    return match;
  }

  async function findBetween(a, b) {
    return store.findOne(
      C.MATCHES,
      (m) => m.memberIds.includes(a) && m.memberIds.includes(b)
    );
  }

  async function get(matchId) {
    return store.get(C.MATCHES, matchId);
  }

  /**
   * The authorisation check every message path runs. Both REST and socket call
   * this; neither trusts the other.
   */
  async function assertParticipant(memberId, matchId) {
    const match = await get(matchId);
    if (!match) throw new NotFoundError('Conversation not found');
    if (!match.memberIds.includes(memberId)) {
      throw new ForbiddenError('Conversation not found', 'not_a_participant');
    }
    if (match.state !== 'active') {
      throw new ForbiddenError('This conversation is closed', 'match_closed');
    }
    const otherId = match.memberIds.find((id) => id !== memberId);
    if (await moderation.isBlocked(memberId, otherId)) {
      throw new ForbiddenError('This conversation is closed', 'match_closed');
    }
    return match;
  }

  async function forMember(memberId) {
    const matches = await store.findAll(
      C.MATCHES,
      (m) => m.memberIds.includes(memberId) && m.state === 'active'
    );
    return matches;
  }

  async function unmatch(memberId, matchId, { reason } = {}) {
    const match = await get(matchId);
    if (!match || !match.memberIds.includes(memberId)) throw new NotFoundError('Conversation not found');
    if (match.state !== 'active') return match;

    const updated = await store.update(C.MATCHES, matchId, {
      state: 'unmatched',
      unmatchedBy: memberId,
      unmatchedAt: new Date().toISOString(),
      unmatchReason: reason || null
    });

    const conversation = await store.findOne(C.CONVERSATIONS, (c) => c.matchId === matchId);
    if (conversation) {
      await store.update(C.CONVERSATIONS, conversation.id, {
        state: 'unmatched', closedAt: new Date().toISOString()
      });
    }

    const otherId = match.memberIds.find((id) => id !== memberId);
    realtime?.toMember(otherId, 'match:closed', { matchId });
    realtime?.toMember(memberId, 'match:closed', { matchId });

    await activity.log('match.unmatched', `${memberId} unmatched ${matchId}`, {
      memberId, targetId: otherId, matchId
    });
    await versionedCache.bump('conversations');
    return updated;
  }

  /**
   * Expires matches with no first message, and sends the reminder that
   * precedes it. Idempotent — safe to run on any cadence or after a restart.
   */
  async function sweepExpiries() {
    const active = await store.findAll(C.MATCHES, (m) => m.state === 'active' && !m.firstMessageAt);
    const now = Date.now();
    let expired = 0;
    let reminded = 0;

    for (const match of active) {
      const age = (now - new Date(match.createdAt)) / 864e5;
      if (age >= config.matchExpiryDays) {
        await store.update(C.MATCHES, match.id, {
          state: 'expired', expiredAt: new Date().toISOString()
        });
        const conversation = await store.findOne(C.CONVERSATIONS, (c) => c.matchId === match.id);
        if (conversation) await store.update(C.CONVERSATIONS, conversation.id, { state: 'expired' });
        for (const id of match.memberIds) realtime?.toMember(id, 'match:closed', { matchId: match.id });
        expired += 1;
      } else if (age >= config.matchReminderDays && !match.reminderSentAt) {
        for (const id of match.memberIds) {
          await notifications.notify(id, 'match.expiring', { matchId: match.id }).catch(() => {});
        }
        await store.update(C.MATCHES, match.id, { reminderSentAt: new Date().toISOString() });
        reminded += 1;
      }
    }

    // Reconcile matches whose conversation write did not land — there are no
    // transactions, so the second write is repaired here rather than assumed.
    const activeMatches = await store.findAll(C.MATCHES, (m) => m.state === 'active');
    const conversations = await store.list(C.CONVERSATIONS);
    const known = new Set(conversations.map((c) => c.matchId));
    let repaired = 0;
    for (const match of activeMatches) {
      if (known.has(match.id)) continue;
      await store.create(C.CONVERSATIONS, {
        matchId: match.id,
        memberIds: match.memberIds,
        state: 'active',
        lastMessageAt: null,
        lastMessagePreview: null,
        lastSenderId: null,
        unread: Object.fromEntries(match.memberIds.map((id) => [id, 0])),
        createdAt: match.createdAt
      });
      repaired += 1;
    }

    if (expired || repaired) await versionedCache.bump('conversations');
    return { expired, reminded, repaired };
  }

  return {
    like, pass, get, findBetween, assertParticipant, forMember, unmatch,
    createMatch, sweepExpiries, allowanceState, ensureInteractions
  };
}

module.exports = { createMatchingService };
