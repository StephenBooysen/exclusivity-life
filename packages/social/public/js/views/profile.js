/**
 * A7 / B2 — a member's profile, and the ACCOUNT hub for your own.
 *
 * The point of the profile screen is that the verification is legible: a badge
 * table that says what was checked, by what evidence, on what date — and, on
 * Means, that it was an interview and not a payment. That disclosure is
 * required, not decoration.
 *
 * Your own side of it is the third tab. The design's tab bar has three items,
 * so everything that used to be its own tab — photographs, words, membership,
 * notifications, settings — is reachable from here.
 */

import { api } from '../api.js';
import { escapeHtml, words, heightLabel } from '../format.js';
import { toast, toastError } from '../toast.js';
import { badgeChips, badgeTable, badgeLegend } from '../badges.js';
import { loadTaxonomy, labelFor } from '../interests.js';
import { getSession, refreshCurrent, go } from '../router.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { updateBadges } from '../badgecount.js';
import { decorate } from '../blueprint.js';
import { openReport } from './discover.js';

export async function renderProfile(root, memberId) {
  if (memberId) return renderOther(root, memberId);
  return renderMine(root);
}

/* ---------- A7 / B2 ---------- */

async function renderOther(root, memberId) {
  const [card] = await Promise.all([api.profile.of(memberId), loadTaxonomy()]);
  const viewer = getSession().member;
  const photos = card.photos || [];
  const side = viewer?.side === 'male' ? 'female' : 'male';

  root.innerHTML = `
    <section class="screen screen--fixed">
      <div class="hero ${photos.length ? 'duotone' : 'ph'}" style="height:300px" data-ph="No photograph">
        ${photos.length ? `<img src="/api/photos/${photos[0].id}/detail" alt="${escapeHtml(card.firstName)}" />` : ''}
        <div class="hero__over">
          <button class="glyphbtn" data-back type="button" aria-label="Back">←</button>
          <button class="glyphbtn" data-menu type="button" aria-label="More">⋯</button>
        </div>
        ${photos.length > 1 ? `<div class="hero__seg">${photos.map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('')}</div>` : ''}
      </div>

      <div class="screen__scroll">
        <div class="pad" style="padding-top:22px;padding-bottom:22px">
          <div style="display:flex;align-items:baseline;gap:10px">
            <h1 class="h-name">${escapeHtml(card.firstName)}</h1>
            <span style="font-size:19px;color:var(--t50)">${escapeHtml(card.age)}</span>
          </div>
          <div style="font-size:13px;color:var(--t62);margin-top:6px">${escapeHtml(factLine(card))}</div>
          <div style="font-size:13px;color:var(--t62);margin-top:3px">${escapeHtml(placeLine(card))}</div>

          <div style="margin-top:20px">${badgeTable(card.badges, { side, granted: card.badgesGrantedAt || {} })}</div>

          ${card.interestCategories?.length ? `
            <div style="margin-top:20px">
              <div class="eyebrow">Open to</div>
              <div class="tags">
                ${card.interestCategories.map((key) => `<span class="tag tag-outline">${escapeHtml(labelFor(key))}</span>`).join('')}
              </div>
            </div>` : ''}

          ${card.prompts?.length ? `
            <div style="margin-top:22px">
              <div class="eyebrow">${escapeHtml(card.prompts[0].q)}</div>
              <p style="font-size:14px;line-height:1.6;color:var(--t78)">${escapeHtml(card.prompts[0].a)}</p>
            </div>` : ''}

          ${card.bio ? `
            <div style="margin-top:22px">
              <div class="eyebrow">In their words</div>
              <p style="font-size:14px;line-height:1.6;color:var(--t78)">${escapeHtml(card.bio)}</p>
            </div>` : ''}

          ${photos.slice(1).map((photo, i) => `
            <div class="duotone" style="margin-top:20px;border:1px solid rgba(231,235,239,.14)">
              <img src="/api/photos/${photo.id}/detail" alt="Photograph ${i + 2}" loading="lazy" />
            </div>`).join('')}
        </div>
      </div>

      <div style="padding:14px 22px 22px;border-top:1px solid var(--divider);display:flex;gap:12px;align-items:center">
        <button class="link" data-block type="button" style="font-size:12px;color:var(--t50)">Block</button>
        <button class="link" data-report type="button" style="font-size:12px;color:var(--t50)">Report</button>
        <button class="btn btn--secondary" style="height:48px;margin-left:auto;padding-inline:22px" data-pass type="button">Pass</button>
        <button class="btn btn--primary" style="height:48px;padding-inline:26px" data-like type="button">Like</button>
      </div>
    </section>`;

  decorate(root);
  wireOther(root, card);
}

function factLine(card) {
  return [card.occupation, card.education ? words(card.education) : null, heightLabel(card.height)]
    .filter(Boolean).join(' · ');
}

