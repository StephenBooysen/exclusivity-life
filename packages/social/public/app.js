/**
 * Boot: resolve the session, start the router, wire the realtime badge.
 */

import { onUnauthorised } from './js/api.js';
import { initRouter, refreshSession, refreshCurrent, go, getSession } from './js/router.js';
import { updateBadges } from './js/badgecount.js';
import * as rt from './js/realtime.js';
import { toast } from './js/toast.js';

function wireRealtime() {
  rt.connect();

  rt.on('match:created', () => {
    toast('You have a new match');
    updateBadges();
  });

  /**
   * Some notifications mean the account itself changed underneath the member —
   * approved, suspended, membership lapsed. The cached session would keep them
   * on a screen that is no longer true, so re-resolve it and re-render.
   */
  const STATE_CHANGING = ['application.', 'membership.', 'moderation.'];

  rt.on('notification:new', async (notification) => {
    updateBadges();
    if (STATE_CHANGING.some((prefix) => notification?.type?.startsWith(prefix))) {
      const before = getSession().next;
      const after = (await refreshSession()).next;
      if (before !== after) {
        go(after);
        await refreshCurrent();
      }
    }
  });

  rt.on('message:new', () => {
    updateBadges();
    // The chat view listens for itself; elsewhere only the badge changes.
  });

  rt.on('match:closed', () => {
    if (location.hash.startsWith('#/chat')) {
      toast('This conversation is closed');
      go('matches');
    }
  });
}

/**
 * The offline state, stated plainly.
 *
 * The service worker serves the shell from cache, so the app opens with no
 * network — but nothing on screen is guaranteed fresh and a send will fail.
 * Saying so is the honest version; pretending to be online is the dark pattern.
 */
function wireConnectivity() {
  const banner = document.getElementById('offline');
  const paint = () => { banner.hidden = navigator.onLine; };
  window.addEventListener('online', () => {
    paint();
    // Whatever is on screen was loaded from cache or is stale by however long
    // the connection was down, so re-read it rather than leaving it.
    refreshSession().then(() => refreshCurrent()).catch(() => {});
  });
  window.addEventListener('offline', paint);
  paint();
}

async function boot() {
  wireConnectivity();

  onUnauthorised(() => {
    if (!location.hash.startsWith('#/gate')) {
      location.hash = '#/gate';
      refreshSession().then(() => refreshCurrent());
    }
  });

  await refreshSession();
  await initRouter();

  if (getSession().member) {
    wireRealtime();
    updateBadges();
    setInterval(updateBadges, 60000);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

boot();
