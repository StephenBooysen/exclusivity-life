/**
 * A6 / B1 — the daily introductions.
 *
 * One introduction at a time, laid out as a catalogue entry rather than a card
 * to flick past: the portrait, then what was checked, then what they said.
 * There is no fling gesture and no confetti — the loop is deliberately slow.
 *
 * The Select side (B1) leads with who liked her, because reciprocity is the
 * point of that screen, and carries no upsell surface anywhere on it.
 */

import { api } from '../api.js';
import { escapeHtml } from '../format.js';
import { toast, toastError } from '../toast.js';
import { badgeChips } from '../badges.js';
import { loadTaxonomy, labelFor } from '../interests.js';
import { getSession, go } from '../router.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { decorate } from '../blueprint.js';

let deck = null;
let liked = [];
let preferences = null;
let index = 0;

export async function renderDiscover(root) {
  const member = getSession().member;
  const select = member?.side === 'female';
  const canSeeLikes = Boolean(member?.entitlements?.whoLikedYou);

  const [deckPayload, prefs] = await Promise.all([
    api.discovery.deck(),
    loadTaxonomy(),
    // Incognito is a preference, not a member flag — the chip has to read the
    // setting that discovery actually honours or it is a claim about nothing.
    select ? api.profile.preferences().catch(() => null) : Promise.resolve(null)
  ]).then(([d, , p]) => [d, p]);
  deck = deckPayload;
  preferences = prefs;
  index = 0;

  // Who-liked-you is Elite+ on the male side and always on for Select. It is a
  // strip on her screen and a sheet on his, so a Signature member is never
  // shown a locked door.
  liked = canSeeLikes
    ? await api.discovery.likedMe().then((r) => r.cards).catch(() => [])
    : [];

  paint(root, { select, canSeeLikes });
}

