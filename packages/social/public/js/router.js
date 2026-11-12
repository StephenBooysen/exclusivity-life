/**
 * Hash router with a server-decided gate.
 *
 * Which screens a member may reach is decided by their status, and the server
 * is the authority on that — /auth/me returns the next step. The client
 * enforces it for a coherent experience, never for security.
 */

import { api } from './api.js';
import { escapeHtml } from './format.js';
import { decorate } from './blueprint.js';
import { closeSheet } from './components/sheet.js';

import { renderGate } from './views/gate.js';
import { renderApply } from './views/apply.js';
import { renderStatus } from './views/status.js';
import { renderDiscover } from './views/discover.js';
import { renderInterests } from './views/interests.js';
import { renderMatches } from './views/matches.js';
import { renderChat } from './views/chat.js';
import { renderProfile } from './views/profile.js';
import { renderMembership } from './views/membership.js';
import { renderSettings } from './views/settings.js';
import { renderAdmin } from './views/admin.js';

/**
 * `tab` is which of the three tab-bar items lights up. Profile, settings and
 * membership all sit under ACCOUNT — the design's tab bar has three items, so
 * the account screen is the hub for everything that used to be its own tab.
 */
const routes = {
  gate: { render: renderGate, chrome: false },
  apply: { render: renderApply, chrome: false },
  status: { render: renderStatus, chrome: false },
  membership: { render: renderMembership, chrome: false },
  discover: { render: renderDiscover, chrome: true, tab: 'discover' },
  interests: { render: renderInterests, chrome: false },
  matches: { render: renderMatches, chrome: true, tab: 'matches' },
  chat: { render: renderChat, chrome: false },
  profile: { render: renderProfile, chrome: true, tab: 'profile' },
  settings: { render: renderSettings, chrome: true, tab: 'profile' },
  // The console is staff-only and has its own tabs. The member tab bar would
  // offer three screens a moderator has no account for.
  admin: { render: renderAdmin, chrome: false }
};

/** Screens reachable only once a member is through the door. */
const MEMBER_ONLY = ['discover', 'matches', 'chat', 'profile', 'interests'];

let session = { member: null, application: null, next: 'gate' };
let current = 'gate';

export function getSession() { return session; }

export async function refreshSession() {
  try {
    session = await api.auth.me();
  } catch {
    session = { member: null, application: null, next: 'gate' };
  }
  return session;
}

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [key, param] = raw.split('/');
  return { key: routes[key] ? key : null, param };
}

/** Where this member is allowed to be, given where they asked to go. */
function resolve(requested) {
  if (!session.member) return 'gate';

  const staff = ['moderator', 'admin'].includes(session.member.role);
  if (staff) return requested && requested !== 'gate' ? requested : 'admin';

  const next = session.next;
  if (next === 'apply' && requested !== 'apply') return 'apply';
  if (next === 'status' && !['status', 'settings'].includes(requested)) return 'status';
  if (next === 'membership' && !['membership', 'settings', 'matches', 'chat'].includes(requested)) return 'membership';
  if (!requested) return next === 'discover' ? 'discover' : next;
  if (MEMBER_ONLY.includes(requested) && next !== 'discover') return next;
  return requested;
}

/**
 * `param` matters: `profile` with an id is someone else's profile, which is a
 * sub-screen reached from the deck or a conversation and carries a back arrow
 * of its own. The tab bar belongs to the three top-level screens only.
 */
function setChrome(routeKey, param) {
  const route = routes[routeKey];
  const chrome = route.chrome && !(routeKey === 'profile' && param);
  document.getElementById('tabbar').hidden = !chrome;
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.route === route.tab;
    tab.classList.toggle('active', on);
    if (on) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
}

export async function renderRoute(requestedKey, param) {
  // A sheet belongs to the screen that opened it. Without this it survives the
  // navigation and sits over the next screen — and the controls sheet in
  // particular then describes a conversation the member has already left.
  closeSheet();

  let key = resolve(requestedKey);

  // The cached session can lag the server — a member approved while their tab
  // was open still looks pending here. Before refusing a navigation, re-read
  // the session once and try again, so a stale cache can never strand someone
  // on a screen the server would let them leave.
  if (requestedKey && key !== requestedKey) {
    await refreshSession();
    key = resolve(requestedKey);
  }

  current = key;

  if (requestedKey && key !== requestedKey) {
    location.hash = `#/${key}`;
    return;
  }

  setChrome(key, param);
  const root = document.getElementById('view-root');
  // Loading is a hairline frame. No shimmer — the design has no fake motion.
  root.innerHTML = `<div class="skeleton" style="height:${key === 'discover' ? 420 : 160}px"></div>`;

  try {
    await routes[key].render(root, param);
  } catch (err) {
    root.innerHTML = `<div class="empty">
      <h2>This screen didn't load</h2>
      <p>${escapeHtml(err.message || 'Try again in a moment.')}</p>
      <button class="btn btn--sm" style="margin-top:18px" onclick="location.reload()">Reload</button>
    </div>`;
  }

  // Registration marks are added here, once, so no template can drop them.
  decorate(root);
}

export function go(key, param) {
  location.hash = param ? `#/${key}/${param}` : `#/${key}`;
}

/** Re-renders whichever screen is on, after a mutation elsewhere. */
export function refreshCurrent() {
  const { param } = parseHash();
  return renderRoute(current, param);
}

export function initRouter() {
  document.getElementById('tabbar').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) go(tab.dataset.route);
  });

  window.addEventListener('hashchange', () => {
    const { key, param } = parseHash();
    renderRoute(key, param);
  });

  const { key, param } = parseHash();
  return renderRoute(key, param);
}
