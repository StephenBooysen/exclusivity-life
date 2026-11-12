'use strict';

/**
 * @fileoverview Membership: tiers, checkout, cancellation, invoices, webhook.
 */

const express = require('express');
const { asyncHandler } = require('./asyncHandler');
const { ValidationError } = require('../errors');
const config = require('../config');

function membershipRouter({ membership, billing, members, entitlements, logger }, { requireAuth }) {
  const router = express.Router();

  /**
   * Stripe signs the raw body, so this route is mounted before the JSON parser
   * and is exempt from CSRF — a signature is the authentication.
   */
  router.post('/webhook', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
    let event;
    try {
      event = billing.verifyWebhook(req.body, req.get('stripe-signature'));
    } catch (err) {
      logger.error(`[billing] webhook signature rejected: ${err.message}`);
      return res.status(400).json({ error: 'Invalid signature' });
    }
    await membership.handleWebhook(event);
    return res.json({ received: true });
  }));

  router.use(requireAuth);

  router.get('/', asyncHandler(async (req, res) => {
    const summary = await membership.summary(req.member);
    const { entitlements: allowed, tier } = await entitlements.resolve(req.member);
    res.json({ ...summary, entitlements: allowed, effectiveTier: tier, currency: config.currency });
  }));

  router.post('/subscribe', asyncHandler(async (req, res) => {
    const { tier, term } = req.body || {};
    if (!tier) throw new ValidationError('Choose a membership');
    const session = await membership.checkout(req.member, { tier, term: term || 'monthly' });
    res.status(201).json(session);
  }));

  /**
   * Stub-provider completion. Present only when no PSP is configured, so a
   * developer can exercise the full flow without Stripe keys.
   */
  router.get('/stub-complete', asyncHandler(async (req, res) => {
    if (billing.provider !== 'stub') return res.status(404).json({ error: 'Not found' });
    const { tier, term, ref } = req.query;
    await membership.activate(req.member.id, {
      tier, term: term || 'monthly', providerRef: ref
    });
    return res.redirect('/#/discover');
  }));

  router.post('/cancel', asyncHandler(async (req, res) => {
    const subscription = await membership.cancel(req.member.id, { reason: req.body?.reason });
    res.json({ subscription });
  }));

  router.post('/change-tier', asyncHandler(async (req, res) => {
    const result = await membership.changeTier(req.member.id, { tier: req.body?.tier });
    res.json(result);
  }));

  router.get('/invoices', asyncHandler(async (req, res) => {
    res.json(await membership.invoices(req.member.id));
  }));

  /** Self-service card and plan management, when Stripe is the provider. */
  router.post('/portal', asyncHandler(async (req, res) => {
    const subscription = await membership.state(req.member.id);
    const url = await billing.portalUrl(subscription, config.billing.cancelUrl);
    if (!url) throw new ValidationError('Self-service billing is not available');
    res.json({ url });
  }));

  return router;
}

module.exports = { membershipRouter };
