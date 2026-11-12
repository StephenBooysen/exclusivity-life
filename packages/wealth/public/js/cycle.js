/**
 * Pay-cycle date helpers, shared by any view that needs to know "what period
 * are we in right now" — a cycle runs from payday of one calendar month to
 * the day before payday of the next (e.g. 27 Jul – 26 Aug), so a salary
 * landing on the 27th reads as the start of a new period rather than a
 * stray late-month deposit. Dates are kept as plain 'YYYY-MM-DD' strings
 * throughout — they sort and compare lexicographically, so no
 * timezone-sensitive Date arithmetic is needed for filtering/sorting, only
 * for stepping between months.
 */

export function pad2(n) { return String(n).padStart(2, '0'); }
export function clampDay(day) { return Math.min(Math.max(day || 1, 1), 28); }
export function fromDate(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`; }
export function parseISODate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }

/**
 * Debug time-travel: a `?date=YYYYMMDD` query param overrides "today" everywhere the
 * frontend asks for it, so you can preview how cycles/projections/payoff dates look on
 * an arbitrary date without touching the system clock. Drop the param to go back to now.
 */
function dateOverride() {
  const raw = new URLSearchParams(location.search).get('date');
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  const date = new Date(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8)));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getTodayDate() { return dateOverride() || new Date(); }
export function getTodayIso() { return fromDate(getTodayDate()); }

/** The pay-cycle start (an ISO date) that contains `iso` — the most recent payday on/before it. */
export function cycleStartContaining(iso, paydayDay) {
  const day = clampDay(paydayDay);
  const d = parseISODate(iso);
  const start = new Date(d.getFullYear(), d.getMonth(), day);
  if (d.getDate() < day) start.setMonth(start.getMonth() - 1);
  return fromDate(start);
}

export function cycleEndFor(cycleStartIso, paydayDay) {
  const day = clampDay(paydayDay);
  const start = parseISODate(cycleStartIso);
  return fromDate(new Date(start.getFullYear(), start.getMonth() + 1, day - 1));
}

export function shiftCycle(cycleStartIso, delta) {
  const start = parseISODate(cycleStartIso);
  return fromDate(new Date(start.getFullYear(), start.getMonth() + delta, start.getDate()));
}

/** 'YYYY-MM' calendar months touched by [startIso, endIso] — one or two entries, since a cycle never spans more than that. */
export function monthsInRange(startIso, endIso) {
  return [...new Set([startIso.slice(0, 7), endIso.slice(0, 7)])];
}

/** Whole calendar months between two 'YYYY-MM' strings (positive when `to` is later). Cycle starts are always the same day-of-month apart, so this doubles as "cycles between". */
export function monthsBetween(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * What fraction of the cycle is still ahead of `todayIso` — 1 for a cycle that hasn't
 * started yet, shrinking toward 0 as the cycle runs its course. A "projected" figure for
 * the whole cycle only makes sense in full before day one; once days have elapsed, it
 * should read as "what's projected for what's left", not the full-month number.
 */
export function remainingCycleFraction(cycleStart, cycleEnd, todayIso) {
  const totalDays = Math.round((parseISODate(cycleEnd) - parseISODate(cycleStart)) / 86400000) + 1;
  const elapsedDays = Math.round((parseISODate(todayIso) - parseISODate(cycleStart)) / 86400000);
  const remainingDays = totalDays - Math.max(0, Math.min(totalDays, elapsedDays));
  return Math.max(0, Math.min(1, remainingDays / totalDays));
}
