/**
 * App shell — drawer navigation, AI Guide bottom sheet, and the sheet's chat.
 * Plain ES6, no framework. All state changes are CSS class toggles so the
 * transitions stay under the 200ms budget.
 */
(function () {
  'use strict';

  /* — personal header — greeting, name and avatar initials.
     The name is whatever the user set in Settings; it is theirs to change. */
  const DEFAULT_NAME = 'Stephen Booysen';

  function greetingFor(hour) {
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  function initialsFor(name) {
    return String(name || '')
      .split(/\s+/).filter(Boolean).slice(0, 2)
      .map((part) => part[0].toUpperCase()).join('');
  }

  function renderHeader() {
    const name = localStorage.getItem('user-name') || DEFAULT_NAME;
    const greetEl = document.getElementById('am-greeting');
    const nameEl = document.getElementById('am-username');
    const avatarEl = document.getElementById('am-avatar');
    if (greetEl) greetEl.textContent = greetingFor(new Date().getHours());
    if (nameEl) nameEl.textContent = name;
    if (avatarEl) avatarEl.textContent = initialsFor(name);
  }

  renderHeader();
  window.AM_renderHeader = renderHeader;

  const scrim = document.getElementById('am-scrim');
  const sheet = document.getElementById('am-sheet');
  const moreSheet = document.getElementById('am-more-sheet');
  const moreBtn = document.getElementById('am-more');
  const moreClose = document.getElementById('am-more-close');
  const aiBtn = document.getElementById('am-ai-toggle');
  const sheetClose = document.getElementById('am-sheet-close');

  function setSheet(open) {
    if (!sheet) return;
    if (open) setMore(false);
    sheet.classList.toggle('open', open);
    if (aiBtn) {
      aiBtn.setAttribute('aria-expanded', String(open));
      aiBtn.style.display = open ? 'none' : '';
    }
    syncScrim();
    if (open) {
      const input = document.getElementById('am-sheet-input');
      if (input) input.focus();
    }
  }

  function setMore(open) {
    if (!moreSheet) return;
    if (open) setSheet(false);
    moreSheet.classList.toggle('open', open);
    if (moreBtn) moreBtn.setAttribute('aria-expanded', String(open));
    syncScrim();
  }

  // One scrim serves both sheets; it is visible while either is open.
  function syncScrim() {
    if (!scrim) return;
    const anyOpen = (sheet && sheet.classList.contains('open')) ||
                    (moreSheet && moreSheet.classList.contains('open'));
    scrim.classList.toggle('open', anyOpen);
  }

  function closeAll() {
    setSheet(false);
    setMore(false);
  }

  if (aiBtn) aiBtn.addEventListener('click', () => setSheet(!sheet.classList.contains('open')));
  if (sheetClose) sheetClose.addEventListener('click', () => setSheet(false));
  if (moreBtn) moreBtn.addEventListener('click', () => setMore(!moreSheet.classList.contains('open')));
  if (moreClose) moreClose.addEventListener('click', () => setMore(false));
  if (scrim) scrim.addEventListener('click', closeAll);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });

  /* — AI Guide chat ————————————————————————————————————————————————
     Posts to the same /api/claude proxy the AI Guide page uses, with the key
     the user saved in Settings. History is kept in memory for this sheet only. */

  const form = document.getElementById('am-sheet-form');
  const input = document.getElementById('am-sheet-input');
  const messages = document.getElementById('am-sheet-messages');
  const history = [];

  function bubble(text, mine) {
    const el = document.createElement('div');
    el.className = 'am-bubble' + (mine ? ' me' : '');
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      bubble(text, true);
      input.value = '';
      history.push({ role: 'user', content: text });

      const apiKey = localStorage.getItem('claude-api-key');
      if (!apiKey) {
        bubble('Add your Claude API key in Settings to use the AI guide.', false);
        return;
      }

      const pending = bubble('Thinking…', false);
      try {
        const res = await fetch('/api/claude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: history,
            system: "You are a concise, warm guide inside 'Architect My Life', a personal " +
                    "goal, habit and reflection app. Help the user break down goals, spot " +
                    "patterns in their progress, and plan realistically. Keep replies short.",
            apiKey: apiKey
          })
        });
        const data = await res.json();
        const reply = data && data.content && data.content[0] && data.content[0].text;
        if (res.ok && reply) {
          pending.textContent = reply;
          history.push({ role: 'assistant', content: reply });
        } else {
          pending.textContent = (data && data.error) || 'That request did not go through. Check your API key in Settings.';
        }
      } catch (err) {
        pending.textContent = 'Could not reach the AI service.';
      }
    });
  }
})();
