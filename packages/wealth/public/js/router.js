import { renderHome } from './views/home.js';
import { renderAccounts } from './views/accounts.js';
import { renderCashflow } from './views/cashflow.js';
import { renderWealth } from './views/wealth.js';
import { renderSettings } from './views/settings.js';
import { api } from './api.js';
import { initials } from './format.js';
import { getTodayDate } from './cycle.js';

const routes = {
  home: { render: renderHome },
  accounts: { render: renderAccounts },
  cashflow: { render: renderCashflow },
  wealth: { render: renderWealth },
  settings: { render: renderSettings }
};

let currentRoute = 'home';
let profileCache = null;

function routeFromHash() {
  const key = (location.hash || '').replace('#/', '');
  return routes[key] ? key : 'home';
}

function timeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

async function updateHeader() {
  if (!profileCache) {
    const settings = await api.settings.get();
    profileCache = { name: settings.profileName || 'Me Money Manager', email: settings.profileEmail || '' };
  }
  document.getElementById('greeting').textContent = timeOfDayGreeting();
  document.getElementById('profile-name').textContent = profileCache.name;
  document.getElementById('avatar').textContent = initials(profileCache.name);
}

/** Drops the cached profile so the header re-reads settings on next render (after Settings edits it). */
export function invalidateProfileCache() {
  profileCache = null;
}

/** Shows a persistent banner whenever ?date=YYYYMMDD is overriding "today", so simulated data is never mistaken for real data. */
function updateDebugBanner() {
  const existing = document.getElementById('debug-date-banner');
  const hasOverride = /^\d{8}$/.test(new URLSearchParams(location.search).get('date') || '');
  if (!hasOverride) {
    existing?.remove();
    return;
  }
  const label = getTodayDate().toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  if (existing) {
    existing.textContent = `🕐 Debug date: ${label} — remove ?date= from the URL to reset`;
    return;
  }
  const banner = document.createElement('div');
  banner.id = 'debug-date-banner';
  banner.className = 'debug-date-banner';
  banner.textContent = `🕐 Debug date: ${label} — remove ?date= from the URL to reset`;
  document.getElementById('app').prepend(banner);
}

function updateChrome(routeKey) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.route === routeKey);
  });
}

export async function renderRoute(routeKey = currentRoute) {
  currentRoute = routes[routeKey] ? routeKey : 'home';
  updateChrome(currentRoute);
  updateDebugBanner();
  await updateHeader().catch(() => {});
  const root = document.getElementById('view-root');
  root.innerHTML = '<div class="skeleton" style="height:120px;border-radius:18px;margin:20px 0;"></div>';
  try {
    await routes[currentRoute].render(root);
  } catch (err) {
    root.innerHTML = `<div class="empty-state"><p>Something went wrong loading this screen.</p><p class="muted">${err.message}</p></div>`;
  }
}

/** Re-renders whichever view is currently on screen — used after a modal save. */
export function refreshCurrentRoute() {
  return renderRoute(currentRoute);
}

export function initRouter() {
  document.getElementById('tabbar').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    location.hash = `#/${tab.dataset.route}`;
  });

  window.addEventListener('hashchange', () => renderRoute(routeFromHash()));
  renderRoute(routeFromHash());
}
