'use strict';

/**
 * @fileoverview Blocks, reports, the moderation queue and enforcement.
 *
 * Blocking is the one operation in the app that is never cached through the
 * generation counter — a stale block is a safety failure, not a stale read.
 * The block set is rebuilt from disk on demand and updated synchronously.
 */

const config = require('../config');
const { C } = require('./containers');
const { sha256, todayIso } = require('./utils');
const scanner = require('./contentScanner');
const { ValidationError, NotFoundError, ConflictError, ForbiddenError } = require('../errors');

const REPORT_CATEGORIES = ['fake_profile', 'harassment', 'solicitation', 'offensive_content',
  'underage', 'scam', 'other'];

const ACTIONS = ['dismiss', 'warn', 'remove_content', 'suspend', 'ban'];

function createModerationService({ store, members, media, profiles, activity, versionedCache, notifications }) {
  // ---- blocks ------------------------------------------------------------

  async function block(memberId, targetId, { reason } = {}) {
    if (memberId === targetId) throw new ValidationError('You cannot block yourself');
    await members.getOrThrow(targetId);
    const existing = await store.findOne(
      C.BLOCKS,
      (b) => b.fromMemberId === memberId && b.toMemberId === targetId
    );
    if (existing) return existing;

    const record = await store.create(C.BLOCKS, {
      fromMemberId: memberId,
      toMemberId: targetId,
      reason: reason || null,
      createdAt: new Date().toISOString()
    });
    await activity.log('moderation.block', `${memberId} blocked ${targetId}`, {
      memberId, targetId
    });
    await versionedCache.bump('decks');
    return record;
  }

  async function unblock(memberId, targetId) {
    const existing = await store.findOne(
      C.BLOCKS,
      (b) => b.fromMemberId === memberId && b.toMemberId === targetId
    );
    if (!existing) return false;
    await store.remove(C.BLOCKS, existing.id);
    await versionedCache.bump('decks');
    return true;
  }

  /**
   * Every member invisible to `memberId`, in either direction — blocking is
   * silent and mutual in effect.
   */
  async function blockedSet(memberId) {
    const all = await store.list(C.BLOCKS);
    const set = new Set();
    for (const record of all) {
      if (record.fromMemberId === memberId) set.add(record.toMemberId);
      if (record.toMemberId === memberId) set.add(record.fromMemberId);
    }
    return set;
  }

  async function blockedBy(memberId) {
    const records = await store.findAll(C.BLOCKS, (b) => b.fromMemberId === memberId);
    return records;
  }

  async function isBlocked(a, b) {
    const record = await store.findOne(
      C.BLOCKS,
      (x) => (x.fromMemberId === a && x.toMemberId === b) || (x.fromMemberId === b && x.toMemberId === a)
    );
    return Boolean(record);
  }

  // ---- reports -----------------------------------------------------------

  async function report(memberId, { targetId, category, note, messageId, matchId }) {
    if (!REPORT_CATEGORIES.includes(category)) throw new ValidationError('Invalid report category');
    if (memberId === targetId) throw new ValidationError('You cannot report yourself');
    await members.getOrThrow(targetId);

    const today = todayIso();
    const todaysReports = await store.findAll(
      C.REPORTS,
      (r) => r.reporterId === memberId && r.createdAt.startsWith(today)
    );
    if (todaysReports.length >= config.limits.reportsPerDay) {
      throw new ConflictError('You have filed too many reports today', 'report_limit');
    }

    const record = await store.create(C.REPORTS, {
      reporterId: memberId,
      targetId,
      category,
      note: note || null,
      messageId: messageId || null,
      matchId: matchId || null,
      state: 'open',
      priority: ['underage', 'harassment', 'solicitation', 'scam'].includes(category) ? 1 : 2,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolution: null
    });

    // The reported member disappears from the reporter's discovery immediately,
    // before any moderator has looked at it.
    await block(memberId, targetId, { reason: `report:${category}` });

    await activity.log('moderation.report', `${category} reported against ${targetId}`, {
      memberId, targetId, category, reportId: record.id
    });
    await versionedCache.bump('moderation');
    return record;
  }

  /** Machine-raised flags enter the same queue as member reports. */
  async function flag({ targetId, category, note, matchId, messageId, source = 'automated' }) {
    const record = await store.create(C.REPORTS, {
      reporterId: null,
      targetId,
      category,
      note: note || null,
      messageId: messageId || null,
      matchId: matchId || null,
      source,
      state: 'open',
      priority: 1,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolution: null
    });
    await activity.log('moderation.flag', `${category} flagged on ${targetId}`, {
      targetId, category, reportId: record.id, source
    });
    await versionedCache.bump('moderation');
    return record;
  }

  async function queue({ state = 'open', category = null } = {}) {
    const all = await store.list(C.REPORTS);
    return all
      .filter((r) => (state === 'all' ? true : r.state === state))
      .filter((r) => (category ? r.category === category : true))
      .sort((a, b) => (a.priority - b.priority) || new Date(a.createdAt) - new Date(b.createdAt));
  }

  async function detail(reportId) {
    const record = await store.get(C.REPORTS, reportId);
    if (!record) throw new NotFoundError('Report not found');
    const target = await members.get(record.targetId);
    const reporter = record.reporterId ? await members.get(record.reporterId) : null;
    const profile = await profiles.get(record.targetId);
    const photos = await media.forMember(record.targetId);
    const priors = await store.findAll(
      C.MODERATION_ACTIONS,
      (a) => a.targetId === record.targetId
    );
    return {
      report: record,
      target: target ? members.selfView(target) : null,
      reporter: reporter ? { id: reporter.id, email: reporter.email } : null,
      profile: profile ? profiles.selfView(profile, photos) : null,
      priorActions: priors.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    };
  }

  /**
   * The one place enforcement happens. Every action records actor, target,
   * reason and evidence, and every record is append-only.
   */
  async function act(reportId, { action, reason, durationDays, moderatorId }) {
    if (!ACTIONS.includes(action)) throw new ValidationError('Invalid moderation action');
    if (!reason) throw new ValidationError('A reason is required');

    const report = await store.get(C.REPORTS, reportId);
    if (!report) throw new NotFoundError('Report not found');
    if (report.state !== 'open') throw new ConflictError('This report has already been actioned');

    const target = await members.getOrThrow(report.targetId);

    const record = await store.create(C.MODERATION_ACTIONS, {
      reportId,
      targetId: report.targetId,
      moderatorId,
      action,
      reason,
      durationDays: durationDays || null,
      category: report.category,
      createdAt: new Date().toISOString()
    });

    if (action === 'suspend') {
      const until = new Date(Date.now() + (durationDays || 7) * 864e5).toISOString();
      await members.setStatus(target.id, members.STATUS.SUSPENDED, { until, reason });
      await notifications.notify(target.id, 'moderation.suspended', { until, reason });
    } else if (action === 'ban') {
      await banMember(target, { reason, moderatorId });
    } else if (action === 'warn') {
      await notifications.notify(target.id, 'moderation.warned', { reason });
    } else if (action === 'remove_content') {
      const photos = await media.forMember(target.id);
      for (const photo of photos) {
        await media.moderate(photo.id, 'rejected', { reviewerId: moderatorId, reason });
      }
      await notifications.notify(target.id, 'moderation.content_removed', { reason });
    }

    await store.update(C.REPORTS, reportId, {
      state: 'resolved',
      resolvedAt: new Date().toISOString(),
      resolution: { action, reason, moderatorId }
    });

    await activity.log('moderation.action', `${action} on ${target.email}: ${reason}`, {
      memberId: moderatorId, targetId: target.id, action, reason, reportId
    });
    await versionedCache.bumpAll(['moderation', 'members', 'decks']);
    return record;
  }

  /**
   * A ban records hashed identifiers so the same person cannot simply
   * re-register. Only hashes are kept — never the raw values.
   */
  async function banMember(member, { reason, moderatorId }) {
    const photos = await media.forMember(member.id);
    await store.create(C.BANNED_IDENTITIES, {
      emailHash: member.emailHash || sha256(member.email),
      photoHashes: photos.map((p) => p.contentHash).filter(Boolean),
      reason,
      bannedBy: moderatorId,
      createdAt: new Date().toISOString()
    });
    await members.setStatus(member.id, members.STATUS.BANNED, { reason });
    await notifications.notify(member.id, 'moderation.banned', { reason }).catch(() => {});
    await activity.log('member.banned', `${member.email} banned: ${reason}`, {
      memberId: moderatorId, targetId: member.id, reason
    });
  }

  /** Direct enforcement from the member-detail screen, outside a report. */
  async function actOnMember(targetId, { action, reason, durationDays, moderatorId }) {
    const target = await members.getOrThrow(targetId);
    if (!reason) throw new ValidationError('A reason is required');

    const record = await store.create(C.MODERATION_ACTIONS, {
      reportId: null, targetId, moderatorId, action, reason,
      durationDays: durationDays || null, createdAt: new Date().toISOString()
    });

    if (action === 'suspend') {
      const until = new Date(Date.now() + (durationDays || 7) * 864e5).toISOString();
      await members.setStatus(targetId, members.STATUS.SUSPENDED, { until, reason });
    } else if (action === 'ban') {
      await banMember(target, { reason, moderatorId });
    } else if (action === 'reinstate') {
      await members.setStatus(targetId, members.STATUS.ACTIVE, { reason });
    }

    await activity.log('moderation.action', `${action} on ${target.email}: ${reason}`, {
      memberId: moderatorId, targetId, action, reason
    });
    await versionedCache.bumpAll(['moderation', 'members', 'decks']);
    return record;
  }

  // ---- content scanning --------------------------------------------------

  /**
   * Scans a first message. Findings raise a flag for review; the message still
   * sends. A false positive that silently swallows a message is worse than one
   * a moderator dismisses.
   */
  async function scanFirstMessage(text, { senderId, matchId }) {
    const result = scanner.scanFirstMessage(text);
    if (result.severity === 'high') {
      await flag({
        targetId: senderId,
        category: result.flags.includes('solicitation') ? 'solicitation' : 'scam',
        note: `First message matched: ${result.matched.map((m) => m.category).join(', ')}`,
        matchId,
        source: 'first_message_scan'
      });
    }
    return result;
  }

  async function scanLaterMessage(text, { senderId, matchId }) {
    const result = scanner.scanMessage(text);
    if (result.severity === 'high') {
      await flag({
        targetId: senderId,
        category: result.flags.includes('solicitation') ? 'solicitation' : 'offensive_content',
        note: `Message matched: ${result.matched.map((m) => m.category).join(', ')}`,
        matchId,
        source: 'message_scan'
      });
    }
    return result;
  }

  async function queueDepth() {
    return versionedCache.remember('moderation', 'depth', async () => {
      const open = await queue({ state: 'open' });
      const photos = await media.pendingQueue();
      const profileEdits = await store.findAll(C.PROFILES, (p) => p.pending);
      return {
        reports: open.length,
        photos: photos.length,
        profileEdits: profileEdits.length,
        oldestReportAt: open[0]?.createdAt || null
      };
    });
  }

  return {
    block, unblock, blockedSet, blockedBy, isBlocked,
    report, flag, queue, detail, act, actOnMember, banMember,
    scanFirstMessage, scanLaterMessage, queueDepth,
    REPORT_CATEGORIES, ACTIONS
  };
}

module.exports = { createModerationService, REPORT_CATEGORIES, ACTIONS };
