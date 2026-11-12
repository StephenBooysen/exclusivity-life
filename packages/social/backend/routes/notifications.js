'use strict';

const express = require('express');
const { asyncHandler } = require('./asyncHandler');

function notificationsRouter({ notifications, messaging }, { requireAuth }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', asyncHandler(async (req, res) => {
    const [list, unread, unreadMessages] = await Promise.all([
      notifications.list(req.member.id, { limit: Math.min(Number(req.query.limit) || 30, 100) }),
      notifications.unreadCount(req.member.id),
      messaging.unreadTotal(req.member.id)
    ]);
    res.json({ notifications: list, unread, unreadMessages });
  }));

  router.post('/read', asyncHandler(async (req, res) => {
    const count = await notifications.markRead(req.member.id, req.body?.ids || null);
    res.json({ marked: count });
  }));

  return router;
}

module.exports = { notificationsRouter };
