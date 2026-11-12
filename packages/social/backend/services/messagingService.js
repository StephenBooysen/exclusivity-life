'use strict';

/**
 * @fileoverview Conversations and messages.
 *
 * Messaging is available only between matched members. There is no mechanism —
 * paid or otherwise — to reach an unmatched member, and every send path
 * re-verifies participation rather than trusting the caller.
 *
 * Messages are sharded one container per match, so a send reads only that
 * conversation instead of every message ever written.
 */

const config = require('../config');
const { C, messagesContainer } = require('./containers');
const { ValidationError, NotFoundError, ForbiddenError } = require('../errors');

function createMessagingService({
  store, members, matching, moderation, entitlements, profiles, media,
  notifications, activity, versionedCache, realtime
}) {
  async function conversationFor(matchId) {
    return store.findOne(C.CONVERSATIONS, (c) => c.matchId === matchId);
  }

  /**
   * Sends a message into a match.
   * @param {Object} member sender
   * @param {string} matchId
   * @param {string} text
   * @param {string=} idempotencyKey client-generated; a retry returns the
   *   existing message rather than duplicating it
   */
  async function send(member, matchId, text, idempotencyKey) {
    const body = String(text || '').trim();
    if (!body) throw new ValidationError('Write something first');
    if (body.length > config.limits.messageMaxLength) {
      throw new ValidationError(`Messages are limited to ${config.limits.messageMaxLength} characters`);
    }

    // Authorisation, every time, on every transport.
    const match = await matching.assertParticipant(member.id, matchId);
    const container = messagesContainer(matchId);

    if (idempotencyKey) {
      const existing = await store.findOne(container, (m) => m.idempotencyKey === idempotencyKey);
      if (existing) return existing;
    }

    const existingMessages = await store.list(container);
    const isFirst = existingMessages.length === 0;

    const scan = isFirst
      ? await moderation.scanFirstMessage(body, { senderId: member.id, matchId })
      : await moderation.scanLaterMessage(body, { senderId: member.id, matchId });

    const message = await store.create(container, {
      matchId,
      senderId: member.id,
      text: body,
      createdAt: new Date().toISOString(),
      idempotencyKey: idempotencyKey || null,
      readAt: null,
      flags: scan.flags,
      messageIndex: existingMessages.length
    });

    const recipientId = match.memberIds.find((id) => id !== member.id);
    const conversation = await conversationFor(matchId);
    if (conversation) {
      await store.mutate(C.CONVERSATIONS, conversation.id, (current) => ({
        ...current,
        lastMessageAt: message.createdAt,
        lastMessagePreview: body.slice(0, 120),
        lastSenderId: member.id,
        unread: {
          ...current.unread,
          [recipientId]: (current.unread?.[recipientId] || 0) + 1
        }
      }));
    }

    if (isFirst) {
      await store.update(C.MATCHES, matchId, { firstMessageAt: message.createdAt });
    }

    realtime?.toMatch(matchId, 'message:new', { ...message });
    await notifications.notify(recipientId, 'message.new', {
      matchId, fromMemberId: member.id, preview: body.slice(0, 80)
    });

    await activity.log('message.sent', `message in ${matchId}`, {
      memberId: member.id, targetId: recipientId, matchId, messageIndex: message.messageIndex
    });
    await versionedCache.bump('conversations');
    return message;
  }

  /**
   * Read receipts are reciprocal — a member whose tier cannot show them cannot
   * see them either, and either side can switch them off in privacy settings.
   */
  async function receiptsVisible(viewer, other) {
    const [viewerEnt, otherEnt] = await Promise.all([
      entitlements.resolve(viewer),
      entitlements.resolve(other)
    ]);
    if (!viewerEnt.entitlements.readReceipts || !otherEnt.entitlements.readReceipts) return false;
    const [viewerPrefs, otherPrefs] = await Promise.all([
      profiles.getPreferences(viewer.id),
      profiles.getPreferences(other.id)
    ]);
    return Boolean(viewerPrefs.privacy?.showReadReceipts && otherPrefs.privacy?.showReadReceipts);
  }

  async function history(member, matchId, { limit = 50, before = null } = {}) {
    const match = await matching.assertParticipant(member.id, matchId);
    const container = messagesContainer(matchId);
    const all = await store.list(container);

    const otherId = match.memberIds.find((id) => id !== member.id);
    const other = await members.get(otherId);
    const showReceipts = other ? await receiptsVisible(member, other) : false;

    const sorted = all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const filtered = before ? sorted.filter((m) => m.createdAt < before) : sorted;
    const page = filtered.slice(-limit);

    return {
      matchId,
      messages: page.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        text: m.text,
        createdAt: m.createdAt,
        mine: m.senderId === member.id,
        readAt: showReceipts && m.senderId === member.id ? m.readAt : undefined
      })),
      hasMore: filtered.length > page.length
    };
  }

  async function markRead(member, matchId) {
    const match = await matching.assertParticipant(member.id, matchId);
    const container = messagesContainer(matchId);
    const all = await store.list(container);
    const now = new Date().toISOString();

    for (const message of all) {
      if (message.senderId !== member.id && !message.readAt) {
        await store.update(container, message.id, { readAt: now });
      }
    }

    const conversation = await conversationFor(matchId);
    if (conversation) {
      await store.mutate(C.CONVERSATIONS, conversation.id, (current) => ({
        ...current,
        unread: { ...current.unread, [member.id]: 0 }
      }));
    }

    const otherId = match.memberIds.find((id) => id !== member.id);
    realtime?.toMember(otherId, 'message:read', { matchId, by: member.id, at: now });
    await versionedCache.bump('conversations');
    return { matchId, readAt: now };
  }

  /** The inbox: one row per active match, newest activity first. */
  async function inbox(member) {
    const matches = await matching.forMember(member.id);
    const blocked = await moderation.blockedSet(member.id);
    const rows = [];

    for (const match of matches) {
      const otherId = match.memberIds.find((id) => id !== member.id);
      if (blocked.has(otherId)) continue;
      const other = await members.get(otherId);
      if (!other || other.status !== 'active') continue;

      const profile = await profiles.get(otherId);
      if (!profile) continue;
      const photos = await media.liveForMember(otherId);
      const conversation = await conversationFor(match.id);

      rows.push({
        matchId: match.id,
        member: {
          id: otherId,
          firstName: profile.firstName,
          photoId: photos[0]?.id || null,
          badges: other.badges || []
        },
        lastMessageAt: conversation?.lastMessageAt || null,
        lastMessagePreview: conversation?.lastMessagePreview || null,
        lastSenderId: conversation?.lastSenderId || null,
        unread: conversation?.unread?.[member.id] || 0,
        createdAt: match.createdAt,
        expiresAt: match.firstMessageAt ? null : match.expiresAt,
        awaitingFirstMessage: !match.firstMessageAt
      });
    }

    return rows.sort((a, b) => new Date(b.lastMessageAt || b.createdAt) - new Date(a.lastMessageAt || a.createdAt));
  }

  async function unreadTotal(memberId) {
    const conversations = await store.findAll(
      C.CONVERSATIONS,
      (c) => c.memberIds.includes(memberId) && c.state === 'active'
    );
    return conversations.reduce((sum, c) => sum + (c.unread?.[memberId] || 0), 0);
  }

  /** Message evidence for a moderator reviewing a report. */
  async function messagesForModeration(matchId, limit = 50) {
    const all = await store.list(messagesContainer(matchId));
    return all
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(-limit);
  }

  return {
    send, history, markRead, inbox, unreadTotal, conversationFor,
    messagesForModeration, receiptsVisible
  };
}

module.exports = { createMessagingService };
