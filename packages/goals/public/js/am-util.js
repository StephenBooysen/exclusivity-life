/** Shared helpers for the Almanac screens. */
window.AM = (function () {
  'use strict';

  const PRIORITY_TAG = { high: 'tag-accent-2', medium: 'tag-accent', low: 'tag-neutral' };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Local calendar date as YYYY-MM-DD (never UTC — habit logs are local days). */
  function isoDate(date) {
    const d = date || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  /** Monday-first list of the current week's dates. */
  function currentWeekDates() {
    const now = new Date();
    const offset = (now.getDay() + 6) % 7; // 0 = Monday
    const monday = new Date(now);
    monday.setDate(now.getDate() - offset);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }

  /** Consecutive completed days ending today (or yesterday, if today is still open). */
  function streakFor(completedSet) {
    let streak = 0;
    if (!completedSet.has(isoDate())) {
      if (!completedSet.has(isoDate(daysAgo(1)))) return 0;
      streak = 0;
    }
    for (let i = completedSet.has(isoDate()) ? 0 : 1; i < 400; i++) {
      if (!completedSet.has(isoDate(daysAgo(i)))) break;
      streak++;
    }
    return streak;
  }

  const CHECK_SVG =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-bg)" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';

  // Lucide-weight flame. The prototype's hand-drawn path collapses into an
  // unreadable squiggle at 13px, so this uses the real icon-set shape instead,
  // per the brief's note to swap the hand-drawn SVGs for a line set.
  const FLAME_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 ' +
    '.5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>';

  function priorityTag(priority) { return PRIORITY_TAG[priority] || 'tag-neutral'; }

  async function get(path) {
    const res = await fetch('/api' + path);
    if (!res.ok) throw new Error(path + ' → ' + res.status);
    return res.json();
  }

  async function send(method, path, body) {
    const res = await fetch('/api' + path, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(path + ' → ' + res.status);
    return res.json();
  }

  return {
    esc: esc, isoDate: isoDate, daysAgo: daysAgo, currentWeekDates: currentWeekDates,
    streakFor: streakFor, priorityTag: priorityTag,
    CHECK_SVG: CHECK_SVG, FLAME_SVG: FLAME_SVG,
    get: get,
    put: function (p, b) { return send('PUT', p, b); },
    post: function (p, b) { return send('POST', p, b); }
  };
})();