function paint(root, options) {
  const { select } = options;

  if (!deck.cards.length) {
    root.innerHTML = `<section class="screen">${header(options)}${emptyState(deck)}</section>`;
    decorate(root);
    root.querySelector('[data-matches]')?.addEventListener('click', () => go('matches'));
    root.querySelector('[data-filters]')?.addEventListener('click', () => go('interests'));
    return;
  }

  index = Math.min(index, deck.cards.length - 1);
  const card = deck.cards[index];
  const total = deck.cards.length;

  root.innerHTML = `
    <section class="screen screen--fixed">
      ${header(options)}
      ${select && liked.length ? likedStrip(liked) : ''}
      <div class="pad" style="flex:1;display:flex;flex-direction:column;min-height:0${select ? ';border-top:1px solid var(--grid)' : ''}">
        ${select ? `<div class="eyebrow" style="margin:18px 0 12px">Introduction ${index + 1} of ${deck.total || total}</div>` : ''}
        <article class="blueprint deck" data-card="${escapeHtml(card.memberId)}">
          <button class="deck__photo ${card.photos?.length ? 'duotone' : 'ph'}" data-open
            style="padding:0;border:0;background:none;text-align:left;cursor:pointer"
            data-ph="No photograph" aria-label="Open ${escapeHtml(card.firstName)}'s profile">
            ${card.photos?.length
    ? `<img src="/api/photos/${card.photos[0].id}/detail" alt="${escapeHtml(card.firstName)}" />`
    : ''}
          </button>
          <div class="deck__entry">
            <div class="deck__name">
              <h3>${escapeHtml(card.firstName)}</h3>
              <span class="age">${escapeHtml(card.age)}</span>
            </div>
            <div class="deck__line">${escapeHtml(line(card))}</div>
            <div style="margin-top:12px">${badgeChips(card.badges, { long: !select })}</div>
            ${interestChips(card.interestCategories, select)}
            ${card.prompts?.length
    ? `<p class="deck__quote">“${escapeHtml(card.prompts[0].a)}”</p>`
    : card.bio ? `<p class="deck__quote">${escapeHtml(card.bio)}</p>` : ''}
          </div>
        </article>
        <div class="btn-row" style="padding:16px 0 10px">
          <button class="btn btn--secondary" style="height:${select ? 54 : 56}px" data-pass type="button">Pass</button>
          <button class="btn btn--primary" style="height:${select ? 54 : 56}px" data-like type="button">Like</button>
        </div>
        ${select || deck.allowance?.unlimited ? ''
    : `<div class="deck__hint">Passes are unlimited. A like is spent from today's ${escapeHtml(deck.allowance?.limit ?? 0)}.</div>`}
      </div>
    </section>`;

  decorate(root);
  wire(root, card, options);
}

/** "In-house counsel · 5–15 km" — occupation and a distance band, never a number. */
function line(card) {
  return [card.occupation, card.distance].filter(Boolean).join(' · ');
}

function interestChips(keys = [], select) {
  if (!keys.length) return '';
  const chips = keys.slice(0, 3).map((key, i) => `<span class="tag tag-outline">${
    select && i === 0 ? `Looking for: ${escapeHtml(labelFor(key))}` : escapeHtml(labelFor(key))
  }</span>`);
  return `<div class="tags" style="margin-top:7px">${chips.join('')}</div>`;
}

/* ---------- header ---------- */

function header({ select, canSeeLikes }) {
  const member = getSession().member;
  const allowance = deck?.allowance;
  const tier = member?.tier ? member.tier[0].toUpperCase() + member.tier.slice(1) : '';

  if (select) {
    return `
      <div class="pad" style="padding-top:18px;padding-bottom:16px;display:flex;justify-content:space-between;align-items:baseline">
        <div>
          <h2 style="font-size:20px;line-height:1">Today</h2>
          <div class="meta" style="margin-top:4px;font-size:11.5px">
            ${escapeHtml(deck?.total ?? deck?.size ?? 0)} introductions · unlimited likes
          </div>
        </div>
        ${preferences?.privacy?.incognito ? '<span class="tag tag-outline">Incognito</span>' : ''}
      </div>`;
  }

  const remaining = allowance?.unlimited ? null : allowance?.remaining ?? 0;
  return `
    <div class="pad" style="padding-top:18px;padding-bottom:14px;display:flex;justify-content:space-between;align-items:baseline">
      <div>
        <h2 style="font-size:20px;line-height:1">Today</h2>
        <div class="meta" style="margin-top:4px;font-size:11.5px">Refreshed 06:00${tier ? ` · ${escapeHtml(tier)}` : ''}</div>
      </div>
      <div style="text-align:right">
        ${allowance?.unlimited
    ? '<div style="font-family:var(--head);font-weight:600;font-size:20px;line-height:1;color:var(--accent-hi)">∞</div>'
    : `<div style="font-family:var(--head);font-weight:600;font-size:20px;line-height:1;color:var(--accent-hi)">${escapeHtml(remaining)}<span style="color:var(--t35)">/${escapeHtml(allowance?.limit ?? 0)}</span></div>`}
        <div class="meta" style="margin-top:4px">remaining</div>
      </div>
    </div>
    ${canSeeLikes && liked.length ? `
      <div class="pad" style="padding-bottom:14px">
        <button class="link" data-liked type="button" style="font-size:11.5px;letter-spacing:.16em;text-transform:uppercase">
          Liked you · ${liked.length}
        </button>
      </div>` : ''}`;
}

/** Her strip: four faces, then the one line that explains what they do. */
function likedStrip(cards) {
  const shown = cards.slice(0, 4);
  const rest = cards.length - shown.length;
  return `
    <div class="pad" style="padding-bottom:18px">
      <div class="eyebrow">Liked you · ${cards.length}</div>
      <div class="liked">
        ${shown.map((card) => `
          <button class="liked__tile ${card.photos?.length ? 'duotone' : 'ph'}" data-liked-member="${escapeHtml(card.memberId)}"
            data-ph="" aria-label="Open ${escapeHtml(card.firstName)}'s profile">
            ${card.photos?.length ? `<img src="/api/photos/${card.photos[0].id}/card" alt="" loading="lazy" />` : ''}
          </button>`).join('')}
        ${rest > 0 ? `<button class="liked__more" data-liked type="button">+${rest}</button>` : ''}
      </div>
      <div style="font-size:11px;color:var(--t35);margin-top:8px">Like back and the conversation opens immediately.</div>
    </div>`;
}

/* ---------- empty ---------- */

function emptyState(current) {
  const spent = current.allowance && !current.allowance.unlimited && current.allowance.remaining === 0;
  const size = current.size || current.total || 0;
  return `<div class="empty">
    <h2>${spent ? "That's today" : 'Nothing new today'}</h2>
    <p>${spent
    ? `You have seen today's ${escapeHtml(size)} — the next set arrives at 06:00.`
    : 'We would rather send you nobody than send you the wrong people. The next set arrives at 06:00.'}</p>
    <div class="stack" style="gap:10px;max-width:260px;margin:22px auto 0">
      <button class="btn btn--sm" data-matches type="button">Go to your matches</button>
      <button class="btn btn--quiet btn--sm" data-filters type="button">Change what you're looking for</button>
    </div>
  </div>`;
}

/* ---------- acting ---------- */

function wire(root, card, options) {
  const act = async (kind) => {
    const buttons = root.querySelectorAll('[data-like],[data-pass]');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const result = kind === 'like'
        ? await api.discovery.like(card.memberId, 'deck')
        : await api.discovery.pass(card.memberId, 'deck');

      // The remaining count comes back from the same source of truth the server
      // enforces — it is never decremented locally.
      deck.allowance = result.allowance || deck.allowance;
      deck.cards.splice(index, 1);

      if (result.matched) showMatch(card, result.match);
      else if (kind === 'like') toast(`${card.firstName} will see that you liked them`);

      paint(root, options);
    } catch (err) {
      toastError(err);
      buttons.forEach((b) => { b.disabled = false; });
      if (err.code === 'allowance_exhausted') {
        deck.cards = [];
        deck.allowance = { ...deck.allowance, remaining: 0 };
        paint(root, options);
      }
    }
  };

  root.querySelector('[data-like]')?.addEventListener('click', () => act('like'));
  root.querySelector('[data-pass]')?.addEventListener('click', () => act('pass'));
  root.querySelector('[data-open]')?.addEventListener('click', () => go('profile', card.memberId));
  root.querySelector('[data-liked]')?.addEventListener('click', () => openLikedYou());
  root.querySelectorAll('[data-liked-member]').forEach((tile) => {
    tile.addEventListener('click', () => go('profile', tile.dataset.likedMember));
  });
}

/** Everyone who liked you, as a sheet. Liking back opens the conversation. */
function openLikedYou() {
  openSheet(`
    <h2>Liked you · ${liked.length}</h2>
    <p class="muted" style="margin-top:8px">Like back and the conversation opens immediately.</p>
    <div class="grid-list" style="margin-top:18px">
      ${liked.map((card) => `
        <div class="grid-row">
          <div class="${card.photos?.length ? 'duotone' : 'ph'}" style="width:44px;height:55px;flex:none" data-ph="">
            ${card.photos?.length ? `<img src="/api/photos/${card.photos[0].id}/thumb" alt="" />` : ''}
          </div>
          <div class="grid-row__body">
            <div class="grid-row__title">${escapeHtml(card.firstName)} <span class="dim">${escapeHtml(card.age)}</span></div>
            <div class="grid-row__note">${escapeHtml(line(card))}</div>
          </div>
          <button class="btn btn--sm btn--primary" data-like-back="${escapeHtml(card.memberId)}" type="button">Like</button>
        </div>`).join('')}
    </div>
    <button class="btn btn--quiet btn--full" style="margin-top:18px" data-close type="button">Close</button>`, {
    label: 'Liked you',
    onMount(sheet) {
      sheet.querySelectorAll('[data-like-back]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const result = await api.discovery.like(btn.dataset.likeBack, 'liked_me');
            closeSheet();
            if (result.matched) go('chat', result.match.id);
            else toast('Liked');
          } catch (err) {
            toastError(err);
            btn.disabled = false;
          }
        });
      });
    }
  });
}

function showMatch(card, match) {
  openSheet(`
    <div class="eyebrow" style="color:var(--accent)">You both said yes</div>
    <h2>${escapeHtml(card.firstName)} liked you back.</h2>
    <p class="muted" style="margin-top:10px">
      Your conversation is open. It closes in seven days if neither of you says anything.
    </p>
    <div class="stack" style="gap:10px;margin-top:22px">
      <button class="btn btn--primary btn--full" data-open type="button">Say something</button>
      <button class="btn btn--quiet btn--full" data-close type="button">Later</button>
    </div>`, {
    label: 'New match',
    onMount(sheet) {
      sheet.querySelector('[data-open]').addEventListener('click', () => {
        closeSheet();
        go('chat', match.id);
      });
    }
  });
}

/* ---------- report ---------- */

export function openReport(card, { matchId = null } = {}) {
  const categories = [
    ['fake_profile', 'This is not a real person'],
    ['solicitation', 'Asking for money, or offering an arrangement'],
    ['harassment', 'Harassment or abuse'],
    ['offensive_content', 'Offensive content'],
    ['underage', 'They appear to be under 18'],
    ['scam', 'A scam'],
    ['other', 'Something else']
  ];

  openSheet(`
    <h2>Report ${escapeHtml(card.firstName)}</h2>
    <p class="muted" style="margin:8px 0 18px">
      ${escapeHtml(card.firstName)} is hidden from you at once, before any decision, and is
      never told you reported them.
    </p>
    <form id="report-form">
      <div class="field">
        <label for="r-category">What happened</label>
        <select id="r-category" name="category" required>
          ${categories.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="r-note">Anything else (optional)</label>
        <textarea id="r-note" name="note" maxlength="800"></textarea>
      </div>
      <button class="btn btn--primary btn--full" type="submit">Send report</button>
      <button class="btn btn--quiet btn--full" style="margin-top:10px" type="button" data-close>Cancel</button>
    </form>`, {
    label: 'Report',
    onMount(sheet) {
      sheet.querySelector('#report-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api.safety.report({
            targetId: card.memberId,
            category: fd.get('category'),
            note: fd.get('note'),
            matchId
          });
          closeSheet();
          toast('Report sent. They can no longer see you.');
          setTimeout(() => location.reload(), 1200);
        } catch (err) { toastError(err); }
      });
    }
  });
}
