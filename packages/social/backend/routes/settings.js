'use strict';

/**
 * @fileoverview Account lifecycle: pause, delete, export, notifications.
 */

const express = require('express');
const { asyncHandler } = require('./asyncHandler');
const { C, messagesContainer } = require('../services/containers');
const { ValidationError } = require('../errors');

function settingsRouter(
  { members, profiles, media, matching, messaging, membership, notifications, store, activity, sessionStore },
  { requireAuth }
) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', asyncHandler(async (req, res) => {
    const preferences = await profiles.getPreferences(req.member.id);
    const subscription = await membership.summary(req.member);
    res.json({
      member: members.selfView(req.member),
      preferences,
      membership: subscription
    });
  }));

  router.put('/preferences', asyncHandler(async (req, res) => {
    res.json(await profiles.updatePreferences(req.member.id, req.body || {}));
  }));

  router.put('/notifications', asyncHandler(async (req, res) => {
    res.json(await profiles.updatePreferences(req.member.id, { notifications: req.body || {} }));
  }));

  router.put('/privacy', asyncHandler(async (req, res) => {
    const updated = await profiles.updatePreferences(req.member.id, { privacy: req.body || {} });
    if (req.body?.incognito !== undefined) {
      await members.update(req.member.id, { incognito: Boolean(req.body.incognito) });
    }
    res.json(updated);
  }));

  /** Hidden from discovery, conversations retained, nothing deleted. */
  router.post('/pause', asyncHandler(async (req, res) => {
    const member = await members.setStatus(req.member.id, members.STATUS.PAUSED, { reason: 'self_paused' });
    res.json({ member: members.selfView(member) });
  }));

  router.post('/resume', asyncHandler(async (req, res) => {
    if (req.member.status !== members.STATUS.PAUSED) {
      throw new ValidationError('Your account is not paused');
    }
    const target = req.member.side === 'male' && !(await membership.state(req.member.id))
      ? members.STATUS.DORMANT
      : members.STATUS.ACTIVE;
    const member = await members.setStatus(req.member.id, target, { reason: 'self_resumed' });
    res.json({ member: members.selfView(member) });
  }));

  /**
   * Irreversible. Profile, photos and conversations go; moderation, ban and
   * billing records stay — that carve-out is disclosed in the privacy policy
   * rather than applied quietly.
   */
  router.post('/delete', asyncHandler(async (req, res) => {
    if (!req.body?.confirm) throw new ValidationError('Confirm that you want to delete your account');

    const photos = await media.forMember(req.member.id);
    for (const photo of photos) {
      await media.remove(req.member.id, photo.id).catch(() => {});
    }

    const matches = await matching.forMember(req.member.id);
    for (const match of matches) {
      await matching.unmatch(req.member.id, match.id, { reason: 'account_deleted' }).catch(() => {});
    }

    const profile = await profiles.get(req.member.id);
    if (profile) await store.remove(C.PROFILES, profile.id);

    await members.update(req.member.id, {
      status: members.STATUS.DELETED,
      deletedAt: new Date().toISOString(),
      displayName: null,
      city: null
    });

    await activity.log('member.deleted', 'account deleted by member', { memberId: req.member.id });
    await new Promise((resolve) => sessionStore.destroyForMember(req.member.id, () => resolve()));
    req.session.destroy(() => {});
    res.json({ ok: true });
  }));

  /** Machine-readable archive of everything held about the member. */
  router.get('/export', asyncHandler(async (req, res) => {
    const memberId = req.member.id;
    const [profile, photos, matches, invoices, notificationList, preferences] = await Promise.all([
      profiles.get(memberId),
      media.forMember(memberId),
      store.findAll(C.MATCHES, (m) => m.memberIds.includes(memberId)),
      membership.invoices(memberId),
      notifications.list(memberId, { limit: 500 }),
      profiles.getPreferences(memberId)
    ]);

    const conversations = [];
    for (const match of matches) {
      const messages = await store.list(messagesContainer(match.id));
      conversations.push({
        matchId: match.id,
        createdAt: match.createdAt,
        state: match.state,
        messages: messages.map((m) => ({
          senderId: m.senderId === memberId ? 'me' : 'them',
          text: m.text,
          createdAt: m.createdAt
        }))
      });
    }

    await activity.log('member.exported', 'data export requested', { memberId });

    res.set('Content-Disposition', 'attachment; filename="exclusivity-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      member: members.selfView(req.member),
      profile,
      preferences,
      photos: photos.map((p) => ({ id: p.id, uploadedAt: p.uploadedAt, moderationState: p.moderationState })),
      conversations,
      invoices,
      notifications: notificationList
    });
  }));

  return router;
}

module.exports = { settingsRouter };