function placeLine(card) {
  return [card.city, card.distance, card.intent ? words(card.intent) : null]
    .filter(Boolean).join(' · ');
}

function wireOther(root, card) {
  root.querySelector('[data-back]').addEventListener('click', () => history.back());

  const act = async (kind) => {
    root.querySelectorAll('[data-like],[data-pass]').forEach((b) => { b.disabled = true; });
    try {
      const result = kind === 'like'
        ? await api.discovery.like(card.memberId, 'profile')
        : await api.discovery.pass(card.memberId, 'profile');
      if (result.matched) go('chat', result.match.id);
      else {
        toast(kind === 'like' ? `${card.firstName} will see that you liked them` : 'Passed');
        history.back();
      }
    } catch (err) {
      toastError(err);
      root.querySelectorAll('[data-like],[data-pass]').forEach((b) => { b.disabled = false; });
    }
  };

  root.querySelector('[data-like]').addEventListener('click', () => act('like'));
  root.querySelector('[data-pass]').addEventListener('click', () => act('pass'));
  root.querySelector('[data-report]').addEventListener('click', () => openReport(card));
  root.querySelector('[data-menu]').addEventListener('click', () => openReport(card));

  root.querySelector('[data-block]').addEventListener('click', async () => {
    try {
      await api.safety.block(card.memberId);
      toast('Blocked. They never appear again.');
      go('discover');
    } catch (err) { toastError(err); }
  });
}

/* ---------- your own account ---------- */

async function renderMine(root) {
  const [profile, photos, notifications] = await Promise.all([
    api.profile.mine(),
    api.photos.list(),
    api.notifications.list().catch(() => ({ notifications: [], unread: 0 })),
    loadTaxonomy()
  ]);
  const member = getSession().member;

  if (!profile) {
    root.innerHTML = '<section class="screen"><div class="empty"><h2>No profile yet</h2><p>Finish your application first.</p></div></section>';
    return;
  }

  const free = member?.side === 'female';

  root.innerHTML = `
    <section class="screen">
      <div class="pad" style="padding-top:18px;padding-bottom:16px">
        <h1 style="font-size:28px">${escapeHtml(profile.firstName || 'Your account')}</h1>
        <div class="meta" style="margin-top:4px;font-size:11.5px">
          ${escapeHtml(profile.age ?? '')}${member?.tier ? ` · ${escapeHtml(tierLabel(member.tier))}` : ''}
        </div>
        <div style="margin-top:12px">${badgeChips(member?.badges || [])}</div>
      </div>

      ${profile.pending ? `
        <div class="pad"><div class="notice">
          <strong>An edit is with our team</strong>
          Your live profile stays up until they have read it. Usually within a day.
        </div></div>` : ''}

      <div class="pad">
        <div class="section-head">
          <span class="eyebrow" style="margin:0">Photographs</span>
          <span class="meta">${photos.length} / 6</span>
        </div>
        <div class="photogrid">
          ${Array.from({ length: 6 }, (_, i) => photos[i]).map((photo, i) => photo ? `
            <div class="photoslot${photo.isPrimary ? ' photoslot--face' : ''}" data-photo="${photo.id}">
              <div class="duotone" style="width:100%;height:100%">
                <img src="/api/photos/${photo.id}/thumb" alt="Photograph ${i + 1}" loading="lazy" />
              </div>
              <button class="photoslot__x" data-remove="${photo.id}" type="button" aria-label="Remove photograph ${i + 1}">×</button>
              <span class="photoslot__tag${photo.moderationState === 'pending' ? ' photoslot__tag--pending' : ''}">
                ${photo.isPrimary ? 'Main' : photo.moderationState === 'pending' ? 'In review' : 'Live'}
              </span>
            </div>` : `
            <button class="photoslot photoslot--empty" data-add type="button" aria-label="Add a photograph">+</button>`).join('')}
        </div>
        <input type="file" id="photo-input" accept="image/jpeg,image/png,image/heic,image/webp" hidden />
        <p class="hint">Tap a photograph to make it your main one. New ones are checked before they go live.</p>
      </div>

      <div class="pad" style="margin-top:24px">
        <div class="eyebrow">What has been verified</div>
        ${badgeLegend(member?.badges || [])}
        <p class="legal" style="margin-top:10px">Marks are granted by a reviewer against evidence. No tier buys one.</p>
      </div>

      <div class="pad" style="margin-top:24px">
        <div class="section-head">
          <span class="eyebrow" style="margin:0">In your words</span>
          <button class="link" data-edit-bio type="button" style="font-size:12px">Edit</button>
        </div>
        <p style="font-size:14px;line-height:1.6;color:var(--t78)">${escapeHtml(profile.bio || 'Nothing here yet.')}</p>
        ${profile.prompts?.length ? `
          <div style="margin-top:16px">
            <div class="eyebrow">${escapeHtml(profile.prompts[0].q)}</div>
            <p style="font-size:14px;line-height:1.6;color:var(--t78)">${escapeHtml(profile.prompts[0].a)}</p>
          </div>` : ''}
      </div>

      <div class="pad" style="margin-top:24px">
        <div class="section-head">
          <span class="eyebrow" style="margin:0">Details</span>
          <button class="link" data-edit-details type="button" style="font-size:12px">Edit</button>
        </div>
        <div class="grid-list">
          ${fact('Work', profile.occupation)}
          ${fact('Where', profile.employer)}
          ${fact('City', profile.city)}
          ${fact('Looking for', profile.intent ? words(profile.intent) : null)}
          ${fact('Education', profile.education ? words(profile.education) : null)}
          ${fact('Height', heightLabel(profile.height))}
          ${fact('Children', profile.children ? words(profile.children) : null)}
          ${fact('Profile strength', `${profile.completeness}%`)}
        </div>
      </div>

      <div class="pad" style="margin-top:24px">
        <div class="section-head">
          <span class="eyebrow" style="margin:0">Open to</span>
          <button class="link" data-edit-interests type="button" style="font-size:12px">Edit</button>
        </div>
        <div class="tags">
          ${(profile.interestCategories || []).length
    ? profile.interestCategories.map((key) => `<span class="tag tag-outline">${escapeHtml(labelFor(key))}</span>`).join('')
    : '<span class="meta">Nothing declared. Members whose interests overlap yours are the ones who see you.</span>'}
        </div>
      </div>

      <div class="pad" style="margin-top:28px;padding-bottom:26px">
        <div class="eyebrow">Account</div>
        <div class="grid-list">
          ${hubRow('notifications', 'Notifications', notifications.unread
    ? `${notifications.unread} unread`
    : 'Decisions, matches and messages')}
          ${free
    ? hubRow('membership', 'Membership', 'Free, permanently')
    : hubRow('membership', 'Membership', member?.tier ? tierLabel(member.tier) : 'Not started')}
          ${member?.entitlements?.filters
    ? hubRow('interests', 'What you are looking for', 'The categories your deck is drawn from')
    : ''}
          ${hubRow('settings', 'Settings', 'Preferences, privacy, blocks, safety, your data')}
        </div>
      </div>
    </section>`;

  decorate(root);
  wireMine(root, profile, notifications);
}

