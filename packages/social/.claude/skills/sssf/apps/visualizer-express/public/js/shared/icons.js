/**
 * Inline SVG icons — the replacement for `lucide-vue-next`.
 *
 * The Vue app imported icon components from lucide-vue-next. Without a
 * bundler there is nothing to tree-shake a component library into, so the
 * dozen-odd icons the UI actually uses are inlined here as their raw path
 * data and emitted as SVG markup by `icon()`. No package, no fetch, no
 * flash of missing glyph.
 *
 * Icon geometry from Lucide (https://lucide.dev), ISC licensed. Lucide's
 * canvas conventions are preserved so the shapes render as designed:
 * 24×24 viewBox, no fill, 2px round-capped strokes in currentColor.
 */

const BODIES = {
  check: '<path d="M20 6 9 17l-5-5"/>',

  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',

  circle: '<circle cx="12" cy="12" r="10"/>',

  "loader-circle": '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',

  "circle-dollar-sign":
    '<circle cx="12" cy="12" r="10"/>' +
    '<path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/>' +
    '<path d="M12 18V6"/>',

  coins:
    '<circle cx="8" cy="8" r="6"/>' +
    '<path d="M18.09 10.37A6 6 0 1 1 10.34 18"/>' +
    '<path d="M7 6h1v4"/>' +
    '<path d="m16.71 13.88.7.71-2.82 2.82"/>',

  timer:
    '<line x1="10" x2="14" y1="2" y2="2"/>' +
    '<line x1="12" x2="15" y1="14" y2="11"/>' +
    '<circle cx="12" cy="14" r="8"/>',

  "book-open":
    '<path d="M12 7v14"/>' +
    '<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',

  "pen-line":
    '<path d="M12 20h9"/>' +
    '<path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',

  bot:
    '<path d="M12 8V4H8"/>' +
    '<rect width="16" height="12" x="4" y="8" rx="2"/>' +
    '<path d="M2 14h2"/><path d="M20 14h2"/>' +
    '<path d="M15 13v2"/><path d="M9 13v2"/>',

  "square-terminal":
    '<path d="m7 11 2-2-2-2"/>' +
    '<path d="M11 13h4"/>' +
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',

  "user-round":
    '<circle cx="12" cy="8" r="5"/>' + '<path d="M20 21a8 8 0 0 0-16 0"/>',

  activity:
    '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',

  "align-left":
    '<path d="M15 12H3"/><path d="M17 18H3"/><path d="M21 6H3"/>',

  brain:
    '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>' +
    '<path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>' +
    '<path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>' +
    '<path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/>' +
    '<path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/>' +
    '<path d="M3.477 10.896a4 4 0 0 1 .585-.396"/>' +
    '<path d="M19.938 10.5a4 4 0 0 1 .585.396"/>' +
    '<path d="M6 18a4 4 0 0 1-1.967-.516"/>' +
    '<path d="M19.967 17.484A4 4 0 0 1 18 18"/>',

  fingerprint:
    '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>' +
    '<path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>' +
    '<path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>' +
    '<path d="M2 12a10 10 0 0 1 18-6"/>' +
    '<path d="M2 16h.01"/>' +
    '<path d="M21.8 16c.2-2 .131-5.354 0-6"/>' +
    '<path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>' +
    '<path d="M8.65 22c.21-.66.45-1.32.57-2"/>' +
    '<path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>',

  inbox:
    '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>' +
    '<path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',

  "messages-square":
    '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/>' +
    '<path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',

  package:
    '<path d="m7.5 4.27 9 5.15"/>' +
    '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>' +
    '<path d="m3.3 7 8.7 5 8.7-5"/>' +
    '<path d="M12 22V12"/>',

  receipt:
    '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/>' +
    '<path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/>' +
    '<path d="M12 17.5v-11"/>',

  "shield-check":
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>' +
    '<path d="m9 12 2 2 4-4"/>',

  "sliders-horizontal":
    '<line x1="21" x2="14" y1="4" y2="4"/>' +
    '<line x1="10" x2="3" y1="4" y2="4"/>' +
    '<line x1="21" x2="12" y1="12" y2="12"/>' +
    '<line x1="8" x2="3" y1="12" y2="12"/>' +
    '<line x1="21" x2="16" y1="20" y2="20"/>' +
    '<line x1="12" x2="3" y1="20" y2="20"/>',
};

/**
 * Render one icon as SVG markup.
 *
 * Returns "" for an unknown name rather than throwing — a missing glyph must
 * never take a page down.
 */
export function icon(name, { size = 18, strokeWidth = 2, className = "" } = {}) {
  const body = BODIES[name];
  if (!body) return "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" ` +
    `class="icon ${className}" aria-hidden="true">${body}</svg>`
  );
}

/** Status → the icon the chip shows, mirroring StatusChip.vue's map. */
export const STATUS_ICONS = {
  success: "check",
  fail: "x",
  running: "loader-circle",
  queued: "circle",
};

/** Stat kind → icon, mirroring StatChip.vue's map. */
export const STAT_ICONS = {
  cost: "circle-dollar-sign",
  tokens: "coins",
  runtime: "timer",
  read: "book-open",
  written: "pen-line",
};

/** Phase kind → lane icon, mirroring SessionTrace.vue's KIND_ICONS. */
export const KIND_ICONS = {
  engineer: "user-round",
  code: "square-terminal",
  agent: "bot",
};
