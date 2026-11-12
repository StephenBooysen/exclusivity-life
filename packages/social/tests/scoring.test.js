'use strict';

/**
 * Tests for the ranking and eligibility rules.
 *
 * These decide who sees whom, so every clause in `eligible` is a correctness
 * requirement rather than a preference — the blocked and acted-upon cases in
 * particular are the safety acceptance criteria from .docs §F4.2.
 */

const test = require('node:test');
const assert = require('node:assert');

const scoring = require('../backend/services/scoring');
const config = require('../backend/config');

const NOW = new Date('2026-08-21T12:00:00Z');

function bundle({
  id, side = 'female', dob = '1994-01-01', status = 'active',
  moderationState = 'live', ageMin = 18, ageMax = 99, distanceKm = 100,
  coords = { lat: -26.2, lon: 28.04 }, badges = [], completeness = 80,
  lastActiveAt = NOW.toISOString(), incognito = false, interestedIn = null
} = {}) {
  return {
    member: { id, side, status, badges, lastActiveAt, incognito },
    profile: { dateOfBirth: dob, moderationState, coords, completeness },
    preferences: { ageMin, ageMax, distanceKm, interestedIn, privacy: { incognito } }
  };
}

function context(overrides = {}) {
  return {
    now: NOW,
    actedUpon: new Set(),
    blocked: new Set(),
    likedViewer: new Set(),
    reciprocity: new Map(),
    recentlyShown: new Map(),
    populationLikeBackRate: 0.25,
    ...overrides
  };
}

const viewer = () => bundle({ id: 'him', side: 'male', dob: '1984-01-01' });
const candidate = () => bundle({ id: 'her', side: 'female' });

test('eligible: a compatible pair passes every clause', () => {
  assert.equal(scoring.eligible(viewer(), candidate(), context()), true);
});

test('eligible: a blocked member is never shown, whichever side blocked', () => {
  const ctx = context({ blocked: new Set(['her']) });
  assert.equal(scoring.eligible(viewer(), candidate(), ctx), false);
});

test('eligible: a member already acted upon never reappears', () => {
  const ctx = context({ actedUpon: new Set(['her']) });
  assert.equal(scoring.eligible(viewer(), candidate(), ctx), false);
});

test('eligible: a member who is not active is excluded', () => {
  const suspended = bundle({ id: 'her', status: 'suspended' });
  assert.equal(scoring.eligible(viewer(), suspended, context()), false);
});

test('eligible: a profile that has not cleared moderation is excluded', () => {
  const pending = bundle({ id: 'her', moderationState: 'pending' });
  assert.equal(scoring.eligible(viewer(), pending, context()), false);
});

test('eligible: age preference is mutual, not one-way', () => {
  // She is inside his range, but he is outside hers.
  const picky = bundle({ id: 'her', ageMin: 20, ageMax: 30 });
  assert.equal(scoring.eligible(viewer(), picky, context()), false);
});

test('eligible: gender preference is mutual', () => {
  const wantsWomen = bundle({ id: 'her', side: 'female', interestedIn: 'female' });
  assert.equal(scoring.eligible(viewer(), wantsWomen, context()), false);
});

test('eligible: nobody is shown their own profile', () => {
  const me = viewer();
  assert.equal(scoring.eligible(me, me, context()), false);
});

test('eligible: incognito hides a member unless they already liked the viewer', () => {
  const hidden = bundle({ id: 'her', incognito: true });
  assert.equal(scoring.eligible(viewer(), hidden, context()), false);

  const ctx = context({ likedViewer: new Set(['her']) });
  assert.equal(scoring.eligible(viewer(), hidden, ctx), true,
    'a like always reveals the liker');
});

test('eligible: distance honours the more generous of the two preferences', () => {
  const faraway = bundle({ id: 'her', coords: { lat: -33.9, lon: 18.4 }, distanceKm: 10 });
  assert.equal(scoring.eligible(viewer(), faraway, context()), false);
});

test('reciprocity: a thin sample is shrunk toward the population mean', () => {
  const ctx = context({
    reciprocity: new Map([
      ['new', { received: 2, likedBack: 2 }],
      ['established', { received: 100, likedBack: 40 }]
    ])
  });

  const brandNew = scoring.reciprocityLikelihood(bundle({ id: 'new' }), ctx);
  const established = scoring.reciprocityLikelihood(bundle({ id: 'established' }), ctx);

  assert.ok(brandNew < 1, 'two-for-two must not score as a certainty');
  assert.ok(established > brandNew,
    'a real track record should outrank a perfect but tiny sample');
});

test('reciprocity: an unknown candidate scores the population mean', () => {
  const value = scoring.reciprocityLikelihood(bundle({ id: 'unknown' }), context());
  assert.equal(value, 0.25);
});

test('verificationDepth: more marks rank higher, and means outweighs a photo check', () => {
  const none = scoring.verificationDepth(bundle({ id: 'a', badges: [] }));
  const photo = scoring.verificationDepth(bundle({ id: 'b', badges: ['photo'] }));
  const means = scoring.verificationDepth(bundle({ id: 'c', badges: ['means'] }));
  const all = scoring.verificationDepth(bundle({ id: 'd', badges: ['identity', 'photo', 'means', 'professional'] }));

  assert.equal(none, 0);
  assert.ok(means > photo);
  assert.ok(all > means);
  assert.ok(all <= 1);
});

test('activityRecency: decays by half over the configured half-life', () => {
  const half = config.matching.recencyHalfLifeDays;
  const stale = bundle({
    id: 'x',
    lastActiveAt: new Date(NOW.getTime() - half * 864e5).toISOString()
  });
  const value = scoring.activityRecency(stale, context());
  assert.ok(Math.abs(value - 0.5) < 0.01, `expected ~0.5, got ${value}`);
});

test('selectDeck: the appearance cap stops one profile filling every deck', () => {
  const scored = ['a', 'b', 'c'].map((id, i) => ({
    candidate: bundle({ id }), value: 1 - i * 0.1
  }));
  const appearances = new Map();

  // Cap of 1: the top-scoring candidate can occupy only one deck.
  const first = scoring.selectDeck(scored, 1, appearances, 1);
  const second = scoring.selectDeck(scored, 1, appearances, 1);

  assert.equal(first[0].candidate.member.id, 'a');
  assert.equal(second[0].candidate.member.id, 'b',
    'the second deck must not repeat the capped candidate');
});

test('selectDeck: a thin pool still fills a deck rather than under-delivering', () => {
  const scored = [{ candidate: bundle({ id: 'only' }), value: 1 }];
  const appearances = new Map([['only', 99]]);

  const deck = scoring.selectDeck(scored, 3, appearances, 1);
  assert.equal(deck.length, 1, 'the cap yields rather than returning an empty deck');
});

test('selectDeck: never returns more than the tier allows', () => {
  const scored = Array.from({ length: 40 }, (_, i) => ({
    candidate: bundle({ id: `m${i}` }), value: Math.random()
  }));
  const deck = scoring.selectDeck(scored, 5, new Map(), 100);
  assert.equal(deck.length, 5);
});

test('score: is bounded and rises with profile quality, not appearance', () => {
  const ctx = context();
  const weak = bundle({ id: 'weak', completeness: 10, badges: [] });
  const strong = bundle({ id: 'strong', completeness: 100, badges: ['identity', 'photo', 'means'] });

  const weakScore = scoring.score(viewer(), weak, ctx);
  const strongScore = scoring.score(viewer(), strong, ctx);

  assert.ok(strongScore > weakScore);
  assert.ok(weakScore >= 0 && strongScore <= 2);
});
