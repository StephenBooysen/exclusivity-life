/**
 * Settings — preferences, privacy, notifications, blocks, safety, your data.
 *
 * Leaving is as easy as joining: pause and delete are on this screen, not
 * buried, and neither is preceded by a retention wall.
 */

import { api } from '../api.js';
import { escapeHtml, fullDate } from '../format.js';
import { toast, toastError } from '../toast.js';
import { go } from '../router.js';
import { openSheet, closeSheet, confirmSheet } from '../components/sheet.js';
import { decorate } from '../blueprint.js';

export async function renderSettings(root) {
  const [settings, blocks] = await Promise.all([api.settings.get(), api.safety.blocks()]);
  const { member, preferences, membership } = settings;

  root.innerHTML = `
    <section class="screen">
      <div class="backrow">
        <button class="glyphbtn glyphbtn--quiet" data-back type="button" aria-label="Back">←</button>
        <span class="eyebrow" style="margin:0">Account</span>
      </div>

      <div class="pad" style="padding-top:22px">
        <h1>Settings</h1>
        <p class="lede" style="margin-top:6px">${escapeHtml(member.displayName || '')}</p>
      </div>

      <div class="pad" style="margin-top:26px">
        <div class="eyebrow">Who you'd like to meet</div>
        <div class="field">
          <label for="s-age">Age range</label>
          <div style="display:flex;align-items:center;gap:10px">
            <input id="s-age" type="number" min="18" max="99" value="${escapeHtml(preferences.ageMin)}" data-pref="ageMin" style="width:90px" />
            <span class="dim">to</span>
            <input type="number" min="18" max="99" value="${escapeHtml(preferences.ageMax)}" data-pref="ageMax" style="width:90px" aria-label="Maximum age" />
          </div>
        </div>
        <div class="field">
          <label for="s-dist">Within</label>
          <select id="s-dist" data-pref="distanceKm">
            ${[10, 25, 50, 100, 250].map((km) => `<option value="${km}" ${preferences.distanceKm === km ? 'selected' : ''}>${km} km</option>`).join('')}
          </select>
          <p class="hint">Other members only ever see a band, never a distance.</p>
        </div>
      </div>

      <div class="pad" style="margin-top:26px">
        <div class="eyebrow">Privacy</div>
        ${toggle('Show when I was last active', 'privacy.showOnlineStatus', preferences.privacy.showOnlineStatus)}
        ${toggle('Show read receipts', 'privacy.showReadReceipts', preferences.privacy.showReadReceipts,
    'Reciprocal — off means you cannot see theirs.')}
        ${toggle('Browse without appearing', 'privacy.incognito', preferences.privacy.incognito,
    'You stay out of other decks. Liking someone still reveals you to them.')}
      </div>

      <div class="pad" style="margin-top:26px">
        <div class="eyebrow">Email me about</div>
        ${toggle('New matches', 'notifications.newMatch.email', preferences.notifications.newMatch?.email)}
        ${toggle('New messages', 'notifications.newMessage.email', preferences.notifications.newMessage?.email)}
        ${toggle("Today's introductions", 'notifications.dailyIntroductions.email', preferences.notifications.dailyIntroductions?.email)}
        <p class="hint">Decisions about your account and anything from the safety team are always sent.</p>
      </div>

      <div class="pad" style="margin-top:26px">
        <div class="eyebrow">Membership</div>
        <div class="grid-list">
          <button class="grid-row grid-row--tap" data-membership type="button">
            <div class="grid-row__body">
              <div class="grid-row__title">${membership.free ? 'Free, permanently' : membership.tier ? escapeHtml(membership.tier) : 'Not started'}</div>
              <div class="grid-row__note">${membership.free
    ? 'There is nothing to buy on your side.'
    : membership.tier
      ? `${membership.cancelAtPeriodEnd ? 'Ends' : 'Renews'} ${escapeHtml(fullDate(membership.currentPeriodEnd))}`
      : 'Choose a tier to open your introductions.'}</div>
            </div>
            <span class="grid-row__chev">›</span>
          </button>
        </div>
      </div>

      <div class="pad" style="margin-top:26px">
        <div class="section-head">
          <span class="eyebrow" style="margin:0">Blocked</span>
          <span class="meta">${blocks.length}</span>
        </div>
        <div class="grid-list">
          ${blocks.length ? blocks.map((b) => `
            <div class="grid-row">
              <div class="grid-row__body">
                <div class="grid-row__title">Blocked ${escapeHtml(fullDate(b.createdAt))}</div>
                <div class="grid-row__note">${escapeHtml(b.reason || 'No reason given')}</div>
              </div>
              <button class="btn btn--sm" data-unblock="${escapeHtml(b.toMemberId)}" type="button">Unblock</button>
            </div>`).join('')
    : '<div class="grid-row"><div class="grid-row__body"><div class="grid-row__note" style="margin:0">Nobody.</div></div></div>'}
        </div>
      </div>

      <div class="pad" style="margin-top:26px">
        <div class="eyebrow">Safety and your data</div>
        <div class="grid-list">
          <button class="grid-row grid-row--tap" data-safety type="button">
            <div class="grid-row__body">
              <div class="grid-row__title">Safety guide</div>
              <div class="grid-row__note">What to expect, and the one warning sign that matters.</div>
            </div>
            <span class="grid-row__chev">›</span>
          </button>
          <a class="grid-row grid-row--tap" href="${api.settings.exportUrl}" download>
            <div class="grid-row__body">
              <div class="grid-row__title">Download everything we hold</div>
              <div class="grid-row__note">A single file, generated now.</div>
            </div>
            <span class="grid-row__chev">›</span>
          </a>
          <button class="grid-row grid-row--tap" data-password type="button">
            <div class="grid-row__body">
              <div class="grid-row__title">Change password</div>
              <div class="grid-row__note">Signs you out on every other device.</div>
            </div>
            <span class="grid-row__chev">›</span>
          </button>
        </div>
      </div>

      <div class="pad" style="margin-top:26px;padding-bottom:30px">
        <div class="eyebrow">Leaving</div>
        <div class="grid-list">
          <button class="grid-row grid-row--tap" data-pause type="button">
            <div class="grid-row__body">
              <div class="grid-row__title">Pause my account</div>
              <div class="grid-row__note">You disappear and receive nothing. Conversations are untouched.</div>
            </div>
            <span class="grid-row__chev">›</span>
          </button>
          <button class="grid-row grid-row--tap" data-signout type="button">
            <div class="grid-row__body"><div class="grid-row__title">Sign out</div></div>
            <span class="grid-row__chev">›</span>
          </button>
          <button class="grid-row grid-row--tap" data-delete type="button">
            <div class="grid-row__body">
              <div class="grid-row__title">Delete my account</div>
              <div class="grid-row__note">Permanent. Profile, photographs and conversations go.</div>
            </div>
            <span class="grid-row__chev">›</span>
          </button>
        </div>
        <p class="legal" style="margin-top:14px">
          Billing records and safety records are kept because we are required to keep them.
        </p>
      </div>
    </section>`;

  decorate(root);
  wire(root);
}

