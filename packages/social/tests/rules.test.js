'use strict';

/**
 * Tests for the rules that are stated as promises to members: the age gate,
 * what a tier includes, the launch-city gate, and what the solicitation
 * scanner catches. Each maps to an acceptance criterion in .docs.
 */

const test = require('node:test');
const assert = require('node:assert');

const utils = require('../backend/services/utils');
const scanner = require('../backend/services/contentScanner');
const { TIERS, DORMANT, UNLIMITED } = require('../backend/services/entitlementService');
const config = require('../backend/config');

/* ---------- age ---------- */

test('age: derived from date of birth, and the birthday boundary is exact', () => {
  const now = new Date('2026-08-21T00:00:00Z');
  assert.equal(utils.ageFrom('2000-08-21', now), 26, 'on the birthday');
  assert.equal(utils.ageFrom('2000-08-22', now), 25, 'the day before');
});

test('age: the 18 gate refuses anyone younger, whatever the client sends', () => {
  const now = new Date('2026-08-21T00:00:00Z');
  assert.equal(utils.isAdult('2008-08-21', now), true, 'exactly 18 is allowed');
  assert.equal(utils.isAdult('2008-08-22', now), false, 'a day short is refused');
  assert.equal(utils.isAdult('2015-01-01', now), false);
  assert.equal(utils.isAdult(null, now), false);
  assert.equal(utils.isAdult('not-a-date', now), false);
});

/* ---------- distance ---------- */

test('distance: exposed as a band, never a number', () => {
  assert.equal(utils.distanceBand(2), '< 5 km');
  assert.equal(utils.distanceBand(9), '5–15 km');
  assert.equal(utils.distanceBand(30), '15–50 km');
  assert.equal(utils.distanceBand(400), '50 km+');
  assert.equal(utils.distanceBand(null), null);
});

test('distance: two Johannesburg points read as near, Cape Town as far', () => {
  const sandton = { lat: -26.107, lon: 28.056 };
  const rosebank = { lat: -26.146, lon: 28.041 };
  const capeTown = { lat: -33.925, lon: 18.424 };

  assert.ok(utils.distanceKm(sandton, rosebank) < 10);
  assert.ok(utils.distanceKm(sandton, capeTown) > 1000);
});

/* ---------- launch city ---------- */

test('launch city: Johannesburg and its suburbs are inside the gate', () => {
  for (const city of ['Johannesburg', 'johannesburg', 'Sandton', 'ROSEBANK', 'Bryanston']) {
    assert.equal(utils.isInLaunchCity(city), true, `${city} should be inside`);
  }
});

test('launch city: everywhere else is outside, and so is nothing at all', () => {
  for (const city of ['Cape Town', 'Durban', 'London', '', null]) {
    assert.equal(utils.isInLaunchCity(city), false, `${String(city)} should be outside`);
  }
});

/* ---------- entitlements ---------- */

test('tiers: Select is free and never below a paid tier on what matters', () => {
  assert.equal(TIERS.select.price, 0);
  assert.equal(TIERS.select.whoLikedYou, true);
  assert.equal(TIERS.select.filters, true);
  assert.equal(TIERS.select.incognito, true);
  assert.equal(TIERS.select.likesPerDay, UNLIMITED);
});

test('tiers: paid tiers buy volume and discretion, in that order', () => {
  assert.ok(TIERS.elite.deck > TIERS.signature.deck);
  assert.ok(TIERS.noir.deck > TIERS.elite.deck);
  assert.ok(TIERS.elite.price > TIERS.signature.price);
  assert.equal(TIERS.signature.whoLikedYou, false);
  assert.equal(TIERS.elite.whoLikedYou, true);
  assert.equal(TIERS.noir.inviteOnly, true);
});

test('tiers: no tier can buy a verification mark or an inbox', () => {
  for (const [name, tier] of Object.entries(TIERS)) {
    assert.equal(tier.badges, undefined, `${name} must not grant badges`);
    assert.equal(tier.messageUnmatched, undefined, `${name} must not open an unmatched inbox`);
  }
});

test('tiers: a dormant member keeps nothing but their conversations', () => {
  assert.equal(DORMANT.deck, 0);
  assert.equal(DORMANT.likesPerDay, 0);
  assert.equal(DORMANT.whoLikedYou, false);
});

/* ---------- content scanning ---------- */

test('scanner: catches transactional solicitation, the line the product cannot cross', () => {
  const phrases = [
    'I can offer you a monthly allowance',
    'looking for a sugar daddy',
    'ppm negotiable',
    'happy to spoil you generously',
    'a mutually beneficial arrangement',
    'what are your rates per night'
  ];
  for (const phrase of phrases) {
    const result = scanner.scanFirstMessage(phrase);
    assert.ok(result.flags.includes('solicitation'), `missed: "${phrase}"`);
    assert.equal(result.severity, 'high');
  }
});

test('scanner: catches money-movement scams', () => {
  const result = scanner.scanFirstMessage('can you send me some money via bitcoin');
  assert.equal(result.severity, 'high');
  assert.ok(result.flags.includes('financial') || result.flags.includes('solicitation'));
});

test('scanner: flags off-platform contact in a first message, at low severity', () => {
  const result = scanner.scanFirstMessage('add me on whatsapp 082 123 4567');
  assert.ok(result.flags.includes('external_contact'));
});

test('scanner: leaves ordinary conversation alone', () => {
  const innocuous = [
    'Your Sunday answer made me laugh. The Magaliesberg, really?',
    'I am a lawyer and I cook badly. Dinner on Thursday?',
    'That restaurant in Parkhurst was excellent, we should go'
  ];
  for (const phrase of innocuous) {
    const result = scanner.scanFirstMessage(phrase);
    assert.equal(result.severity, null, `false positive on: "${phrase}"`);
  }
});

test('scanner: a later message is judged only on what stays wrong at any point', () => {
  // Asking for a number in message twenty is a date, not a pattern.
  const later = scanner.scanMessage('my number is 082 123 4567, call me');
  assert.equal(later.flags.includes('external_contact'), false);

  const stillWrong = scanner.scanMessage('I will pay you per date');
  assert.equal(stillWrong.severity, 'high');
});

test('scanner: disposable email domains are recognised', () => {
  assert.equal(scanner.isDisposableEmail('someone@mailinator.com'), true);
  assert.equal(scanner.isDisposableEmail('someone@gmail.com'), false);
  assert.equal(scanner.isDisposableEmail(''), false);
});

/* ---------- config coherence ---------- */

test('config: scoring carries no term derived from appearance', () => {
  const weights = Object.keys(config.matching.weights);
  for (const banned of ['attractiveness', 'beauty', 'looks', 'face', 'rating']) {
    assert.ok(!weights.includes(banned), `scoring must not weight ${banned}`);
  }
});

test('config: the appearance cap is a real fraction of the pool', () => {
  assert.ok(config.matching.appearanceCapRatio > 0 && config.matching.appearanceCapRatio < 1);
});

test('utils: the day key is stable and sorts lexicographically', () => {
  const day = utils.todayIso('Africa/Johannesburg', new Date('2026-08-21T09:00:00Z'));
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
  const earlier = utils.todayIso('Africa/Johannesburg', new Date('2026-08-20T09:00:00Z'));
  assert.ok(earlier < day);
});
