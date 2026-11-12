/**
 * A8 — matches.
 *
 * What is new, what is waiting, and who liked you. A match that has had no
 * first message carries its expiry on its face rather than in a settings page:
 * it closes at seven days, and that is the one number worth surfacing.
 */

import { api } from '../api.js';
import { escapeHtml, timeAgo, clockTime } from '../format.js';
import { getSession, go } from '../router.js';
import { decorate } from '../blueprint.js';

export async function renderMatches(root) {
  const member = getSession().member;
  const canSeeLikes = Boolean(member?.entitlements?.whoLikedYou);

  const [{ matches }, liked] = await Promise.all([
    api.matches.list(),
    canSeeLikes ? api.discovery.likedMe().then((r) => r.cards).catch(() => []) : Promise.resolve([])
  ]);

  if (!matches.length && !liked.length) {
    root.innerHTML = `
      <section class="screen">
        ${head(0, 0)}
        <div class="empty">
          <h2>No matches yet</h2>
          <p>When you and someone else both say yes, the conversation opens here.</p>
          <button class="btn btn--sm" style="margin-top:20px" data-discover type="button">See today's introductions</button>
        </div>
      </section>`;
    decorate(root);
    root.querySelector('[data-discover]').addEventListener('click', () => go('discover'));
    return;
  }

  const waiting = matches.filter((m) => m.awaitingFirstMessage);
  const talking = matches.filter((m) => !m.awaitingFirstMessage);

  root.innerHTML = `
    <section class="screen">
      ${head(matches.length, waiting.length)}

      ${waiting.map(newMatchRow).join('')}

      ${talking.length ? `
        <div class="pad grid-list--bare" style="display:flex;flex-direction:column;gap:1px">
          ${talking.map(conversationRow).join('')}
        </div>` : ''}

      ${liked.length ? `
        <div class="pad" style="margin-top:34px;padding-top:20px;border-top:1px solid var(--divider)">
          <div class="eyebrow">Liked you · ${liked.length}</div>
          <div class="liked">
            ${liked.slice(0, 3).map((card) => `
              <button class="liked__tile ${card.photos?.length ? 'duotone' : 'ph'}" style="width:70px;height:88px"
                data-member="${escapeHtml(card.memberId)}" data-ph="" aria-label="Open ${escapeHtml(card.firstName)}'s profile">
                ${card.photos?.length ? `<img src="/api/photos/${card.photos[0].id}/card" alt="" loading="lazy" />` : ''}
              </button>`).join('')}
            ${liked.length > 3
    ? `<button class="liked__more" style="width:70px;height:88px" data-discover type="button">+${liked.length - 3}</button>`
    : ''}
          </div>
        </div>` : ''}
    </section>`;

  decorate(root);

  root.querySelectorAll('[data-match]').forEach((node) => {
    node.addEventListener('click', () => go('chat', node.dataset.match));
  });
  root.querySelectorAll('[data-member]').forEach((node) => {
    node.addEventListener('click', () => go('profile', node.dataset.member));
  });
  root.querySelector('[data-discover]')?.addEventListener('click', () => go('discover'));
}

function head(total, waiting) {
  return `
    <div class="pad" style="padding-top:18px;padding-bottom:16px">
      <h1 style="font-size:28px">Matches</h1>
      <div class="meta" style="margin-top:4px;font-size:11.5px">${escapeHtml(summary(total, waiting))}</div>
    </div>`;
}

function summary(total, waiting) {
  if (!total) return 'Nothing open yet';
  const spelled = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][total] || String(total);
  const open = `${spelled} open`;
  if (!waiting) return open;
  return `${open} · ${waiting === 1 ? 'one awaiting a first message' : `${waiting} awaiting a first message`}`;
}

/** A match with no first message: framed, live-bordered, and carrying its clock. */
function newMatchRow(match) {
  const days = daysLeft(match.expiresAt);
  return `
    <button class="blueprint blueprint--live" data-match="${escapeHtml(match.matchId)}"
      style="margin:0 22px 14px;padding:14px;display:flex;gap:14px;align-items:center;width:calc(100% - 44px);background:none;color:inherit;text-align:left;cursor:pointer">
      <div class="${match.member.photoId ? 'duotone' : 'ph'}" style="width:56px;height:70px;flex:none" data-ph="">
        ${match.member.photoId ? `<img src="/api/photos/${match.member.photoId}/thumb" alt="" loading="lazy" />` : ''}
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
          <span style="font-family:var(--head);font-weight:600;font-size:17px;line-height:1.2">${escapeHtml(match.member.firstName)}</span>
          <span class="tag tag-accent">New</span>
        </div>
        <div style="font-size:12.5px;color:var(--t55);margin-top:4px">
          Matched ${escapeHtml(match.createdAt ? clockTime(match.createdAt) : '')}${
  days != null ? ` · say something in ${days} day${days === 1 ? '' : 's'}` : ''}
        </div>
      </div>
    </button>`;
}

function conversationRow(match) {
  return `
    <button class="grid-row grid-row--tap convo" data-match="${escapeHtml(match.matchId)}" style="padding-inline:0">
      <div class="${match.member.photoId ? 'duotone' : 'ph'} convo__face" data-ph="">
        ${match.member.photoId ? `<img src="/api/photos/${match.member.photoId}/thumb" alt="" loading="lazy" />` : ''}
      </div>
      <div class="grid-row__body">
        <div class="convo__top">
          <span class="convo__name">${escapeHtml(match.member.firstName)}</span>
          <span class="convo__time">${escapeHtml(match.lastMessageAt ? timeAgo(match.lastMessageAt) : '')}</span>
        </div>
        <div class="convo__preview${match.unread ? ' convo__preview--unread' : ''}">
          ${match.lastMessagePreview ? escapeHtml(match.lastMessagePreview) : 'Say something first'}
        </div>
      </div>
    </button>`;
}

function daysLeft(expiresAt) {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt) - Date.now()) / 864e5);
  return days > 0 ? days : 0;
}
