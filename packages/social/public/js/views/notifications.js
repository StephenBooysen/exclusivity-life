/** The notification centre, as a sheet off the account screen. */

import { escapeHtml, timeAgo, words } from '../format.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { go } from '../router.js';

const COPY = {
  'match.created': () => 'You have a new match',
  'match.expiring': () => 'A match is about to close',
  'message.new': (p) => `New message${p.preview ? `: “${p.preview}”` : ''}`,
  'application.approved': () => 'Your application was approved',
  'application.declined': () => 'A decision on your application',
  'application.waitlisted': () => "You're on the waitlist",
  'application.interview_scheduled': () => 'Your introductory call is booked',
  'application.info_requested': () => 'We need a little more from you',
  'application.received': () => 'We have your application',
  'membership.started': (p) => `Your ${p.tier || ''} membership is active`,
  'membership.renewal_failed': () => "We couldn't renew your membership",
  'membership.cancelled': () => 'Your membership is cancelled',
  'moderation.warned': () => 'A note about your account',
  'moderation.suspended': () => 'Your account is suspended',
  'moderation.content_removed': () => 'Content was removed from your profile',
  'daily.introductions': (p) => `${p.count || ''} new introductions are ready`
};

function line(notification) {
  const render = COPY[notification.type];
  return render ? render(notification.payload || {}) : words(notification.type);
}

export function openNotifications(notifications = []) {
  openSheet(`
    <h2>Notifications</h2>
    <div class="grid-list" style="margin-top:18px">
      ${notifications.length ? notifications.map((n) => `
        <button class="grid-row grid-row--tap" data-type="${escapeHtml(n.type)}"
          data-match="${escapeHtml(n.payload?.matchId || '')}" type="button">
          <div class="grid-row__body">
            <div class="grid-row__title" style="font-family:var(--body);font-weight:400;font-size:13.5px">${escapeHtml(line(n))}</div>
            ${!n.readAt ? '<div class="grid-row__note" style="color:var(--accent)">New</div>' : ''}
          </div>
          <span class="convo__time">${escapeHtml(timeAgo(n.createdAt))}</span>
        </button>`).join('')
    : '<div class="grid-row"><div class="grid-row__body"><div class="grid-row__note" style="margin:0">Nothing yet.</div></div></div>'}
    </div>
    <button class="btn btn--quiet btn--full" style="margin-top:18px" data-close type="button">Close</button>`, {
    label: 'Notifications',
    onMount(sheet) {
      sheet.querySelectorAll('[data-type]').forEach((node) => {
        node.addEventListener('click', () => {
          const { type, match } = node.dataset;
          closeSheet();
          if (match) go('chat', match);
          else if (type.startsWith('membership')) go('membership');
          else if (type.startsWith('application')) go('status');
          else if (type.startsWith('match')) go('matches');
        });
      });
    }
  });
}
