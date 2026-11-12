'use strict';

/**
 * Tests for the interest taxonomy and the deck clause built on it.
 *
 * Two things are being protected here. The first is the zero-selection state:
 * an empty set means "no constraint", and if that ever inverted, every member
 * who has not answered the question would silently vanish from every deck. The
 * second is that overlap is mutual — a viewer's filter cannot reach a candidate
 * whose own declaration excludes them, which is what makes B0's promise ("only
 * members whose interests overlap yours will see you") true rather than
 * decorative.
 *
 * The compliance boundary is also asserted: these keys change who a member
 * sees, never who may message them, and nothing in the taxonomy carries a rate,
 * a fee or an offer. See the note under B0 in .docs/Design/README.md.
 */

const test = require('node:test');
const assert = require('node:assert');

const interests = require('../backend/services/interests');
const scoring = require('../backend/services/scoring');

const NOW = new Date('2026-08-21T12:00:00Z');

function bundle({ id, side = 'female', dob = '1994-01-01', declared = [], filter = [] } = {}) {
  return {
    member: { id, side, status: 'active', badges: [], lastActiveAt: NOW.toISOString(), incognito: false },
    profile: {
      dateOfBirth: dob,
      moderationState: 'live',
      coords: { lat: -26.2, lon: 28.04 },
      completeness: 80,
      interestCategories: declared
    },
    preferences: {
      ageMin: 18, ageMax: 99, distanceKm: 100, interestedIn: null,
      interestCategories: filter,
      privacy: { incognito: false }
    }
  };
}

const context = () => ({
  now: NOW,
  actedUpon: new Set(),
  blocked: new Set(),
  likedViewer: new Set(),
  reciprocity: new Map(),
  recentlyShown: new Map(),
  populationLikeBackRate: 0.25
});

const him = (opts = {}) => bundle({ id: 'him', side: 'male', dob: '1984-01-01', ...opts });
const her = (opts = {}) => bundle({ id: 'her', side: 'female', ...opts });

/* ---------- the taxonomy itself ---------- */

test('taxonomy: the keys are exactly the documented set, in group order', () => {
  assert.deepEqual(interests.KEYS, [
    'nanny', 'au_pair',
    'discrete_pa',
    'atmosphere_model', 'model',
    'just_dating', 'friends_with_benefits', 'girlfriend', 'fiance'
  ]);
});

test('taxonomy: display labels are written exactly as the design specifies', () => {
  assert.equal(interests.labelFor('discrete_pa'), 'Discrete PA');
  assert.equal(interests.labelFor('friends_with_benefits'), 'Friends with benefits');
  assert.equal(interests.labelFor('fiance'), 'Fiancé');
  assert.equal(interests.labelFor('au_pair'), 'Au pair');
});

test('taxonomy: no category carries a rate, fee or offer field', () => {
  // The design's compliance note forbids adding one. A category is a key and a
  // label and nothing else, so the shape is asserted rather than trusted.
  for (const group of interests.GROUPS) {
    assert.deepEqual(Object.keys(group).sort(), ['key', 'label', 'options']);
    for (const option of group.options) {
      assert.deepEqual(Object.keys(option).sort(), ['key', 'label']);
    }
  }
});

test('normalise: drops unknown keys, de-duplicates, and keeps order', () => {
  assert.deepEqual(
    interests.normalise(['girlfriend', 'not_a_category', 'girlfriend', 'nanny']),
    ['girlfriend', 'nanny']
  );
  assert.deepEqual(interests.normalise(null), []);
  assert.deepEqual(interests.normalise('girlfriend'), [], 'a bare string is not a set');
  assert.deepEqual(interests.normalise([{ key: 'girlfriend' }]), [], 'objects are not keys');
});

/* ---------- overlap ---------- */

test('overlaps: an empty set on either side is no constraint at all', () => {
  assert.equal(interests.overlaps([], ['nanny']), true, 'no filter admits everyone');
  assert.equal(interests.overlaps(['girlfriend'], []), true, 'an undeclared candidate is not excluded');
  assert.equal(interests.overlaps([], []), true);
});

test('overlaps: two non-empty sets need a shared key', () => {
  assert.equal(interests.overlaps(['girlfriend'], ['girlfriend', 'nanny']), true);
  assert.equal(interests.overlaps(['girlfriend'], ['nanny']), false);
});

test('overlaps: an unknown key cannot create a match', () => {
  assert.equal(interests.overlaps(['made_up'], ['made_up']), true,
    'both sets normalise to empty, which is the no-constraint case');
  assert.equal(interests.overlaps(['made_up', 'girlfriend'], ['made_up']), true,
    'the candidate side normalises to empty, so it is unconstrained');
  assert.equal(interests.overlaps(['made_up', 'girlfriend'], ['made_up', 'nanny']), false,
    'once both sides carry a real key, the unknown one is ignored');
});

/* ---------- the deck clause ---------- */

test('deck: members who have never answered still see each other', () => {
  // The regression that would empty every existing deck the day this shipped.
  assert.equal(scoring.eligible(him(), her(), context()), true);
});

test('deck: a filter admits a candidate who declared one of its categories', () => {
  const viewer = him({ filter: ['just_dating', 'girlfriend'] });
  const candidate = her({ declared: ['girlfriend'] });
  assert.equal(scoring.eligible(viewer, candidate, context()), true);
});

test('deck: a filter excludes a candidate who declared none of its categories', () => {
  const viewer = him({ filter: ['girlfriend'] });
  const candidate = her({ declared: ['just_dating'] });
  assert.equal(scoring.eligible(viewer, candidate, context()), false);
});

test('deck: overlap is mutual — her declaration gates who reaches her', () => {
  // He has no filter, so his side admits everyone. Hers must still be honoured:
  // she declared dating only, and his declaration is household only.
  const viewer = him({ declared: ['nanny'], filter: [] });
  const candidate = her({ declared: ['girlfriend'], filter: ['girlfriend'] });
  assert.equal(scoring.eligible(viewer, candidate, context()), false);
});

test('deck: selecting one category narrows hard, selecting more widens', () => {
  const candidate = her({ declared: ['model'] });
  assert.equal(scoring.eligible(him({ filter: ['girlfriend'] }), candidate, context()), false);
  assert.equal(
    scoring.eligible(him({ filter: ['girlfriend', 'model'] }), candidate, context()), true
  );
});

test('deck: the interest clause cannot rescue a candidate excluded on other grounds', () => {
  const viewer = him({ filter: ['girlfriend'] });
  const candidate = her({ declared: ['girlfriend'] });
  const blocked = { ...context(), blocked: new Set(['her']) };
  assert.equal(scoring.eligible(viewer, candidate, blocked), false);
});
