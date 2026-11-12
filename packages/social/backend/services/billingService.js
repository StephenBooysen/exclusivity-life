'use strict';

/**
 * @fileoverview Payment provider abstraction.
 *
 * Two providers behind one interface:
 *  - `stub`   — records subscriptions locally and activates immediately. The
 *               default, so the app runs with no Stripe account and no keys.
 *  - `stripe` — Checkout Sessions in subscription mode, with the webhook
 *               handler that subscription billing genuinely requires: renewals,
 *               failures and cancellations all happen asynchronously and after
 *               checkout, so a success-page-only integration never sees them.
 *
 * No card data ever reaches this server under either provider.
 */

const crypto = require('node:crypto');
const config = require('../config');
const { C } = require('./containers');
const { TIERS } = require('./entitlementService');
const { ValidationError } = require('../errors');

/** Stripe wants one Product per tier and Prices for the billing variants. */
function priceIdFor(tier, term) {
  const key = `STRIPE_PRICE_${tier.toUpperCase()}_${term.toUpperCase()}`;
  return process.env[key] || null;
}

function createBillingService({ store, logger }) {
  const provider = config.billing.provider;
  let stripeClient = null;

  function stripe() {
    if (!stripeClient) {
      const Stripe = require('stripe');
      // Instance client — the global api-key pattern is deprecated.
      stripeClient = new Stripe(config.billing.stripeSecretKey);
    }
    return stripeClient;
  }

  /**
   * Starts a checkout. The stub returns an internal URL the client follows to
   * self-activate; Stripe returns a hosted Checkout URL.
   */
  async function createCheckout({ member, tier, term = 'monthly' }) {
    if (!TIERS[tier]) throw new ValidationError('Unknown membership tier');
    if (!['monthly', 'quarterly', 'annual'].includes(term)) throw new ValidationError('Unknown billing term');

    if (provider === 'stub') {
      const ref = `stub_${crypto.randomUUID()}`;
      logger.info(`[billing:stub] checkout for ${member.email} tier=${tier} term=${term}`);
      return { url: `/api/membership/stub-complete?ref=${ref}&tier=${tier}&term=${term}`, providerRef: ref, provider };
    }

    const price = priceIdFor(tier, term);
    if (!price) throw new ValidationError(`No Stripe price configured for ${tier}/${term}`);

    const customerId = await ensureStripeCustomer(member);
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: member.id,
      // payment_method_types is deliberately omitted so Stripe serves the
      // eligible methods configured in the Dashboard.
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { memberId: member.id, tier } },
      metadata: { memberId: member.id, tier, term },
      integration_identifier: 'exclusivity-membership-qkrmvxzt',
      success_url: `${config.billing.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: config.billing.cancelUrl
    });

    return { url: session.url, providerRef: session.id, provider };
  }

  async function ensureStripeCustomer(member) {
    const existing = await store.findOne(C.SUBSCRIPTIONS, (s) => s.memberId === member.id && s.customerId);
    if (existing?.customerId) return existing.customerId;
    const customer = await stripe().customers.create({
      email: member.email,
      name: member.displayName || undefined,
      metadata: { memberId: member.id }
    });
    return customer.id;
  }

  /** Cancels at period end — the member keeps what they paid for. */
  async function cancel(subscription) {
    if (provider === 'stub' || !subscription.providerRef?.startsWith('sub_')) {
      return { cancelAtPeriodEnd: true };
    }
    await stripe().subscriptions.update(subscription.providerRef, { cancel_at_period_end: true });
    return { cancelAtPeriodEnd: true };
  }

  /** Self-service management: card updates, plan changes, cancellation. */
  async function portalUrl(subscription, returnUrl) {
    if (provider === 'stub' || !subscription?.customerId) return null;
    const session = await stripe().billingPortal.sessions.create({
      customer: subscription.customerId,
      return_url: returnUrl
    });
    return session.url;
  }

  /** Verifies the signature so a forged POST cannot grant a membership. */
  function verifyWebhook(rawBody, signature) {
    if (provider === 'stub') return JSON.parse(rawBody.toString('utf8'));
    return stripe().webhooks.constructEvent(rawBody, signature, config.billing.stripeWebhookSecret);
  }

  return { provider, createCheckout, cancel, portalUrl, verifyWebhook, priceIdFor };
}

module.exports = { createBillingService, priceIdFor };
