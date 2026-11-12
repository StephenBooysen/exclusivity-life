/** Bottom sheets — the app's only modal form. */

import { escapeHtml } from '../format.js';
import { decorate } from '../blueprint.js';

let onKey = null;
let restoreFocus = null;

export function openSheet(html, { onMount, dismissable = true, label = null } = {}) {
  const root = document.getElementById('modal-root');
  restoreFocus = document.activeElement;

  root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"${
    label ? ` aria-label="${escapeHtml(label)}"` : ''
  }>
    <div class="sheet__grip" aria-hidden="true"></div>
    ${html}
  </div>`;
  root.hidden = false;

  const sheet = root.querySelector('.sheet');
  sheet.addEventListener('click', (e) => e.stopPropagation());
  decorate(sheet);

  if (dismissable) root.onclick = () => closeSheet();

  /**
   * A sheet is a dialog: Escape closes it and Tab stays inside it. Without the
   * trap, focus walks into the screen behind the scrim, which a screen reader
   * then reads out as if it were reachable.
   */
  onKey = (e) => {
    if (e.key === 'Escape' && dismissable) return closeSheet();
    if (e.key !== 'Tab') return undefined;
    const focusable = sheet.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return undefined;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
    return undefined;
  };
  document.addEventListener('keydown', onKey);

  sheet.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeSheet());
  });

  onMount?.(sheet);
  // preventScroll matters: focusing the first control in a long sheet otherwise
  // scrolls it into view, and the sheet opens half way down its own content.
  sheet.querySelector('input, textarea, select, button')?.focus({ preventScroll: true });
  sheet.scrollTop = 0;
}

export function closeSheet() {
  const root = document.getElementById('modal-root');
  root.hidden = true;
  root.innerHTML = '';
  root.onclick = null;
  if (onKey) document.removeEventListener('keydown', onKey);
  onKey = null;
  restoreFocus?.focus?.();
  restoreFocus = null;
}

/** Yes/no where the destructive option is named for what it does. */
export function confirmSheet({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    openSheet(`
      <h2>${escapeHtml(title)}</h2>
      <p class="muted" style="margin-top:8px">${escapeHtml(body)}</p>
      <div class="stack" style="gap:10px;margin-top:22px">
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'} btn--full" data-yes>${escapeHtml(confirmLabel)}</button>
        <button class="btn btn--quiet btn--full" data-close>Keep things as they are</button>
      </div>
    `, {
      label: title,
      onMount(sheet) {
        sheet.querySelector('[data-yes]').addEventListener('click', () => {
          closeSheet();
          resolve(true);
        });
      }
    });
    const root = document.getElementById('modal-root');
    const previous = root.onclick;
    root.onclick = () => { previous?.(); resolve(false); };
  });
}
