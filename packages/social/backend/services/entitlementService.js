'use strict';

/**
 * @fileoverview Tier -> capability resolution. The single source of truth for
 * the membership matrix in .docs §5.1.
 *
 * Entitlements are always derived from current subscription state at request
 * time — never cached on the member record, never taken from the client. The
 * client is told what it may do so the UI can render honestly, but the server
 * re-derives it on every gated action.
 */

const { EntitlementError, AllowanceError } = require('../errors');

const UNLIMITED = Number.MAX_SAFE_INTEGER;

/**
 * Women hold `select` permanently and free; men hold whatever their
 * subscription says. Tier never buys inbox access, a badge, or a decision
 * reversal — only volume, filtering and discretion.
 */
const TIERS = {
  select: {
    label: 'Select',
    price: 0,
    deck: 12,
    likesPerDay: UNLIMITED,
    whoLikedYou: true,
    filters: true,
    travel: true,
    readReceipts: true,
    incognito: true,
    boostsPerMonth: 0,
    priorityReview: false,
    concierge: false,
    supportHours: 48
  },
  signature: {
    label: 'Signature',
    price: 899,
    deck: 5,
    likesPerDay: 10,
    whoLikedYou: false,
    filters: false,
    travel: false,
    readReceipts: false,
    incognito: false,
    boostsPerMonth: 0,
    priorityReview: false,
    concierge: false,
    supportHours: 48
  },
  elite: {
    label: 'Elite',
    price: 2499,
    deck: 12,
    likesPerDay: 40,
    whoLikedYou: true,
    filters: true,
    travel: true,
    readReceipts: true,
    incognito: false,
    boostsPerMonth: 2,
    priorityReview: true,
    concierge: false,
    supportHours: 24
  },
  noir: {
    label: 'Noir',
    price: 7999,
    deck: 25,
    likesPerDay: UNLIMITED,
    whoLikedYou: true,
    filters: true,
    travel: true,
    readReceipts: true,
    incognito: true,
    boostsPerMonth: 8,
    priorityReview: true,
    concierge: true,
    supportHours: 4,
    inviteOnly: true
  }
};

/** A dormant member keeps their conversations and loses everything else. */
const DORMANT = {
  label: 'Dormant',
  price: 0,
  deck: 0,
  likesPerDay: 0,
  whoLikedYou: false,
  filters: false,
  travel: false,
  readReceipts: false,
  incognito: false,
  boostsPerMonth: 0,
  priorityReview: false,
  concierge: false,
  supportHours: 48
};

function createEntitlementService({ store, membership }) {
  /**
   * Resolves the effective tier for a member from live subscription state.
   * @param {Object} member
   * @return {Promise<{tier: string, entitlements: Object}>}
   */
  async function resolve(member) {
    if (!member) return { tier: 'dormant', entitlements: DORMANT };

    // Women never carry a subscription — Select is permanent and free.
    if (member.side === 'female') {
      return { tier: 'select', entitlements: TIERS.select };
    }

    const state = await membership.state(member.id);
    if (!state || !['trialing', 'active', 'past_due'].includes(state.state)) {
      return { tier: 'dormant', entitlements: DORMANT };
    }
    const entitlements = TIERS[state.tier] || DORMANT;
    return { tier: state.tier, entitlements };
  }

  /** Throws unless the member's tier includes `key`. */
  async function assert(member, key) {
    const { tier, entitlements } = await resolve(member);
    const value = entitlements[key];
    if (!value) throw new EntitlementError(key, tier);
    return value;
  }

  /** The numeric allowance for `key`, or 0 if the tier excludes it. */
  async function allowance(member, key) {
    const { entitlements } = await resolve(member);
    return entitlements[key] || 0;
  }

  return { resolve, assert, allowance, TIERS, UNLIMITED };
}

module.exports = { createEntitlementService, TIERS, DORMANT, UNLIMITED };
