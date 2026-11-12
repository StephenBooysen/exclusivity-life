/**
 * Verification, drawn as evidence.
 *
 * A badge is never a decoration and never a purchase: it says what was checked,
 * by what kind of evidence, and on what date. Two forms —
 *
 *   badgeChips()  the compact row on a deck card: `IDENTITY`, `PHOTO`, `MEANS`
 *   badgeTable()  the divider-grid table on a profile, one row per claim, with
 *                 its evidence line and a ✓ (or a — where it does not apply)
 *
 * The "not a payment" line on Means is a required disclosure, not copy: no tier
 * grants a badge at any price.
 */

import { escapeHtml } from './format.js';

const BADGES = {
  identity: {
    chip: 'Identity',
    title: 'Identity verified',
    evidence: 'Liveness match',
    note: 'A live capture matched to the photographs, by a person.'
  },
  photo: {
    chip: 'Photo',
    title: 'Photo verified',
    evidence: 'Reviewer, human',
    note: 'Every photograph confirmed as this member.'
  },
  means: {
    chip: 'Means',
    title: 'Means verified',
    evidence: 'Interview passed',
    note: 'Established in a twenty-minute call. Never a document, never a payment.',
    // Means applies to the male side only, and only from a passed interview.
    sideOnly: 'male',
    disclosure: 'not a payment'
  },
  professional: {
    chip: 'Professional',
    title: 'Professional verified',
    evidence: 'Employer confirmed',
    note: 'Employer or practice confirmed.'
  }
};

export const BADGE_ORDER = ['identity', 'photo', 'means', 'professional'];

/**
 * The compact chip row. Only badges a member actually holds are drawn — a chip
 * asserts that a reviewer checked something, so it can never be derived from a
 * profile field like an employer name.
 *
 * `long` writes them as "Identity verified"; the short form is for a row of
 * three or four, where the repeated word is noise.
 */
export function badgeChips(badges = [], { long = false } = {}) {
  const held = BADGE_ORDER.filter((key) => badges.includes(key));
  if (!held.length) return '';
  const chips = held.map((key) => {
    const badge = BADGES[key];
    // Professional standing is a lesser claim than the three core checks, and
    // the design gives it the neutral chip rather than the accent one.
    const tone = key === 'professional' ? 'tag-neutral' : 'tag-accent';
    return `<span class="tag ${tone}">${escapeHtml(long ? badge.title : badge.chip)}</span>`;
  });
  return `<div class="tags">${chips.join('')}</div>`;
}

/**
 * The evidence table. Rows the member does not hold are still drawn, dimmed,
 * with a — rather than omitted: the absence of a mark is information too.
 *
 * @param {string[]} badges
 * @param {{side?: string, granted?: Object<string,string>}} options
 *   `granted` maps badge key -> ISO date, when the API supplies it.
 */
export function badgeTable(badges = [], { side = null, granted = {} } = {}) {
  const rows = BADGE_ORDER.map((key) => {
    const badge = BADGES[key];
    const held = badges.includes(key);
    const applies = !badge.sideOnly || !side || badge.sideOnly === side;

    if (!applies) {
      return row(badge.title, `Not applicable — ${side === 'female' ? 'Select side' : 'this side'}`, {
        state: 'off', glyph: '—'
      });
    }
    if (!held) {
      return row(badge.title, 'Not verified', { state: 'off', glyph: '—' });
    }

    const date = granted[key] ? ` · ${escapeHtml(shortDate(granted[key]))}` : '';
    const disclosure = badge.disclosure ? ` · ${escapeHtml(badge.disclosure)}` : '';
    return row(badge.title, `${badge.evidence}${date}${disclosure}`, {
      state: key === 'means' ? 'on' : '',
      glyph: '✓'
    });
  });

  return `<div class="grid-list">${rows.join('')}</div>`;
}

function row(title, note, { state = '', glyph = '✓' } = {}) {
  const modifier = state === 'on' ? ' grid-row--on' : state === 'off' ? ' grid-row--off' : '';
  return `<div class="grid-row${modifier}" style="padding:12px 14px">
    <div class="grid-row__body">
      <div class="grid-row__title">${escapeHtml(title)}</div>
      <div class="grid-row__note">${note}</div>
    </div>
    <span class="tick${glyph === '✓' ? '' : ' tick--off'}">${glyph}</span>
  </div>`;
}

/** What each mark certifies, in prose — used on a member's own account screen. */
export function badgeLegend(badges = []) {
  const held = BADGE_ORDER.filter((key) => badges.includes(key));
  if (!held.length) {
    return '<p class="muted">Nothing verified yet. Marks are granted by a reviewer, never bought.</p>';
  }
  return `<div class="grid-list">${held.map((key) => `
    <div class="grid-row">
      <div class="grid-row__body">
        <div class="grid-row__title">${escapeHtml(BADGES[key].title)}</div>
        <div class="grid-row__note">${escapeHtml(BADGES[key].note)}</div>
      </div>
      <span class="tick">✓</span>
    </div>`).join('')}</div>`;
}

function shortDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

export function badgeLabel(key) {
  return BADGES[key]?.title || key;
}

export { BADGES };
