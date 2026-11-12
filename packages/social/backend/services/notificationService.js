'use strict';

/**
 * @fileoverview Notification fan-out: in-app centre, realtime badge, email.
 *
 * Preferences are honoured server-side. Two categories ignore them entirely —
 * moderation outcomes and application decisions are transactional, and a
 * member who has muted email does not get to miss the news that their account
 * was suspended.
 */

const { C } = require('./containers');
const { todayIso } = require('./utils');

/** notification type prefix -> preference category */
const CATEGORY = {
  'application.': 'applicationUpdates',
  'match.': 'newMatch',
  'message.': 'newMessage',
  'membership.': 'membership',
  'moderation.': null,
  'daily.': 'dailyIntroductions'
};

/** Types that are always delivered, regardless of preferences. */
const ALWAYS = [
  'moderation.warned', 'moderation.suspended', 'moderation.banned', 'moderation.content_removed',
  'application.approved', 'application.declined', 'application.waitlisted',
  'application.interview_scheduled', 'application.info_requested',
  'membership.renewal_failed'
];

function categoryFor(type) {
  const prefix = Object.keys(CATEGORY).find((p) => type.startsWith(p));
  return prefix ? CATEGORY[prefix] : null;
}

function createNotificationService({ store, members, profiles, email, logger, realtime, versionedCache }) {
  /** Per-member, per-category, per-day email cap so digests cannot pile up. */
  async function emailBudgetSpent(memberId, category) {
    if (category !== 'digest') return false;
    const today = todayIso();
    const sent = await store.findAll(
      C.NOTIFICATIONS,
      (n) => n.memberId === memberId && n.category === category
        && n.emailedAt && n.emailedAt.startsWith(today)
    );
    return sent.length > 0;
  }

  async function notify(memberId, type, payload = {}) {
    const member = await members.get(memberId);
    if (!member) return null;
    if (['banned', 'deleted'].includes(member.status) && !type.startsWith('moderation.')) return null;

    const category = categoryFor(type);
    const forced = ALWAYS.includes(type);

    let preferences = null;
    try {
      preferences = await profiles.getPreferences(memberId);
    } catch {
      preferences = null;
    }
    const setting = category && preferences?.notifications?.[category];
    const wantsInApp = forced || !setting || setting.inApp !== false;
    const wantsEmail = forced || (setting ? setting.email === true : false);

    let record = null;
    if (wantsInApp) {
      record = await store.create(C.NOTIFICATIONS, {
        memberId,
        type,
        category,
        payload,
        readAt: null,
        emailedAt: null,
        createdAt: new Date().toISOString()
      });
      realtime?.toMember(memberId, 'notification:new', {
        id: record.id, type, payload, createdAt: record.createdAt
      });
    }

    if (wantsEmail && member.email && !(await emailBudgetSpent(memberId, category))) {
      try {
        await email.send(type, member.email, payload);
        if (record) await store.update(C.NOTIFICATIONS, record.id, { emailedAt: new Date().toISOString() });
      } catch (err) {
        logger.error(`[notify] email failed for ${type} -> ${member.email}: ${err.message}`);
      }
    }

    return record;
  }

  async function list(memberId, { limit = 30, unreadOnly = false } = {}) {
    const all = await store.findAll(C.NOTIFICATIONS, (n) => n.memberId === memberId);
    const filtered = unreadOnly ? all.filter((n) => !n.readAt) : all;
    return filtered
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }

  async function unreadCount(memberId) {
    const all = await store.findAll(C.NOTIFICATIONS, (n) => n.memberId === memberId && !n.readAt);
    return all.length;
  }

  async function markRead(memberId, ids = null) {
    const all = await store.findAll(
      C.NOTIFICATIONS,
      (n) => n.memberId === memberId && !n.readAt && (ids ? ids.includes(n.id) : true)
    );
    const now = new Date().toISOString();
    for (const notification of all) {
      await store.update(C.NOTIFICATIONS, notification.id, { readAt: now });
    }
    return all.length;
  }

  return { notify, list, unreadCount, markRead, categoryFor };
}

module.exports = { createNotificationService, CATEGORY, ALWAYS };
