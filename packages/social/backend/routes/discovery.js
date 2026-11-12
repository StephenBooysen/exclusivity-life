'use strict';

/**
 * @fileoverview Daily introductions, browse, who-liked-you, and acting on a card.
 *
 * Every response that can change an allowance carries the remaining count, so
 * the client renders from the same source of truth the server enforces.
 */

const express = require('express');
const { asyncHandler } = require('./asyncHandler');
const rateLimits = require('../middleware/rateLimits');
const interests = require('../services/interests');
const { ValidationError } = require('../errors');

function discoveryRouter(
  { discovery, matching, members, profiles, entitlements },
  { requireAuth, requireApproved, requireEntitlement }
) {
  const router = express.Router();
  router.use(requireAuth, requireApproved, rateLimits.discovery);

  router.get('/deck', asyncHandler(async (req, res) => {
    const deck = await discovery.deck(req.member.id);
    const allowance = await matching.allowanceState(req.member);
    res.json({ ...deck, allowance });
  }));

  router.get('/browse', requireEntitlement('filters'), asyncHandler(async (req, res) => {
    const cards = await discovery.browse(req.member.id, req.query || {});
    const allowance = await matching.allowanceState(req.member);
    res.json({ cards, allowance });
  }));

  router.get('/liked-me', requireEntitlement('whoLikedYou'), asyncHandler(async (req, res) => {
    const cards = await discovery.whoLikedMe(req.member.id);
    res.json({ cards, count: cards.length });
  }));

  router.get('/viewed-me', requireEntitlement('whoLikedYou'), asyncHandler(async (req, res) => {
    res.json({ cards: await discovery.viewedMe(req.member.id) });
  }));

  router.post('/like', asyncHandler(async (req, res) => {
    const { memberId, source } = req.body || {};
    if (!memberId) throw new ValidationError('Which member?');
    const result = await matching.like(req.member, memberId, source || 'deck');
    res.status(201).json(result);
  }));

  router.post('/pass', asyncHandler(async (req, res) => {
    const { memberId, source } = req.body || {};
    if (!memberId) throw new ValidationError('Which member?');
    const result = await matching.pass(req.member, memberId, source || 'deck');
    res.status(201).json(result);
  }));

  router.get('/allowance', asyncHandler(async (req, res) => {
    res.json(await matching.allowanceState(req.member));
  }));

  /**
   * The interest filter screen. Readable by anyone — a member has to be able to
   * see what the filter would do before they are told they cannot use it — but
   * saving it is entitlement-gated below, server-side, like every other tier
   * capability.
   */
  router.get('/interests', asyncHandler(async (req, res) => {
    const [preferences, profile, { entitlements: allowed, tier }] = await Promise.all([
      profiles.getPreferences(req.member.id),
      profiles.get(req.member.id),
      entitlements.resolve(req.member)
    ]);
    const selected = interests.normalise(preferences.interestCategories);
    // The count is a full pass over the pool, so callers that only want the
    // taxonomy — the deck, to label a card's chips — ask for it without one.
    const wantsCount = req.query.count !== '0';
    res.json({
      groups: interests.GROUPS,
      selected,
      declared: interests.normalise(profile?.interestCategories),
      allowed: Boolean(allowed.filters),
      tier,
      count: wantsCount ? await discovery.countMatching(req.member.id, selected) : null
    });
  }));

  router.post('/interests/count', requireEntitlement('filters'), asyncHandler(async (req, res) => {
    const categories = interests.normalise(req.body?.categories);
    res.json({ count: await discovery.countMatching(req.member.id, categories), categories });
  }));

  router.put('/interests', requireEntitlement('filters'), asyncHandler(async (req, res) => {
    const categories = interests.normalise(req.body?.categories);
    await profiles.updatePreferences(req.member.id, { interestCategories: categories });
    res.json({ selected: categories, count: await discovery.countMatching(req.member.id, categories) });
  }));

  return router;
}

module.exports = { discoveryRouter };
