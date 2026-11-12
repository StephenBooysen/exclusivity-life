'use strict';

/**
 * Pay-cycle date helpers — the backend counterpart to public/js/cycle.js. A cycle runs
 * from payday of one calendar month to the day before payday of the next (e.g. 27 Jul –
 * 26 Aug), matching how Cash Flow and the Home dashboard both read "this month". Dates
 * are plain 'YYYY-MM-DD' strings so they sort/compare lexicographically.
 */

function pad2(n) { return String(n).padStart(2, '0'); }
function clampDay(day) { return Math.min(Math.max(day || 1, 1), 28); }
function fromDate(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`; }
function parseISODate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }

/** The pay-cycle start (an ISO date) that contains `iso` — the most recent payday on/before it. */
function cycleStartContaining(iso, paydayDay) {
  const day = clampDay(paydayDay);
  const d = parseISODate(iso);
  const start = new Date(d.getFullYear(), d.getMonth(), day);
  if (d.getDate() < day) start.setMonth(start.getMonth() - 1);
  return fromDate(start);
}

function cycleEndFor(cycleStartIso, paydayDay) {
  const day = clampDay(paydayDay);
  const start = parseISODate(cycleStartIso);
  return fromDate(new Date(start.getFullYear(), start.getMonth() + 1, day - 1));
}

/** 'YYYY-MM' calendar months touched by [startIso, endIso] — one or two entries, since a cycle never spans more than that. */
function monthsInRange(startIso, endIso) {
  return [...new Set([startIso.slice(0, 7), endIso.slice(0, 7)])];
}

module.exports = { cycleStartContaining, cycleEndFor, monthsInRange };
