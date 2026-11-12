/**
 * Formatting helpers. Imported by the Express server (for EJS rendering) AND
 * served to the browser as-is for the live islands — one copy, no build step.
 *
 * Port of the Vue app's src/lib/format.ts, behaviour-for-behaviour.
 */

export function ts(iso) {
  if (!iso) return NaN;
  return new Date(iso).getTime();
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${(ms / 1000).toFixed(2)}s`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return `${m}m ${String(rem).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

export function fmtClock(iso) {
  const t = ts(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleTimeString([], { hour12: false });
}

export function fmtDate(iso) {
  const t = ts(iso);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${fmtClock(iso)}`;
}

export function fmtTokens(n) {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function fmtCost(n) {
  if (n == null) return "—";
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

/** Compact offset label for time axes: 0s, 30s, 1m, 1m30s, 2m, 1h05m. */
export function fmtOffset(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rem = s % 60;
    return rem ? `${m}m${String(rem).padStart(2, "0")}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const mrem = m % 60;
  return mrem ? `${h}h${String(mrem).padStart(2, "0")}m` : `${h}h`;
}

const TICK_STEPS_MS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600,
].map((s) => s * 1000);

/** Evenly-stepped time-axis ticks over a span, ≤ maxTicks of them. */
export function axisTicks(spanMs, maxTicks = 8) {
  const span = Math.max(spanMs, 1);
  const step = TICK_STEPS_MS.find((s) => span / s <= maxTicks) ?? 3_600_000;
  const out = [];
  for (let t = 0; t <= span; t += step) {
    out.push({ pct: (t / span) * 100, label: fmtOffset(t) });
  }
  return out;
}

/**
 * New-tracer tool_call payloads carry ok:false on tool errors; older payloads
 * have no ok key and count as ok.
 */
export function payloadOk(raw) {
  if (!raw) return true;
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object" && "ok" in p) return p.ok !== false;
  } catch {
    /* not JSON — treat as ok */
  }
  return true;
}

export function prettyJson(raw) {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Locale-grouped integers, matching the Vue app's Intl.NumberFormat('en-US'). */
const NUM = new Intl.NumberFormat("en-US");

export function fmtNumber(n) {
  return NUM.format(n ?? 0);
}

/** Per-component costs run to fractions of a cent; four places keeps them real. */
export function money(n) {
  if (!n) return "$0";
  return n < 0.0001 ? "<$0.0001" : `$${n.toFixed(4)}`;
}
