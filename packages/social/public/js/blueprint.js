/**
 * Registration marks.
 *
 * Every framed object in this system carries four `+` marks drawn just outside
 * its corners — they are what makes it read as a drawing of the thing rather
 * than a filled card, and the design is explicit that they are never dropped.
 *
 * Rather than repeat four <i> elements in every template, `decorate` walks a
 * subtree after render and adds them to any .blueprint that is missing them.
 * That way forgetting them in a template is not possible.
 */

const CORNERS = ['tl', 'tr', 'bl', 'br'];

export function decorate(root) {
  if (!root) return;
  const frames = root.querySelectorAll('.blueprint');
  for (const frame of frames) {
    if (frame.querySelector(':scope > .corner')) continue;
    const marks = document.createDocumentFragment();
    for (const position of CORNERS) {
      const mark = document.createElement('i');
      mark.className = `corner ${position}`;
      mark.setAttribute('aria-hidden', 'true');
      marks.appendChild(mark);
    }
    frame.prepend(marks);
  }
}

/**
 * A photograph, framed. Real imagery is wrapped in .duotone; when there is none
 * the hatched placeholder stands in, so the layout never collapses.
 *
 * @param {?string} photoId
 * @param {{size?: string, label?: string, className?: string, style?: string, alt?: string}} options
 */
export function photo(photoId, { size = 'card', label = '', className = '', style = '', alt = '' } = {}) {
  const cls = `${photoId ? 'duotone' : 'ph'}${className ? ` ${className}` : ''}`;
  if (!photoId) {
    return `<div class="${cls}" data-ph="${escapeAttr(label)}" style="${escapeAttr(style)}"></div>`;
  }
  return `<div class="${cls}" style="${escapeAttr(style)}">
    <img src="/api/photos/${encodeURIComponent(photoId)}/${size}" alt="${escapeAttr(alt)}" loading="lazy" />
  </div>`;
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