function hubRow(route, title, note) {
  return `<button class="grid-row grid-row--tap" data-go="${route}" type="button">
    <div class="grid-row__body">
      <div class="grid-row__title">${escapeHtml(title)}</div>
      <div class="grid-row__note">${escapeHtml(note)}</div>
    </div>
    <span class="grid-row__chev">›</span>
  </button>`;
}

function fact(label, value) {
  if (!value) return '';
  return `<div class="grid-row" style="padding:11px 14px">
    <div class="grid-row__body"><div class="grid-row__note" style="margin:0">${escapeHtml(label)}</div></div>
    <span style="font-size:13px">${escapeHtml(value)}</span>
  </div>`;
}

function tierLabel(tier) {
  return String(tier).charAt(0).toUpperCase() + String(tier).slice(1);
}

function wireMine(root, profile, notifications) {
  const input = root.querySelector('#photo-input');
  root.querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', () => input.click()));

  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    toast('Uploading…');
    try {
      await api.photos.upload(file);
      toast('Added. It is checked before it goes live.');
      await refreshCurrent();
    } catch (err) { toastError(err); }
  });

  root.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api.photos.remove(btn.dataset.remove);
        await refreshCurrent();
      } catch (err) { toastError(err); }
    });
  });

  root.querySelectorAll('[data-photo]').forEach((node) => {
    node.addEventListener('click', async () => {
      try {
        await api.photos.setPrimary(node.dataset.photo);
        toast('Main photograph updated');
        await refreshCurrent();
      } catch (err) { toastError(err); }
    });
  });

  root.querySelectorAll('[data-go]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.go === 'notifications') {
        const { openNotifications } = await import('./notifications.js');
        openNotifications(notifications.notifications || []);
        await api.notifications.markRead().catch(() => {});
        await updateBadges();
        return;
      }
      go(btn.dataset.go);
    });
  });

  root.querySelector('[data-edit-bio]')?.addEventListener('click', () => editBio(profile));
  root.querySelector('[data-edit-details]')?.addEventListener('click', () => editDetails(profile));
  root.querySelector('[data-edit-interests]')?.addEventListener('click', () => editInterests(profile));
}

/* ---------- editors ---------- */

