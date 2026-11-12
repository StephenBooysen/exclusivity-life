/**
 * @jest-environment jsdom
 *
 * App shell behaviour — the personal header, the More sheet, and the AI sheet.
 * The markup here mirrors layouts/main.ejs and partials/tabbar.ejs; routes.test.js
 * asserts the server actually emits that markup, so the two halves stay honest.
 */

'use strict';

const SHELL_HTML = `
  <header class="am-topbar"><div class="am-topbar-inner">
    <div>
      <div class="am-topbar-greeting" id="am-greeting">Hello</div>
      <div class="am-topbar-name" id="am-username">&nbsp;</div>
    </div>
    <div class="am-avatar" id="am-avatar"></div>
  </div></header>
  <main class="am-content"></main>
  <button class="am-fab" id="am-ai-toggle" aria-expanded="false"></button>
  <div class="am-scrim" id="am-scrim"></div>
  <div class="am-sheet" id="am-sheet">
    <button id="am-sheet-close"></button>
    <div id="am-sheet-messages"></div>
    <form id="am-sheet-form"><input id="am-sheet-input"></form>
  </div>
  <nav class="am-tabbar"><div class="am-tabbar-inner">
    <a class="am-tab active" href="/dashboard"><span class="am-tab-label">Home</span></a>
    <button class="am-tab" id="am-more" aria-expanded="false"><span class="am-tab-label">More</span></button>
  </div></nav>
  <div class="am-sheet" id="am-more-sheet">
    <button id="am-more-close"></button>
  </div>
`;

function loadShell() {
  document.body.innerHTML = SHELL_HTML;
  jest.isolateModules(() => {
    require('../../public/js/shell.js');
  });
}

const $ = (id) => document.getElementById(id);

beforeEach(() => {
  localStorage.clear();
  jest.resetModules();
});

describe('personal header', () => {
  test('greets by name with initials in the avatar', () => {
    localStorage.setItem('user-name', 'Stephen Booysen');
    loadShell();
    expect($('am-username').textContent).toBe('Stephen Booysen');
    expect($('am-avatar').textContent).toBe('SB');
  });

  test('uses only the first two initials for a longer name', () => {
    localStorage.setItem('user-name', 'Ada Marie Lovelace King');
    loadShell();
    expect($('am-avatar').textContent).toBe('AM');
  });

  test('handles a single-word name', () => {
    localStorage.setItem('user-name', 'Stephen');
    loadShell();
    expect($('am-avatar').textContent).toBe('S');
  });

  test('falls back to a default when no name is stored', () => {
    loadShell();
    expect($('am-username').textContent).toBeTruthy();
    expect($('am-avatar').textContent).toBeTruthy();
  });

  test('greets according to the time of day', () => {
    jest.useFakeTimers().setSystemTime(new Date(2025, 5, 5, 9, 0));
    loadShell();
    expect($('am-greeting').textContent).toBe('Good morning');

    jest.setSystemTime(new Date(2025, 5, 5, 14, 0));
    window.AM_renderHeader();
    expect($('am-greeting').textContent).toBe('Good afternoon');

    jest.setSystemTime(new Date(2025, 5, 5, 20, 0));
    window.AM_renderHeader();
    expect($('am-greeting').textContent).toBe('Good evening');
    jest.useRealTimers();
  });

  test('re-renders when the stored name changes', () => {
    loadShell();
    localStorage.setItem('user-name', 'Grace Hopper');
    window.AM_renderHeader();
    expect($('am-username').textContent).toBe('Grace Hopper');
    expect($('am-avatar').textContent).toBe('GH');
  });
});

describe('More sheet', () => {
  beforeEach(loadShell);

  test('opens on tap and raises the scrim', () => {
    $('am-more').click();
    expect($('am-more-sheet').classList.contains('open')).toBe(true);
    expect($('am-scrim').classList.contains('open')).toBe(true);
    expect($('am-more').getAttribute('aria-expanded')).toBe('true');
  });

  test('closes on a second tap', () => {
    $('am-more').click();
    $('am-more').click();
    expect($('am-more-sheet').classList.contains('open')).toBe(false);
    expect($('am-scrim').classList.contains('open')).toBe(false);
  });

  test('closes via its close button', () => {
    $('am-more').click();
    $('am-more-close').click();
    expect($('am-more-sheet').classList.contains('open')).toBe(false);
  });

  test('closes when the scrim is tapped', () => {
    $('am-more').click();
    $('am-scrim').click();
    expect($('am-more-sheet').classList.contains('open')).toBe(false);
  });

  test('closes on Escape', () => {
    $('am-more').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect($('am-more-sheet').classList.contains('open')).toBe(false);
  });
});

describe('AI sheet', () => {
  beforeEach(loadShell);

  test('opens from the floating button and hides it while open', () => {
    $('am-ai-toggle').click();
    expect($('am-sheet').classList.contains('open')).toBe(true);
    expect($('am-ai-toggle').style.display).toBe('none');
  });

  test('restores the floating button on close', () => {
    $('am-ai-toggle').click();
    $('am-sheet-close').click();
    expect($('am-sheet').classList.contains('open')).toBe(false);
    expect($('am-ai-toggle').style.display).not.toBe('none');
  });

  test('opening one sheet closes the other', () => {
    $('am-more').click();
    $('am-ai-toggle').click();
    expect($('am-more-sheet').classList.contains('open')).toBe(false);
    expect($('am-sheet').classList.contains('open')).toBe(true);

    $('am-more').click();
    expect($('am-sheet').classList.contains('open')).toBe(false);
    expect($('am-more-sheet').classList.contains('open')).toBe(true);
  });
});

describe('AI chat', () => {
  beforeEach(loadShell);

  function submit(text) {
    $('am-sheet-input').value = text;
    $('am-sheet-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  test('asks for an API key when none is configured', async () => {
    submit('How am I doing?');
    await Promise.resolve();

    const bubbles = document.querySelectorAll('#am-sheet-messages .am-bubble');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].classList.contains('me')).toBe(true);
    expect(bubbles[1].textContent).toMatch(/API key in Settings/i);
  });

  test('renders the assistant reply when the proxy answers', async () => {
    localStorage.setItem('claude-api-key', 'test-key');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: 'Two easy runs, then reassess.' }] })
    });

    submit('Plan my week');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const bubbles = document.querySelectorAll('#am-sheet-messages .am-bubble');
    expect(bubbles[bubbles.length - 1].textContent).toBe('Two easy runs, then reassess.');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.apiKey).toBe('test-key');
    expect(body.messages[0]).toEqual({ role: 'user', content: 'Plan my week' });
  });

  test('surfaces a failure instead of leaving "Thinking…" on screen', async () => {
    localStorage.setItem('claude-api-key', 'test-key');
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    submit('Anything?');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const bubbles = document.querySelectorAll('#am-sheet-messages .am-bubble');
    expect(bubbles[bubbles.length - 1].textContent).toMatch(/Could not reach/i);
  });

  test('ignores an empty message', () => {
    submit('   ');
    expect(document.querySelectorAll('#am-sheet-messages .am-bubble')).toHaveLength(0);
  });

  test('escapes markup in a reply rather than rendering it', async () => {
    localStorage.setItem('claude-api-key', 'test-key');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: '<img src=x onerror=alert(1)>' }] })
    });

    submit('hi');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('#am-sheet-messages img')).toBeNull();
  });
});