function toggle(label, path, value, hint) {
  const id = `t-${path.replace(/\./g, '-')}`;
  return `<label class="switch" for="${id}">
    <span class="switch__label">${escapeHtml(label)}${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</span>
    <input type="checkbox" id="${id}" data-toggle="${path}" ${value ? 'checked' : ''} />
    <span class="switch__state" aria-hidden="true"></span>
  </label>`;
}

function setDeep(target, path, value) {
  const parts = path.split('.');
  let node = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    node[parts[i]] = node[parts[i]] || {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
  return target;
}

/** The safety guide, exported so the applicant's status screen can open it too. */
export function openSafetyGuide() {
  openSheet(`
    <h2>Staying safe</h2>
    <div class="stack" style="gap:16px;margin-top:16px;font-size:13.5px;line-height:1.65;color:var(--t62)">
      <p><strong style="color:var(--text)">Meet in public, the first few times.</strong>
      A restaurant or a hotel bar. Arrange your own transport there and back.</p>
      <p><strong style="color:var(--text)">Tell someone where you're going.</strong>
      Send a friend the name, the place and the time.</p>
      <p><strong style="color:var(--text)">Money is the warning sign.</strong>
      Nobody on Exclusivity has any reason to ask you for money, for your banking details, or to
      offer you an arrangement. If it happens, report it — that person is breaking our rules
      and we will remove them.</p>
      <p><strong style="color:var(--text)">Stay on Exclusivity until you're ready.</strong>
      Someone pushing hard to move to another app in the first few messages is a pattern we
      see from scammers.</p>
      <p><strong style="color:var(--text)">Trust yourself.</strong>
      You can unmatch or block at any moment, and you never have to explain it.</p>
    </div>
    <button class="btn btn--quiet btn--full" style="margin-top:20px" data-close type="button">Close</button>`, {
    label: 'Staying safe'
  });
}

function wire(root) {
  root.querySelector('[data-back]')?.addEventListener('click', () => go('profile'));

  root.querySelectorAll('[data-pref]').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await api.settings.preferences({ [input.dataset.pref]: Number(input.value) });
        toast('Saved');
      } catch (err) { toastError(err); }
    });
  });

  root.querySelectorAll('[data-toggle]').forEach((input) => {
    input.addEventListener('change', async () => {
      const path = input.dataset.toggle;
      const [group, ...rest] = path.split('.');
      const payload = setDeep({}, rest.join('.'), input.checked);
      try {
        if (group === 'privacy') await api.settings.privacy(payload);
        else await api.settings.notifications(payload);
        toast('Saved');
      } catch (err) {
        toastError(err);
        input.checked = !input.checked;
      }
    });
  });

  root.querySelectorAll('[data-unblock]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.safety.unblock(btn.dataset.unblock);
        toast('Unblocked');
        location.reload();
      } catch (err) { toastError(err); }
    });
  });

  root.querySelector('[data-membership]')?.addEventListener('click', () => go('membership'));
  root.querySelector('[data-safety]')?.addEventListener('click', () => openSafetyGuide());

  root.querySelector('[data-password]')?.addEventListener('click', () => {
    openSheet(`
      <h2>Change password</h2>
      <p class="muted" style="margin:8px 0 18px">This signs you out on every other device.</p>
      <form id="pw-form">
        <div class="field">
          <label for="pw-current">Current password</label>
          <input id="pw-current" name="currentPassword" type="password" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label for="pw-new">New password</label>
          <input id="pw-new" name="newPassword" type="password" autocomplete="new-password" required />
        </div>
        <button class="btn btn--primary btn--full" type="submit">Change it</button>
      </form>`, {
      label: 'Change password',
      onMount(sheet) {
        sheet.querySelector('#pw-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            await api.auth.changePassword({
              currentPassword: fd.get('currentPassword'),
              newPassword: fd.get('newPassword')
            });
            closeSheet();
            toast('Password changed');
          } catch (err) { toastError(err); }
        });
      }
    });
  });

  root.querySelector('[data-pause]')?.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Pause your account?',
      body: 'You disappear from introductions and receive none. Your conversations are untouched and you can come back whenever.',
      confirmLabel: 'Pause it'
    });
    if (!ok) return;
    try {
      await api.settings.pause();
      location.reload();
    } catch (err) { toastError(err); }
  });

  root.querySelector('[data-signout]')?.addEventListener('click', async () => {
    await api.auth.logout();
    location.hash = '#/gate';
    location.reload();
  });

  root.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Delete your account?',
      body: 'This cannot be undone. Your profile, photographs and conversations are removed.',
      confirmLabel: 'Delete it permanently',
      danger: true
    });
    if (!ok) return;
    try {
      await api.settings.remove();
      location.hash = '#/gate';
      location.reload();
    } catch (err) { toastError(err); }
  });
}
