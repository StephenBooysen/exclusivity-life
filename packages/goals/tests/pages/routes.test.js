/**
 * Page routes and the rendered app shell.
 * These render real EJS through the real layout, so a broken template or a
 * missing partial fails here rather than in the browser.
 */

'use strict';

const request = require('supertest');
const { createTestApp, cleanupTestApps } = require('../helpers/testApp');

let app;

beforeAll(async () => {
  ({ app } = await createTestApp());
});

afterAll(cleanupTestApps);

/** [path, currentPage key, a string unique to that screen's content] */
const PAGES = [
  ['/', 'dashboard', "Today's progress"],
  ['/dashboard', 'dashboard', "Today's focus"],
  ['/goals', 'goals', '<h1 class="screen-title">Goals</h1>'],
  ['/habits', 'habits', '<h1 class="screen-title">Habits</h1>'],
  ['/focus-areas', 'focus-areas', 'Focus Areas'],
  ['/how-you-feel', 'feelings', 'feelings-container'],
  ['/reflection', 'reflection', 'Daily Reflection'],
  ['/wisdom', 'wisdom', 'Wisdom Library'],
  ['/ai-guide', 'ai-guide', 'AI Guide'],
  ['/settings', 'settings', '<h1 class="screen-title">Settings</h1>']
];

describe('page routes', () => {
  test.each(PAGES)('GET %s renders the %s screen', async (path, key, marker) => {
    const res = await request(app).get(path).expect(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain(`currentPage: '${key}'`);
    expect(res.text).toContain(marker);
  });

  test('an unknown path redirects to the dashboard', async () => {
    const res = await request(app).get('/no-such-page').expect(302);
    expect(res.headers.location).toBe('/dashboard');
  });
});

describe('app shell', () => {
  let html;

  beforeAll(async () => {
    html = (await request(app).get('/dashboard')).text;
  });

  test('renders the personal header rather than a screen title and date', () => {
    expect(html).toContain('id="am-greeting"');
    expect(html).toContain('id="am-username"');
    expect(html).toContain('id="am-avatar"');
    expect(html).not.toContain('am-topbar-title');
    expect(html).not.toContain('am-topbar-date');
  });

  test('renders the bottom tab bar with five destinations', () => {
    expect(html).toContain('class="am-tabbar"');
    for (const label of ['Home', 'Goals', 'Habits', 'Reflection', 'More']) {
      expect(html).toContain(`<span class="am-tab-label">${label}</span>`);
    }
  });

  test('does not render a left drawer or hamburger', () => {
    expect(html).not.toContain('am-drawer');
    expect(html).not.toContain('id="am-menu"');
  });

  test('marks the current destination as active', () => {
    expect(html).toMatch(/class="am-tab active" href="\/dashboard"/);
    expect(html).toContain('aria-current="page"');
  });

  test('renders the More sheet with the overflow destinations', () => {
    expect(html).toContain('id="am-more-sheet"');
    for (const label of ['Focus Areas', 'How You Feel', 'Wisdom Library', 'AI Guide', 'Settings']) {
      expect(html).toContain(label);
    }
  });

  test('marks More active when an overflow screen is open', async () => {
    const settings = (await request(app).get('/settings')).text;
    expect(settings).toMatch(/class="am-tab active" id="am-more"/);
  });

  test('renders the AI launcher and sheet on every screen', () => {
    expect(html).toContain('id="am-ai-toggle"');
    expect(html).toContain('id="am-sheet"');
    expect(html).toContain('id="am-sheet-form"');
  });

  test('loads the theme stylesheets', () => {
    expect(html).toContain('/css/theme.css');
    expect(html).toContain('/css/legacy.css');
  });

  test('loads the shell and shared scripts', () => {
    expect(html).toContain('/js/shell.js');
    expect(html).toContain('/js/am-util.js');
  });

  test("loads only the current screen's script", async () => {
    expect(html).toContain('/js/screens/dashboard.js');
    expect(html).not.toContain('/js/screens/habits.js');

    const habits = (await request(app).get('/habits')).text;
    expect(habits).toContain('/js/screens/habits.js');
    expect(habits).not.toContain('/js/screens/dashboard.js');
  });
});

describe('dashboard panels', () => {
  let html;

  beforeAll(async () => {
    html = (await request(app).get('/dashboard')).text;
  });

  test('leads with the hero card', () => {
    expect(html).toContain('class="am-hero"');
    expect(html).toContain('id="hero-progress"');
    expect(html).toContain('id="hero-bar"');
  });

  test('every section sits in a panel under its own heading', () => {
    for (const title of ["Today's focus", "Today's habits", "This week's goals",
                         'Annual goals', 'Focus areas', 'Quick actions']) {
      expect(html).toContain(`<div class="am-sectionhead-title">${title}</div>`);
    }
    // Six headed sections: three list cards and three plain panels.
    expect((html.match(/class="am-listcard"/g) || []).length).toBe(3);
    expect((html.match(/class="card am-panel"/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('static assets', () => {
  test.each([
    '/css/theme.css',
    '/css/legacy.css',
    '/js/shell.js',
    '/js/am-util.js',
    '/js/screens/dashboard.js',
    '/js/screens/goals.js',
    '/js/screens/habits.js',
    '/site.webmanifest',
    '/sw.js'
  ])('%s is served', async (path) => {
    await request(app).get(path).expect(200);
  });

  test('template source is never served from the static root', async () => {
    // public/views sits inside the static directory, so this guard matters.
    await request(app).get('/views/pages/dashboard.ejs').expect(404);
    await request(app).get('/views/layouts/main.ejs').expect(404);
  });
});
