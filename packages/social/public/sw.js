/**
 * Service worker.
 *
 * Caches the shell so the app opens offline. API responses are never cached —
 * a stale deck or a stale conversation is worse than an honest empty state,
 * and photographs are authorised per request, so caching them would leak
 * across a sign-out.
 */

// Bumped whenever the shell file list or the design system changes, so an old
// cache cannot serve last version's stylesheet against this version's markup.
const SHELL = 'exclusivity-shell-v3';

const SHELL_FILES = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/js/api.js',
  '/js/router.js',
  '/js/format.js',
  '/js/toast.js',
  '/js/badges.js',
  '/js/blueprint.js',
  '/js/badgecount.js',
  '/js/interests.js',
  '/js/realtime.js',
  '/js/components/sheet.js',
  '/js/views/gate.js',
  '/js/views/apply.js',
  '/js/views/status.js',
  '/js/views/discover.js',
  '/js/views/interests.js',
  '/js/views/matches.js',
  '/js/views/chat.js',
  '/js/views/profile.js',
  '/js/views/membership.js',
  '/js/views/settings.js',
  '/js/views/admin.js',
  '/js/views/notifications.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  // Never cache the API — including photographs, which are authorised per request.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/rt')) return;

  /*
    Network first, cache only as the fallback.

    This used to return the cached copy whenever one existed, which meant the
    running app was always one deploy behind — and a frontend talking to a
    backend it does not match is worse than a slow load. The rename made that
    concrete: a cached api.js still looking for the old CSRF cookie sends no
    token to a server that has already moved on, and every sign-in fails with
    "your session expired" until the cache happens to turn over.
  */
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
  );
});
