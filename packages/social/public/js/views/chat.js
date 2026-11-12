/**
 * A9 — one conversation. B3 — the controls sheet over it.
 *
 * Sends go over REST and are echoed back over the socket; the bubble renders
 * immediately in a pending state and is reconciled by idempotency key, so a
 * dropped socket costs a refresh rather than a message.
 *
 * The controls sheet exists because ending contact has to be trivially easy:
 * unmatch, block, report and read receipts, four rows, no reason required and
 * no retention wall in front of any of them.
 */

import { api } from '../api.js';
import { escapeHtml, clockTime } from '../format.js';
import { toast, toastError } from '../toast.js';
import { BADGE_ORDER, badgeLabel } from '../badges.js';
import { go, getSession } from '../router.js';
import * as rt from '../realtime.js';
import { openSheet, closeSheet, confirmSheet } from '../components/sheet.js';
import { openReport } from './discover.js';
import { decorate } from '../blueprint.js';

let unsubscribe = [];

export async function renderChat(root, matchId) {
  unsubscribe.forEach((fn) => fn());
  unsubscribe = [];

  const [{ matches }, history] = await Promise.all([
    api.matches.list(),
    api.messages.history(matchId)
  ]);

  const match = matches.find((m) => m.matchId === matchId);
  if (!match) {
    root.innerHTML = `<section class="screen"><div class="empty">
      <h2>This conversation is closed</h2>
      <p>It was ended or it expired. Nothing from it is visible to either of you.</p>
      <button class="btn btn--sm" style="margin-top:20px" data-back type="button">Back to matches</button>
    </div></section>`;
    root.querySelector('[data-back]').addEventListener('click', () => go('matches'));
    return;
  }

  const receipts = Boolean(getSession().member?.entitlements?.readReceipts);

  root.innerHTML = `
    <section class="screen screen--fixed">
      <header style="padding:16px 20px;display:flex;align-items:center;gap:13px;border-bottom:1px solid var(--divider);flex:none">
        <button class="glyphbtn glyphbtn--quiet" data-back type="button" aria-label="Back to matches">←</button>
        <button class="${match.member.photoId ? 'duotone' : 'ph'}" data-view
          style="width:34px;height:34px;flex:none;padding:0;cursor:pointer" data-ph=""
          aria-label="Open ${escapeHtml(match.member.firstName)}'s profile">
          ${match.member.photoId ? `<img src="/api/photos/${match.member.photoId}/thumb" alt="" />` : ''}
        </button>
        <div style="flex:1;min-width:0">
          <h2 style="font-size:16px;line-height:1.1;letter-spacing:0">${escapeHtml(match.member.firstName)}</h2>
          <div class="meta" id="presence" style="margin-top:2px">${escapeHtml(evidenceLine(match.member.badges))}</div>
        </div>
        <button class="glyphbtn glyphbtn--quiet" data-menu type="button" aria-label="Conversation controls">⋯</button>
      </header>

      <div class="screen__scroll">
        <div class="thread" id="thread" role="log" aria-live="polite" aria-relevant="additions">
          <div class="thread__system">
            ${match.createdAt ? `You matched at ${escapeHtml(clockTime(match.createdAt))}. ` : ''}Either of you can end this at any time.
          </div>
          ${history.messages.map((m) => bubble(m, receipts)).join('')}
        </div>
      </div>

      <div class="composer">
        <div class="composer__row">
          <textarea id="composer" rows="1" maxlength="2000" placeholder="Message" aria-label="Message ${escapeHtml(match.member.firstName)}"></textarea>
          <button class="btn btn--primary" id="send" style="height:44px;padding-inline:20px" type="button">Send</button>
        </div>
        <p class="composer__note">
          Keep it on Exclusivity. Requests to move to another app, or for money, are reviewed.
        </p>
      </div>
    </section>`;

  decorate(root);

  const scroller = root.querySelector('.screen__scroll');
  const thread = root.querySelector('#thread');
  scrollToEnd(scroller);
  api.messages.markRead(matchId).catch(() => {});

  root.querySelector('[data-back]').addEventListener('click', () => go('matches'));
  root.querySelector('[data-view]').addEventListener('click', () => go('profile', match.member.id));
  root.querySelector('[data-menu]').addEventListener('click', () => openControls(match, receipts));

  wireComposer(root, scroller, thread, match, receipts);
  wireRealtime(root, scroller, thread, matchId, receipts);
}

/** "Identity · Photo · Means" — what was checked, in the header, not a marketing line. */
function evidenceLine(badges = []) {
  const held = BADGE_ORDER.filter((key) => badges.includes(key));
  if (!held.length) return 'Matched';
  return held.map((key) => badgeLabel(key).replace(' verified', '')).join(' · ');
}

function bubble(message, receipts) {
  const mine = message.mine;
  const html = `<div class="bubble bubble--${mine ? 'me' : 'them'}" data-id="${escapeHtml(message.id)}">${
    escapeHtml(message.text)
  }</div>`;
  // Read receipts are reciprocal: a member who cannot show them cannot see them.
  if (mine && receipts && message.readAt) {
    return `${html}<div class="bubble__receipt">Read ${escapeHtml(clockTime(message.readAt))}</div>`;
  }
  return html;
}

function scrollToEnd(scroller) {
  requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
}

