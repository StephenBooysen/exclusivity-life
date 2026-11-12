/**
 * @jest-environment jsdom
 *
 * Client helpers — date maths, streaks, escaping. These back the habit grid
 * and streak counters, where an off-by-one day is a visible, wrong number.
 */

'use strict';

require('../../public/js/am-util.js');

const AM = window.AM;

/** Local-time YYYY-MM-DD, independent of the implementation under test. */
function localIso(daysBack = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('esc', () => {
  test('escapes the characters that break out of markup', () => {
    expect(AM.esc('<script>alert("x")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(AM.esc("O'Brien & Sons")).toBe('O&#39;Brien &amp; Sons');
  });

  test('renders null and undefined as an empty string', () => {
    expect(AM.esc(null)).toBe('');
    expect(AM.esc(undefined)).toBe('');
  });

  test('a goal title with markup cannot inject an element', () => {
    const html = '<div>' + AM.esc('<img src=x onerror=alert(1)>') + '</div>';
    document.body.innerHTML = html;
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('isoDate', () => {
  test('formats today in local time', () => {
    expect(AM.isoDate()).toBe(localIso(0));
  });

  test('zero-pads month and day', () => {
    expect(AM.isoDate(new Date(2025, 0, 5))).toBe('2025-01-05');
  });

  test('uses the local calendar day, not UTC', () => {
    // 23:30 local on the 5th is the 5th, even where UTC has already ticked over.
    expect(AM.isoDate(new Date(2025, 5, 5, 23, 30))).toBe('2025-06-05');
  });
});

describe('currentWeekDates', () => {
  test('returns seven days', () => {
    expect(AM.currentWeekDates()).toHaveLength(7);
  });

  test('starts on Monday and ends on Sunday', () => {
    const week = AM.currentWeekDates();
    expect(week[0].getDay()).toBe(1);
    expect(week[6].getDay()).toBe(0);
  });

  test('contains today', () => {
    const week = AM.currentWeekDates().map(AM.isoDate);
    expect(week).toContain(AM.isoDate());
  });
});

describe('streakFor', () => {
  test('is zero with no completions', () => {
    expect(AM.streakFor(new Set())).toBe(0);
  });

  test('counts consecutive days ending today', () => {
    const done = new Set([localIso(0), localIso(1), localIso(2)]);
    expect(AM.streakFor(done)).toBe(3);
  });

  test('stops at the first gap', () => {
    const done = new Set([localIso(0), localIso(1), localIso(3), localIso(4)]);
    expect(AM.streakFor(done)).toBe(2);
  });

  test('keeps the streak alive when today is not yet done', () => {
    // A habit not yet ticked today should still show yesterday's run, not zero.
    const done = new Set([localIso(1), localIso(2), localIso(3)]);
    expect(AM.streakFor(done)).toBe(3);
  });

  test('is zero when neither today nor yesterday is done', () => {
    const done = new Set([localIso(2), localIso(3)]);
    expect(AM.streakFor(done)).toBe(0);
  });

  test('counts a single day done today', () => {
    expect(AM.streakFor(new Set([localIso(0)]))).toBe(1);
  });
});

describe('priorityTag', () => {
  test('maps each priority to its tag class', () => {
    expect(AM.priorityTag('high')).toBe('tag-accent-2');
    expect(AM.priorityTag('medium')).toBe('tag-accent');
    expect(AM.priorityTag('low')).toBe('tag-neutral');
  });

  test('falls back to neutral for an unknown or missing priority', () => {
    expect(AM.priorityTag('urgent')).toBe('tag-neutral');
    expect(AM.priorityTag(undefined)).toBe('tag-neutral');
  });
});

describe('icons', () => {
  test('the flame is a stroked icon, not the unreadable filled squiggle', () => {
    expect(AM.FLAME_SVG).toContain('stroke="currentColor"');
    expect(AM.FLAME_SVG).toContain('aria-hidden="true"');
  });

  test('the checkmark draws in the page background colour', () => {
    expect(AM.CHECK_SVG).toContain('var(--color-bg)');
  });
});
