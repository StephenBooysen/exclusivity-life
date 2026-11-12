/**
 * The two dots on the tab bar.
 *
 * Unread is a struck dot beside a label, never a counted red pill: this palette
 * has one hue, and the design carries no urgency badges. Its own module so the
 * account screen can refresh it after marking notifications read without
 * importing the entry point back into itself.
 */

import { api } from './api.js';

export async function updateBadges() {
  try {
    const { unread, unreadMessages } = await api.notifications.list();
    const messages = document.getElementById('tab-unread');
    if (messages) messages.hidden = !unreadMessages;
    const notices = document.getElementById('tab-notif');
    if (notices) notices.hidden = !unread;
  } catch { /* the dots are decoration; never block on them */ }
}
