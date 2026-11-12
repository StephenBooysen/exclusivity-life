'use strict';

/**
 * @fileoverview The interest taxonomy — the single source of truth for both
 * sides of the market.
 *
 * A member's *declared* set (the application's "what are you open to") lives on
 * the profile. A viewer's *selected* set (the Elite discovery filter, "what are
 * you looking for") lives on their preferences. Deck eligibility needs the two
 * to overlap, in both directions — see `overlaps` and its use in `scoring`.
 *
 * Labels are display strings and are written exactly as the design specifies
 * them ("Discrete PA", "Friends with benefits", "Fiancé"); the keys are what is
 * stored, and they never change.
 *
 * Nothing here carries a rate, a fee or an offer field, and nothing here
 * touches the messaging gate: an interest category changes who a member sees,
 * never who may message them. That separation is the whole reason these
 * categories can exist alongside .docs §2.
 */

const GROUPS = [
  {
    key: 'household',
    label: 'Household',
    options: [
      { key: 'nanny', label: 'Nanny' },
      { key: 'au_pair', label: 'Au pair' }
    ]
  },
  {
    key: 'business',
    label: 'Business',
    options: [
      { key: 'discrete_pa', label: 'Discrete PA' }
    ]
  },
  {
    key: 'social',
    label: 'Social',
    options: [
      { key: 'atmosphere_model', label: 'Atmosphere model' },
      { key: 'model', label: 'Model' }
    ]
  },
  {
    key: 'dating',
    label: 'Dating',
    options: [
      { key: 'just_dating', label: 'Just dating' },
      { key: 'friends_with_benefits', label: 'Friends with benefits' },
      { key: 'girlfriend', label: 'Girlfriend' },
      { key: 'fiance', label: 'Fiancé' }
    ]
  }
];

const KEYS = GROUPS.flatMap((group) => group.options.map((option) => option.key));

const LABELS = Object.fromEntries(
  GROUPS.flatMap((group) => group.options.map((option) => [option.key, option.label]))
);

/** Drops anything not in the taxonomy and de-duplicates, preserving order. */
function normalise(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (KEYS.includes(value) && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/**
 * Whether a viewer's filter admits a candidate's declaration.
 *
 * An empty set on either side means "no constraint" — that is the zero-selection
 * state the design specifies, and it is what every member holds before they have
 * ever answered the question. Without it, adding the taxonomy would silently
 * empty every existing deck.
 */
function overlaps(filter, declared) {
  const a = normalise(filter);
  const b = normalise(declared);
  if (!a.length || !b.length) return true;
  return a.some((key) => b.includes(key));
}

function labelFor(key) {
  return LABELS[key] || key;
}

module.exports = { GROUPS, KEYS, LABELS, normalise, overlaps, labelFor };
