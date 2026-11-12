'use strict';

/**
 * @fileoverview Subscription lifecycle.
 *
 * States: trialing -> active -> past_due -> (grace) -> expired | cancelled.
 * Transitions are driven by webhooks in production and by the sweep job as a
 * backstop, because a webhook that never arrives must not leave a member
 * permanently in the wrong state.
 */

const config = require('../config');
const { C } = require('./containers');
const { TIERS } = require('./entitlementService');
const { addDays } = require('./utils');
const { ValidationError, NotFoundError, ConflictError, ForbiddenError } = require('../errors');

const STATE = {
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired'
};

const LIVE_STATES = [STATE.TRIALING, STATE.ACTIVE, STATE.PAST_DUE];

const TERM_DAYS = { monthly: 30, quarterly: 91, annual: 365 };

function createMembershipService({ store, members, billing, notifications, activity, versionedCache }) {
  /** The member's current subscription, or null. Latest wins. */
  async function state(memberId) {
    const all = await store.findAll(C.SUBSCRIPTIONS, (s) => s.memberId === memberId);
    if (!all.length) return null;
    const live = all.filter((s) => LIVE_STATES.includes(s.state));
    const pool = live.length ? live : all;
    return pool.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
  }

  async function checkout(member, { tier, term = 'monthly' }) {
    if (member.side === 'female') {
      throw new ForbiddenError('Select membership is free — there is nothing to pay', 'no_payment_required');
    }
    if (!TIERS[tier]) throw new ValidationError('Unknown membership tier');
    if (TIERS[tier].inviteOnly) {
      const invite = await store.findOne(
        C.INVITES,
        (i) => i.memberId === member.id && i.tier === tier && !i.redeemedAt && !i.revokedAt
      );
      if (!invite) throw new ForbiddenError('Noir is by invitation', 'invite_required');
    }

    const current = await state(member.id);
    if (current && LIVE_STATES.includes(current.state) && current.tier === tier) {
      throw new ConflictError('You already hold this membership', 'already_subscribed');
    }

    const session = await billing.createCheckout({ member, tier, term });
    await activity.log('billing.checkout_started', `${member.email} → ${tier}/${term}`, {
      memberId: member.id, tier, term, provider: session.provider
    });
    return session;
  }

  /** Activates a subscription. Idempotent on providerRef. */
  async function activate(memberId, { tier, term = 'monthly', providerRef, customerId, periodEnd }) {
    const member = await members.getOrThrow(memberId);
    if (providerRef) {
      const existing = await store.findOne(C.SUBSCRIPTIONS, (s) => s.providerRef === providerRef);
      if (existing) return existing;
    }

    const now = new Date();
    const currentPeriodEnd = periodEnd || addDays(now, TERM_DAYS[term] || 30).toISOString();

    // Supersede anything still live so `state()` cannot see two at once.
    const prior = await store.findAll(
      C.SUBSCRIPTIONS,
      (s) => s.memberId === memberId && LIVE_STATES.includes(s.state)
    );
    for (const record of prior) {
      await store.update(C.SUBSCRIPTIONS, record.id, { state: STATE.EXPIRED, supersededAt: now.toISOString() });
    }

    const subscription = await store.create(C.SUBSCRIPTIONS, {
      memberId,
      tier,
      term,
      state: STATE.ACTIVE,
      provider: billing.provider,
      providerRef: providerRef || null,
      customerId: customerId || null,
      startedAt: now.toISOString(),
      currentPeriodEnd,
      cancelledAt: null,
      cancelAtPeriodEnd: false,
      cancelReason: null,
      graceUntil: null
    });

    await store.create(C.INVOICES, {
      memberId,
      subscriptionId: subscription.id,
      tier,
      term,
      amount: TIERS[tier].price,
      currency: config.currency,
      paidAt: now.toISOString(),
      providerRef: providerRef || null
    });

    await members.update(memberId, { tier });
    // Approval leaves a man dormant; paying is what opens the product.
    if (member.status === members.STATUS.DORMANT) {
      await members.setStatus(memberId, members.STATUS.ACTIVE, { reason: 'subscription_activated' });
    }

    const invite = await store.findOne(
      C.INVITES,
      (i) => i.memberId === memberId && i.tier === tier && !i.redeemedAt && !i.revokedAt
    );
    if (invite) await store.update(C.INVITES, invite.id, { redeemedAt: now.toISOString() });

    await notifications.notify(memberId, 'membership.started', { tier: TIERS[tier].label });
    await activity.log('billing.activated', `${member.email} → ${tier}`, {
      memberId, tier, term, providerRef
    });
    await versionedCache.bumpAll(['members', 'decks']);
    return subscription;
  }

  async function cancel(memberId, { reason } = {}) {
    const current = await state(memberId);
    if (!current || !LIVE_STATES.includes(current.state)) {
      throw new ConflictError('You do not have an active membership');
    }
    await billing.cancel(current);
    const updated = await store.update(C.SUBSCRIPTIONS, current.id, {
      cancelAtPeriodEnd: true,
      cancelledAt: new Date().toISOString(),
      cancelReason: reason || null
    });
    await notifications.notify(memberId, 'membership.cancelled', { periodEnd: current.currentPeriodEnd });
    await activity.log('billing.cancelled', `membership cancelled`, { memberId, reason });
    return updated;
  }

  async function changeTier(memberId, { tier }) {
    const member = await members.getOrThrow(memberId);
    const current = await state(memberId);
    if (!current) throw new ConflictError('You do not have an active membership');
    if (!TIERS[tier]) throw new ValidationError('Unknown membership tier');

    const upgrading = TIERS[tier].price > TIERS[current.tier].price;
    if (upgrading) {
      // An upgrade goes back through checkout so the price difference is
      // actually collected rather than assumed.
      return billing.createCheckout({ member, tier, term: current.term });
    }
    // Downgrades take effect at period end.
    const updated = await store.update(C.SUBSCRIPTIONS, current.id, { pendingTier: tier });
    await activity.log('billing.downgrade_scheduled', `${current.tier} → ${tier} at period end`, {
      memberId, from: current.tier, to: tier
    });
    return updated;
  }

  async function invoices(memberId) {
    const all = await store.findAll(C.INVOICES, (i) => i.memberId === memberId);
    return all.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
  }

  async function markPastDue(memberId, { providerRef } = {}) {
    const current = providerRef
      ? await store.findOne(C.SUBSCRIPTIONS, (s) => s.providerRef === providerRef)
      : await state(memberId);
    if (!current) return null;
    const graceUntil = addDays(new Date(), config.billing.gracePeriodDays).toISOString();
    const updated = await store.update(C.SUBSCRIPTIONS, current.id, { state: STATE.PAST_DUE, graceUntil });
    await notifications.notify(current.memberId, 'membership.renewal_failed', { graceUntil });
    await activity.log('billing.past_due', 'renewal failed', { memberId: current.memberId, graceUntil });
    return updated;
  }

  async function renew(providerRef, { periodEnd }) {
    const current = await store.findOne(C.SUBSCRIPTIONS, (s) => s.providerRef === providerRef);
    if (!current) return null;
    const updated = await store.update(C.SUBSCRIPTIONS, current.id, {
      state: STATE.ACTIVE,
      currentPeriodEnd: periodEnd || addDays(new Date(), TERM_DAYS[current.term] || 30).toISOString(),
      graceUntil: null
    });
    await store.create(C.INVOICES, {
      memberId: current.memberId,
      subscriptionId: current.id,
      tier: current.tier,
      term: current.term,
      amount: TIERS[current.tier].price,
      currency: config.currency,
      paidAt: new Date().toISOString(),
      providerRef
    });
    await notifications.notify(current.memberId, 'membership.receipt', {
      tier: TIERS[current.tier].label, amount: TIERS[current.tier].price, periodEnd: updated.currentPeriodEnd
    });
    await versionedCache.bump('members');
    return updated;
  }

  /**
   * Backstop for everything the webhook did not deliver. Advances past_due
   * past its grace window, expires ended periods, and downgrades the member to
   * dormant — conversations readable, nothing else.
   */
  async function sweep() {
    const all = await store.list(C.SUBSCRIPTIONS);
    const now = new Date();
    let expired = 0;
    let downgraded = 0;

    for (const subscription of all) {
      if (!LIVE_STATES.includes(subscription.state)) continue;

      const periodOver = new Date(subscription.currentPeriodEnd) < now;
      const graceOver = subscription.graceUntil && new Date(subscription.graceUntil) < now;

      if (subscription.state === STATE.PAST_DUE && graceOver) {
        await store.update(C.SUBSCRIPTIONS, subscription.id, { state: STATE.EXPIRED, expiredAt: now.toISOString() });
        await downgrade(subscription.memberId);
        expired += 1;
        downgraded += 1;
        continue;
      }

      if (periodOver && subscription.cancelAtPeriodEnd) {
        await store.update(C.SUBSCRIPTIONS, subscription.id, { state: STATE.CANCELLED, expiredAt: now.toISOString() });
        await downgrade(subscription.memberId);
        expired += 1;
        downgraded += 1;
        continue;
      }

      if (periodOver && subscription.pendingTier) {
        await store.update(C.SUBSCRIPTIONS, subscription.id, {
          tier: subscription.pendingTier,
          pendingTier: null,
          currentPeriodEnd: addDays(now, TERM_DAYS[subscription.term] || 30).toISOString()
        });
        await members.update(subscription.memberId, { tier: subscription.pendingTier });
        continue;
      }

      // The stub provider has no dunning of its own, so a lapsed period is
      // treated as a failed renewal rather than silently rolling forward.
      if (periodOver && billing.provider === 'stub') {
        await markPastDue(subscription.memberId);
      }
    }

    if (expired) await versionedCache.bumpAll(['members', 'decks']);
    return { expired, downgraded };
  }

  async function downgrade(memberId) {
    const member = await members.get(memberId);
    if (!member || member.side === 'female') return;
    if ([members.STATUS.ACTIVE].includes(member.status)) {
      await members.setStatus(memberId, members.STATUS.DORMANT, { reason: 'subscription_lapsed' });
    }
    await members.update(memberId, { tier: null });
  }

  /**
   * Stripe webhook handling. Subscription state changes are asynchronous and
   * land here, not on the success page.
   */
  async function handleWebhook(event) {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;
        const memberId = session.metadata?.memberId || session.client_reference_id;
        if (!memberId) break;
        await activate(memberId, {
          tier: session.metadata?.tier,
          term: session.metadata?.term || 'monthly',
          providerRef: session.subscription,
          customerId: session.customer
        });
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await renew(invoice.subscription, {
            periodEnd: invoice.lines?.data?.[0]?.period?.end
              ? new Date(invoice.lines.data[0].period.end * 1000).toISOString()
              : null
          });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) await markPastDue(null, { providerRef: invoice.subscription });
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const record = await store.findOne(C.SUBSCRIPTIONS, (s) => s.providerRef === subscription.id);
        if (record) {
          await store.update(C.SUBSCRIPTIONS, record.id, { state: STATE.CANCELLED, expiredAt: new Date().toISOString() });
          await downgrade(record.memberId);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const record = await store.findOne(C.SUBSCRIPTIONS, (s) => s.providerRef === subscription.id);
        if (record) {
          await store.update(C.SUBSCRIPTIONS, record.id, {
            cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : record.currentPeriodEnd
          });
        }
        break;
      }
      default:
        break;
    }
    return { handled: true, type: event.type };
  }

  /** What the membership screen renders. */
  async function summary(member) {
    const current = await state(member.id);
    return {
      side: member.side,
      tier: member.side === 'female' ? 'select' : (current?.tier || null),
      state: member.side === 'female' ? 'active' : (current?.state || null),
      currentPeriodEnd: current?.currentPeriodEnd || null,
      cancelAtPeriodEnd: current?.cancelAtPeriodEnd || false,
      pendingTier: current?.pendingTier || null,
      free: member.side === 'female',
      tiers: Object.entries(TIERS)
        .filter(([key]) => (member.side === 'female' ? key === 'select' : key !== 'select'))
        .map(([key, value]) => ({ key, ...value }))
    };
  }

  return {
    state, checkout, activate, cancel, changeTier, invoices, markPastDue,
    renew, sweep, downgrade, handleWebhook, summary, STATE, LIVE_STATES
  };
}

module.exports = { createMembershipService, STATE, LIVE_STATES };
