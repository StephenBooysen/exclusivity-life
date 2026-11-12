'use strict';

/**
 * @fileoverview Operational read models for the admin console.
 *
 * The gender ratio is the metric that decides whether this product lives. When
 * it passes the alarm threshold the answer is to throttle male approvals, not
 * to chase growth — the dashboard says so explicitly.
 */

const crypto = require('node:crypto');
const config = require('../config');
const { C } = require('./containers');
const { todayIso } = require('./utils');
const { ValidationError, NotFoundError } = require('../errors');

const RATIO_ALARM = 2.0;
const RATIO_TARGET_MAX = 1.6;

function createAdminService({
  store, members, profiles, media, applications, moderation, membership,
  messaging, activity, versionedCache
}) {
  async function funnel({ days = 30 } = {}) {
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const [allMembers, allApplications, allSubscriptions, allMatches] = await Promise.all([
      store.list(C.MEMBERS),
      store.list(C.APPLICATIONS),
      store.list(C.SUBSCRIPTIONS),
      store.list(C.MATCHES)
    ]);

    const recent = (list, field = 'createdAt') => list.filter((x) => (x[field] || '') >= since);
    const submitted = allApplications.filter((a) => a.submittedAt && a.submittedAt >= since);
    const decided = submitted.filter((a) => a.decision);
    const approved = decided.filter((a) => a.decision.outcome === 'approve');

    const decisionHours = decided
      .filter((a) => a.decision?.decidedAt && a.submittedAt)
      .map((a) => (new Date(a.decision.decidedAt) - new Date(a.submittedAt)) / 36e5)
      .sort((a, b) => a - b);
    const p95 = decisionHours.length
      ? decisionHours[Math.min(decisionHours.length - 1, Math.floor(decisionHours.length * 0.95))]
      : null;

    return {
      windowDays: days,
      registered: recent(allMembers).length,
      applicationsSubmitted: submitted.length,
      applicationsDecided: decided.length,
      approved: approved.length,
      approvalRate: submitted.length ? approved.length / submitted.length : null,
      approvalRateBySide: {
        male: rate(submitted.filter((a) => a.side === 'male')),
        female: rate(submitted.filter((a) => a.side === 'female'))
      },
      subscriptionsStarted: recent(allSubscriptions, 'startedAt').length,
      matchesCreated: recent(allMatches).length,
      timeToDecisionP95Hours: p95 === null ? null : Math.round(p95 * 10) / 10,
      slaHours: config.review.slaHours,
      slaBreached: p95 !== null && p95 > config.review.slaHours
    };
  }

  /**
   * The ratio is the metric that decides whether this product lives, so the
   * dashboard states the action rather than the number alone. Above the alarm
   * the answer is always to slow male approvals, never to recruit harder.
   */
  function recommendFor({ male, female, ratio }) {
    if (!male && !female) return 'No active members yet.';
    if (!female) return 'No active women yet — every approval should be on the female side.';
    if (!male) return 'No active men yet. The female side is ready for them.';
    if (ratio >= RATIO_ALARM) return 'Throttle male approvals — the ratio is past the alarm threshold.';
    if (ratio > RATIO_TARGET_MAX) return 'Ratio drifting; prioritise female applications in the queue.';
    return 'Ratio healthy.';
  }

  function rate(list) {
    if (!list.length) return null;
    const approved = list.filter((a) => a.decision?.outcome === 'approve').length;
    return approved / list.length;
  }

  /**
   * Active members by side. Above the alarm threshold, the recommendation is
   * always to slow male approvals rather than recruit harder.
   */
  async function ratios() {
    const allMembers = await store.list(C.MEMBERS);
    const active = allMembers.filter((m) => m.status === 'active');
    const male = active.filter((m) => m.side === 'male').length;
    const female = active.filter((m) => m.side === 'female').length;
    const ratio = female ? male / female : (male ? Infinity : 0);

    return {
      city: config.launch.city,
      activeMale: male,
      activeFemale: female,
      ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null,
      target: `1.0–${RATIO_TARGET_MAX}`,
      alarm: ratio >= RATIO_ALARM,
      recommendation: recommendFor({ male, female, ratio })
    };
  }

  async function health() {
    const [queueDepth, reviewQueue, breaches, ratio] = await Promise.all([
      moderation.queueDepth(),
      applications.queue({ state: 'open' }),
      applications.slaBreaches(),
      ratios()
    ]);

    const oldestOpen = reviewQueue.filter((a) => a.submittedAt)
      .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt))[0];

    return {
      reviewQueueDepth: reviewQueue.length,
      reviewSlaAtRisk: breaches.length,
      oldestApplicationAt: oldestOpen?.submittedAt || null,
      moderation: queueDepth,
      ratio,
      moderationBacklogAlarm: queueDepth.photos > 0 && Boolean(queueDepth.oldestReportAt)
        && (Date.now() - new Date(queueDepth.oldestReportAt)) / 36e5 > 4
    };
  }

  /** Reports filed per 1 000 active members per week — the safety guardrail. */
  async function safetyMetrics({ days = 7 } = {}) {
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const [reports, actions, allMembers] = await Promise.all([
      store.list(C.REPORTS),
      store.list(C.MODERATION_ACTIONS),
      store.list(C.MEMBERS)
    ]);
    const active = allMembers.filter((m) => m.status === 'active').length || 1;
    const recentReports = reports.filter((r) => r.createdAt >= since);
    const solicitation = recentReports.filter((r) => r.category === 'solicitation');

    return {
      windowDays: days,
      reports: recentReports.length,
      reportsPer1000Active: Math.round((recentReports.length / active) * 1000 * 10) / 10,
      alarm: (recentReports.length / active) * 1000 > 15,
      solicitationFlags: solicitation.length,
      actionsTaken: actions.filter((a) => a.createdAt >= since).length,
      bans: actions.filter((a) => a.createdAt >= since && a.action === 'ban').length
    };
  }

  async function memberSearch(query, { limit = 25 } = {}) {
    const needle = String(query || '').trim().toLowerCase();
    const allMembers = await store.list(C.MEMBERS);
    const filtered = needle
      ? allMembers.filter((m) => m.email?.toLowerCase().includes(needle)
        || m.displayName?.toLowerCase().includes(needle)
        || m.id === query)
      : allMembers;
    return filtered
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map((m) => members.selfView(m));
  }

  /** Everything about one member on one screen, with the audit trail. */
  async function memberDetail(memberId) {
    const member = await members.getOrThrow(memberId);
    const [profile, photos, application, subscription, timeline, priorActions, matches] = await Promise.all([
      profiles.get(memberId),
      media.forMember(memberId),
      applications.forMember(memberId),
      membership.state(memberId),
      activity.forSubject(memberId, 100),
      store.findAll(C.MODERATION_ACTIONS, (a) => a.targetId === memberId),
      store.findAll(C.MATCHES, (m) => m.memberIds.includes(memberId))
    ]);

    return {
      member: members.selfView(member),
      profile: profile ? profiles.selfView(profile, photos) : null,
      application,
      subscription,
      moderationHistory: priorActions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      matchCount: matches.filter((m) => m.state === 'active').length,
      timeline
    };
  }

  // ---- invites -----------------------------------------------------------

  async function createInvite({ tier = 'noir', memberId = null, expiresInDays = 30, createdBy, note }) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const invite = await store.create(C.INVITES, {
      code,
      tier,
      memberId,
      note: note || null,
      createdBy,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiresInDays * 864e5).toISOString(),
      redeemedAt: null,
      revokedAt: null
    });
    await activity.log('admin.invite_created', `invite ${code} (${tier})`, {
      memberId: createdBy, code, tier
    });
    return invite;
  }

  async function listInvites() {
    const all = await store.list(C.INVITES);
    return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async function revokeInvite(inviteId, { adminId }) {
    const invite = await store.get(C.INVITES, inviteId);
    if (!invite) throw new NotFoundError('Invite not found');
    const updated = await store.update(C.INVITES, inviteId, { revokedAt: new Date().toISOString() });
    await activity.log('admin.invite_revoked', `invite ${invite.code} revoked`, { memberId: adminId, code: invite.code });
    return updated;
  }

  /** Grants a membership without payment — comped, and recorded as such. */
  async function compMembership(memberId, { tier, days = 30, adminId }) {
    if (!tier) throw new ValidationError('A tier is required');
    const subscription = await membership.activate(memberId, {
      tier,
      term: 'monthly',
      providerRef: `comp_${crypto.randomUUID()}`,
      periodEnd: new Date(Date.now() + days * 864e5).toISOString()
    });
    await activity.log('admin.membership_comped', `${tier} comped for ${days} days`, {
      memberId: adminId, targetId: memberId, tier, days
    });
    return subscription;
  }

  async function auditExport({ from, to }) {
    const fromIso = from || new Date(Date.now() - 30 * 864e5).toISOString();
    const toIso = to || new Date().toISOString();
    return activity.between(fromIso, toIso);
  }

  /** Persists a metrics snapshot for the ops dashboard trend lines. */
  async function snapshot() {
    const [f, r, h, s] = await Promise.all([funnel({ days: 1 }), ratios(), health(), safetyMetrics({ days: 7 })]);
    return store.create(C.METRICS, {
      date: todayIso(),
      capturedAt: new Date().toISOString(),
      funnel: f,
      ratio: r,
      health: h,
      safety: s
    });
  }

  async function trend({ days = 14 } = {}) {
    const all = await store.list(C.METRICS);
    return all
      .sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt))
      .slice(-days);
  }

  return {
    funnel, ratios, health, safetyMetrics, memberSearch, memberDetail,
    createInvite, listInvites, revokeInvite, compMembership, auditExport,
    snapshot, trend
  };
}

module.exports = { createAdminService, RATIO_ALARM };
