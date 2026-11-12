/**
 * A10 — what are you looking for.
 *
 * The interest filter changes which members a deck is drawn from. It does not,
 * and must not, change who may message whom: contact is gated by a like back
 * and by nothing else, at any tier. The footer says so on the screen because
 * that is the part a member would otherwise have to guess at.
 *
 * The match count is a server query on every toggle, debounced — the pool is
 * never fully loaded here, so a client-side count would be a guess.
 */

import { api } from '../api.js';
import { escapeHtml } from '../format.js';
import { toast, toastError } from '../toast.js';
import { getSession, go } from '../router.js';
import { decorate } from '../blueprint.js';

const DEBOUNCE_MS = 220;

export async function renderInterests(root) {
  const [data, preferences] = await Promise.all([
    api.discovery.interests(),
    api.profile.preferences().catch(() => null)
  ]);
  const member = getSession().member;
  const selected = new Set(data.selected || []);
  let timer = null;
  let counting = 0;

  function paint() {
    root.innerHTML = `
      <section class="screen screen--fixed">
        <div class="backrow">
          <button class="glyphbtn glyphbtn--quiet" data-back type="button" aria-label="Back">←</button>
          <span class="eyebrow" style="margin:0">Discovery${data.tier ? ` · ${escapeHtml(title(data.tier))}` : ''}</span>
        </div>
        <div class="pad" style="padding-top:22px">
          <h1 class="h-lg">What are you looking for?</h1>
          <p class="lede" style="margin-top:6px;font-size:12.5px">
            Your deck is built only from members who chose the same. Selecting more widens it;
            selecting one narrows it hard.
          </p>
        </div>

        <div class="pad screen__scroll" style="padding-top:22px;display:flex;flex-direction:column;gap:18px">
          ${(data.groups || []).map((group) => `
            <div>
              <div class="eyebrow eyebrow--accent">${escapeHtml(group.label)}</div>
              <div class="tags">
                ${group.options.map((option) => `
                  <button class="chip" type="button" data-key="${escapeHtml(option.key)}"
                    aria-pressed="${selected.has(option.key)}" ${data.allowed ? '' : 'disabled'}>${escapeHtml(option.label)}</button>`).join('')}
              </div>
            </div>`).join('')}

          <div class="blueprint" style="margin-top:auto;padding:14px 15px;display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div>
              <h3 id="count">${countLine(data.count, selected.size)}</h3>
              <div class="meta" style="margin-top:3px">${escapeHtml(scopeLine(member, preferences))}</div>
            </div>
            <span class="tag tag-accent" id="chosen">${selected.size} selected</span>
          </div>
        </div>

        <div class="screen__bar">
          <p class="legal" style="margin-bottom:12px">
            Interest filters are Elite and above. They change who you see — never who may message you.
          </p>
          <button class="btn btn--primary btn--block" style="height:50px" data-save type="button" ${data.allowed ? '' : 'disabled'}>
            ${data.allowed ? 'Save preferences' : 'Elite and above'}
          </button>
          ${data.allowed ? '' : `
            <button class="btn btn--quiet btn--full" style="margin-top:10px" data-upgrade type="button">See what Elite includes</button>`}
        </div>
      </section>`;

    decorate(root);
    wire();
  }

  function wire() {
    root.querySelector('[data-back]').addEventListener('click', () => history.back());
    root.querySelector('[data-upgrade]')?.addEventListener('click', () => go('membership'));

    root.querySelectorAll('[data-key]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const key = chip.dataset.key;
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        chip.setAttribute('aria-pressed', String(selected.has(key)));
        root.querySelector('#chosen').textContent = `${selected.size} selected`;
        recount();
      });
    });

    root.querySelector('[data-save]').addEventListener('click', async () => {
      const btn = root.querySelector('[data-save]');
      btn.disabled = true;
      try {
        await api.discovery.saveInterests([...selected]);
        toast('Saved. Tomorrow\'s deck uses this.');
        go('discover');
      } catch (err) {
        toastError(err);
        btn.disabled = false;
      }
    });
  }

  /** Debounced so a run of toggles is one query, not one per tap. */
  function recount() {
    clearTimeout(timer);
    const node = root.querySelector('#count');
    node.textContent = 'Counting…';
    const generation = ++counting;
    timer = setTimeout(async () => {
      try {
        const { count } = await api.discovery.countInterests([...selected]);
        // A slower earlier query must not overwrite a newer answer.
        if (generation !== counting) return;
        node.textContent = countLine(count, selected.size);
      } catch {
        if (generation === counting) node.textContent = 'Count unavailable';
      }
    }, DEBOUNCE_MS);
  }

  paint();
}

function countLine(count, chosen) {
  if (count == null) return 'Count unavailable';
  const suffix = chosen === 0 ? ' (no filter)' : '';
  return `${count} member${count === 1 ? '' : 's'} match${suffix}`;
}

/** What the count is scoped to, so the number is never read out of context. */
function scopeLine(member, preferences) {
  const parts = [member?.city || 'Johannesburg'];
  if (preferences?.distanceKm) parts.push(`within ${preferences.distanceKm} km`);
  if (preferences?.ageMin && preferences?.ageMax) parts.push(`${preferences.ageMin}–${preferences.ageMax}`);
  return parts.join(' · ');
}

function title(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}