function editBio(profile) {
  const prompt = profile.prompts?.[0] || { q: 'A perfect Sunday', a: '' };
  openSheet(`
    <h2>In your words</h2>
    <p class="muted" style="margin:8px 0 18px">
      Written changes are read by our team before they go live. Your current profile stays up meanwhile.
    </p>
    <form id="bio-form">
      <div class="field">
        <label for="e-bio">About you</label>
        <textarea id="e-bio" name="bio" maxlength="300">${escapeHtml(profile.bio || '')}</textarea>
      </div>
      <div class="field">
        <label for="e-a">${escapeHtml(prompt.q)}</label>
        <textarea id="e-a" name="promptA" maxlength="250">${escapeHtml(prompt.a || '')}</textarea>
      </div>
      <button class="btn btn--primary btn--full" type="submit">Send for review</button>
    </form>`, {
    label: 'In your words',
    onMount(sheet) {
      sheet.querySelector('#bio-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api.profile.save({
            bio: fd.get('bio'),
            prompts: [{ q: prompt.q, a: fd.get('promptA') }]
          });
          closeSheet();
          toast('Sent for review');
          await refreshCurrent();
        } catch (err) { toastError(err); }
      });
    }
  });
}

function editDetails(profile) {
  const select = (name, label, options, value) => `
    <div class="field">
      <label for="e-${name}">${label}</label>
      <select id="e-${name}" name="${name}">
        <option value="">—</option>
        ${options.map((o) => `<option value="${o}" ${value === o ? 'selected' : ''}>${escapeHtml(words(o))}</option>`).join('')}
      </select>
    </div>`;

  openSheet(`
    <h2>Details</h2>
    <form id="details-form" style="margin-top:16px">
      <div class="field">
        <label for="e-occupation">What you do</label>
        <input id="e-occupation" name="occupation" type="text" value="${escapeHtml(profile.occupation || '')}" />
      </div>
      <div class="field">
        <label for="e-employer">Where</label>
        <input id="e-employer" name="employer" type="text" value="${escapeHtml(profile.employer || '')}" />
      </div>
      <div class="field">
        <label for="e-height">Height in centimetres</label>
        <input id="e-height" name="height" type="number" min="120" max="230" value="${escapeHtml(profile.height || '')}" />
      </div>
      ${select('intent', 'Looking for', ['long_term', 'life_partner', 'still_deciding'], profile.intent)}
      ${select('education', 'Education', ['secondary', 'undergraduate', 'postgraduate', 'doctorate'], profile.education)}
      ${select('drinking', 'Drinking', ['never', 'socially', 'regularly'], profile.drinking)}
      ${select('smoking', 'Smoking', ['never', 'socially', 'regularly'], profile.smoking)}
      ${select('children', 'Children', ['none', 'have_children', 'want_children', 'prefer_not_to_say'], profile.children)}
      <button class="btn btn--primary btn--full" type="submit">Save</button>
    </form>`, {
    label: 'Details',
    onMount(sheet) {
      sheet.querySelector('#details-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {};
        for (const [key, value] of fd.entries()) if (value !== '') payload[key] = value;
        if (payload.height) payload.height = Number(payload.height);
        try {
          await api.profile.save(payload);
          closeSheet();
          toast('Saved');
          await refreshCurrent();
        } catch (err) { toastError(err); }
      });
    }
  });
}

/**
 * What you are open to, after the application. Same taxonomy, same disclosure —
 * changing it changes who sees you, and nothing else.
 */
async function editInterests(profile) {
  const data = await loadTaxonomy();
  const chosen = new Set(profile.interestCategories || []);

  openSheet(`
    <h2>What are you open to?</h2>
    <p class="muted" style="margin:8px 0 18px">Only members whose interests overlap yours will see you.</p>
    <div class="stack" style="gap:18px">
      ${(data.groups || []).map((group) => `
        <div>
          <div class="eyebrow eyebrow--accent">${escapeHtml(group.label)}</div>
          <div class="tags">
            ${group.options.map((option) => `
              <button class="chip" type="button" data-key="${escapeHtml(option.key)}"
                aria-pressed="${chosen.has(option.key)}">${escapeHtml(option.label)}</button>`).join('')}
          </div>
        </div>`).join('')}
    </div>
    <p class="legal" style="margin-top:18px">
      Exclusivity takes no part in any arrangement and no money moves between members.
    </p>
    <button class="btn btn--primary btn--full" style="margin-top:14px" data-save type="button">Save</button>`, {
    label: 'What are you open to',
    onMount(sheet) {
      sheet.querySelectorAll('[data-key]').forEach((chip) => {
        chip.addEventListener('click', () => {
          const key = chip.dataset.key;
          if (chosen.has(key)) chosen.delete(key);
          else chosen.add(key);
          chip.setAttribute('aria-pressed', String(chosen.has(key)));
        });
      });
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        try {
          await api.profile.save({ interestCategories: [...chosen] });
          closeSheet();
          toast('Saved');
          await refreshCurrent();
        } catch (err) { toastError(err); }
      });
    }
  });
}