function wireComposer(root, scroller, thread, match, receipts) {
  const box = root.querySelector('#composer');
  const send = root.querySelector('#send');

  box.addEventListener('input', () => {
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 120)}px`;
    rt.emit('typing', { matchId: match.matchId, typing: box.value.length > 0 });
  });

  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 700px)').matches) {
      e.preventDefault();
      submit();
    }
  });

  async function submit() {
    const text = box.value.trim();
    if (!text) return;

    const key = crypto.randomUUID();
    box.value = '';
    box.style.height = 'auto';

    // Optimistic: the bubble appears now and is reconciled on the response.
    const pending = document.createElement('div');
    pending.className = 'bubble bubble--me bubble--pending';
    pending.dataset.key = key;
    pending.textContent = text;
    thread.appendChild(pending);
    scrollToEnd(scroller);

    try {
      const message = await api.messages.send(match.matchId, text, key);
      pending.outerHTML = bubble({ ...message, mine: true }, receipts);
    } catch (err) {
      pending.remove();
      box.value = text;
      toastError(err);
    }
  }

  send.addEventListener('click', submit);
}

function wireRealtime(root, scroller, thread, matchId, receipts) {
  rt.emit('match:join', matchId);

  unsubscribe.push(rt.on('message:new', (message) => {
    if (message.matchId !== matchId) return;
    if (thread.querySelector(`[data-id="${message.id}"]`)) return;
    // Our own send already rendered optimistically.
    if (thread.querySelector(`[data-key="${message.idempotencyKey}"]`)) return;
    thread.insertAdjacentHTML('beforeend', bubble({ ...message, mine: false }, receipts));
    scrollToEnd(scroller);
    api.messages.markRead(matchId).catch(() => {});
  }));

  unsubscribe.push(rt.on('typing', ({ matchId: id, typing }) => {
    if (id !== matchId) return;
    const existing = thread.querySelector('.bubble__receipt--them');
    if (typing && !existing) {
      thread.insertAdjacentHTML('beforeend', '<div class="bubble__receipt bubble__receipt--them">typing…</div>');
      scrollToEnd(scroller);
    } else if (!typing && existing) {
      existing.remove();
    }
  }));

  unsubscribe.push(rt.on('connected', () => rt.emit('match:join', matchId)));
}

/* ---------- B3 ---------- */

function openControls(match, receipts) {
  const name = match.member.firstName;
  const rows = [
    ['unmatch', 'Unmatch', 'Closes it for both. Cannot be undone.', '›'],
    ['block', 'Block', `Silent. ${escapeHtml(name)} is never told, and never appears again.`, '›'],
    ['report', 'Report', 'Hidden from you at once, before any decision.', '›']
  ];

  openSheet(`
    <h2>This conversation</h2>
    <p class="muted" style="margin:6px 0 18px">
      No one can message you unless you liked them back. Ending it is immediate and needs no reason.
    </p>
    <div class="grid-list">
      ${rows.map(([action, title, note, glyph]) => `
        <button class="grid-row grid-row--tap" data-action="${action}" style="padding:15px" type="button">
          <div class="grid-row__body">
            <div class="grid-row__title" style="font-family:var(--body);font-weight:400;font-size:14px">${escapeHtml(title)}</div>
            <div class="grid-row__note">${note}</div>
          </div>
          <span class="grid-row__chev">${glyph}</span>
        </button>`).join('')}
      <div class="grid-row" style="padding:15px">
        <div class="grid-row__body">
          <div class="grid-row__title" style="font-family:var(--body);font-weight:400;font-size:14px">Read receipts</div>
          <div class="grid-row__note">${receipts ? 'On' : 'Off'}. Reciprocal — off means you cannot see theirs.</div>
        </div>
        <button class="link" data-action="receipts" type="button" style="font-size:12px">${receipts ? 'On' : 'Off'}</button>
      </div>
    </div>
    <button class="btn btn--secondary btn--full" style="height:48px;margin-top:16px" data-close type="button">Close</button>`, {
    label: 'Conversation controls',
    onMount(sheet) {
      sheet.querySelector('[data-action="unmatch"]').addEventListener('click', async () => {
        closeSheet();
        const ok = await confirmSheet({
          title: 'Unmatch?',
          body: `It closes for both of you and cannot be undone. ${name} is not told.`,
          confirmLabel: 'Unmatch',
          danger: true
        });
        if (!ok) return;
        try {
          await api.matches.unmatch(match.matchId);
          toast('Unmatched');
          go('matches');
        } catch (err) { toastError(err); }
      });

      sheet.querySelector('[data-action="block"]').addEventListener('click', async () => {
        closeSheet();
        const ok = await confirmSheet({
          title: `Block ${name}?`,
          body: 'Silent and immediate, in both directions. They are never told, and never appear again. You can reverse it in settings.',
          confirmLabel: 'Block',
          danger: true
        });
        if (!ok) return;
        try {
          await api.safety.block(match.member.id);
          toast('Blocked');
          go('matches');
        } catch (err) { toastError(err); }
      });

      sheet.querySelector('[data-action="report"]').addEventListener('click', () => {
        closeSheet();
        openReport({ memberId: match.member.id, firstName: name }, { matchId: match.matchId });
      });

      sheet.querySelector('[data-action="receipts"]').addEventListener('click', () => {
        closeSheet();
        go('settings');
      });
    }
  });
}
