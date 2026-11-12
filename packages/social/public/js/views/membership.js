/**
 * A5 — choose a membership.
 *
 * A tier buys volume, filters and discretion. It does not buy a badge, an
 * inbox, or a reversed decision, and the screen says so above the button rather
 * than in a terms page. Noir is not selectable: it is issued, not sold.
 *
 * The Select side sees a plain statement that it is free, and no upsell surface
 * of any kind — not a comparison, not a tier list, not a nudge.
 */

import { api } from '../api.js';
import { escapeHtml, money, fullDate } from '../format.js';
import { toast, toastError } from '../toast.js';
import { getSession, refreshCurrent, go } from '../router.js';
import { confirmSheet, openSheet } from '../components/sheet.js';
import { decorate } from '../blueprint.js';

/** The feature grid on the selected card, in the order the design lists it. */
const FEATURES = [
  ['deck', (v) => `${v} introductions daily`],
  ['likesPerDay', (v) => (v > 100000 ? 'Unlimited likes' : `${v} likes`)],
  ['whoLikedYou', () => 'Who liked you'],
  ['filters', () => 'Advanced filters'],
  ['travel', () => 'Travel mode'],
  ['readReceipts', () => 'Read receipts'],
  ['boostsPerMonth', (v) => (v ? `${v} boost${v === 1 ? '' : 's'} / month` : null)],
  ['supportHours', (v) => (v <= 24 ? `${v}h support` : null)],
  ['incognito', () => 'Incognito'],
  ['concierge', () => 'Introductions chosen by hand']
];

export async function renderMembership(root) {
  const data = await api.membership.get();

  if (data.free) {
    root.innerHTML = `
      <section class="screen">
        <div class="pad" style="padding-top:52px">
          <div class="eyebrow">Membership</div>
          <h1 class="h-xl" style="margin-top:14px">Yours is free.</h1>
          <p class="lede" style="margin-top:12px;max-width:36ch">
            Membership on the Select side is free and stays free. There is no tier above
            yours, nothing to buy, and nothing withheld from you.
          </p>
        </div>
        <div class="screen__foot">
          <button class="btn btn--primary btn--block" data-go type="button">See today's introductions</button>
        </div>
      </section>`;
    decorate(root);
    root.querySelector('[data-go]').addEventListener('click', () => go('discover'));
    return;
  }

  const active = data.state && ['active', 'trialing', 'past_due'].includes(data.state);
  // Pre-select the tier the design highlights: the current one, or Elite.
  let chosen = data.tier || (data.tiers.find((t) => t.key === 'elite') ? 'elite' : data.tiers[0]?.key);

  function paint() {
    const selected = data.tiers.find((t) => t.key === chosen);

    root.innerHTML = `
      <section class="screen">
        <div class="pad" style="padding-top:30px">
          <div class="eyebrow" style="color:var(--accent);letter-spacing:.2em">
            ${active
    ? `${escapeHtml(data.cancelAtPeriodEnd ? 'Ends' : 'Renews')} ${escapeHtml(fullDate(data.currentPeriodEnd))}`
    : `Approved${approvedOn() ? ` · ${escapeHtml(approvedOn())}` : ''}`}
          </div>
          <h1 style="font-size:30px;margin-top:12px">${active ? 'Your membership' : 'Choose a membership'}</h1>
          <p class="lede" style="margin-top:6px;font-size:13px;color:var(--t50)">
            Tiers buy volume, filters and discretion. Nothing else.
          </p>
        </div>

        ${data.state === 'past_due' ? `
          <div class="pad" style="padding-top:20px"><div class="notice">
            <strong>We couldn't take payment</strong>
            Update your card to keep your membership open.
          </div></div>` : ''}

        <div class="pad" style="padding-top:24px;display:flex;flex-direction:column;gap:12px">
          ${data.tiers.map((tier) => tierCard(tier, { chosen, current: data.tier })).join('')}
        </div>

        <div class="screen__foot" style="padding-top:24px">
          <p class="legal" style="margin-bottom:14px">
            No tier buys a badge, an inbox, or a reversed decision. Cancel in two taps,
            effective at period end.
          </p>
          ${active ? `
            <div class="stack" style="gap:10px">
              <button class="btn btn--secondary btn--full" data-invoices type="button">Receipts</button>
              ${data.cancelAtPeriodEnd
    ? `<p class="hint center">Your membership ends on ${escapeHtml(fullDate(data.currentPeriodEnd))}.</p>`
    : '<button class="btn btn--quiet btn--full" data-cancel type="button">Cancel membership</button>'}
            </div>`
    : `<button class="btn btn--primary btn--block" data-continue type="button" ${selected && !selected.inviteOnly ? '' : 'disabled'}>
                ${selected && !selected.inviteOnly
    ? `Continue · ${escapeHtml(money(selected.price))} / month`
    : 'Choose a tier'}
              </button>`}
        </div>
      </section>`;

    decorate(root);
    wire();
  }

  function approvedOn() {
    const at = getSession().member?.approvedAt;
    if (!at) return null;
    const date = new Date(at);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function wire() {
    root.querySelectorAll('[data-tier]').forEach((node) => {
      node.addEventListener('click', () => {
        if (node.dataset.invite === 'true') {
          return toast('Noir is issued by the house, not sold');
        }
        chosen = node.dataset.tier;
        paint();
        return undefined;
      });
    });

    root.querySelector('[data-continue]')?.addEventListener('click', async () => {
      const tier = data.tiers.find((t) => t.key === chosen);
      const ok = await confirmSheet({
        title: `${tier.label} — ${money(tier.price)} a month`,
        body: `${tier.deck} introductions a day. Cancel any time in two taps; it runs to the end of the period you paid for.`,
        confirmLabel: 'Continue to payment'
      });
      if (!ok) return;
      try {
        const session = await api.membership.subscribe(chosen, 'monthly');
        // The stub provider hands back an internal completion URL; Stripe hands
        // back a hosted Checkout URL. Both are simply followed.
        window.location.href = session.url;
      } catch (err) { toastError(err); }
    });

    root.querySelector('[data-cancel]')?.addEventListener('click', async () => {
      const ok = await confirmSheet({
        title: 'Cancel your membership?',
        body: `It stays open until ${fullDate(data.currentPeriodEnd)}. Your conversations stay with you either way.`,
        confirmLabel: 'Cancel membership',
        danger: true
      });
      if (!ok) return;
      try {
        await api.membership.cancel();
        toast('Cancelled. Open until the end of the period.');
        await refreshCurrent();
      } catch (err) { toastError(err); }
    });

    root.querySelector('[data-invoices]')?.addEventListener('click', async () => {
      const invoices = await api.membership.invoices();
      openSheet(`
        <h2>Receipts</h2>
        <div class="grid-list" style="margin-top:18px">
          ${invoices.length ? invoices.map((inv) => `
            <div class="grid-row">
              <div class="grid-row__body">
                <div class="grid-row__title">${escapeHtml(fullDate(inv.paidAt))}</div>
                <div class="grid-row__note">${escapeHtml(inv.tier)}</div>
              </div>
              <span style="font-size:13px">${escapeHtml(money(inv.amount, inv.currency))}</span>
            </div>`).join('')
    : '<div class="grid-row"><div class="grid-row__body"><div class="grid-row__note">No receipts yet.</div></div></div>'}
        </div>
        <button class="btn btn--quiet btn--full" style="margin-top:18px" data-close type="button">Close</button>`, {
        label: 'Receipts'
      });
    });
  }

  paint();
}

function tierCard(tier, { chosen, current }) {
  const on = tier.key === chosen && !tier.inviteOnly;
  const isCurrent = tier.key === current;

  const included = [];
  for (const [key, render] of FEATURES) {
    const text = tier[key] ? render(tier[key]) : null;
    if (text) included.push(text);
  }

  if (tier.inviteOnly) {
    // A real button, marked unavailable rather than inert: it is reachable by
    // keyboard, it announces its state, and pressing it says why it cannot be
    // chosen instead of doing nothing.
    return `
      <button class="blueprint tier tier--invite" type="button" aria-disabled="true"
        data-tier="${escapeHtml(tier.key)}" data-invite="true">
        <div class="tier__head">
          <span class="tier__name">${escapeHtml(tier.label)}</span>
          <span class="tier__invite">Invitation</span>
        </div>
        <div class="tier__line">Issued by the house. Not available at checkout.</div>
      </button>`;
  }

  return `
    <button class="blueprint tier${on ? ' blueprint--on tier--on' : ''}" type="button"
      data-tier="${escapeHtml(tier.key)}" aria-pressed="${on}">
      <div class="tier__head">
        <span style="display:flex;align-items:baseline;gap:9px">
          <span class="tier__name">${escapeHtml(tier.label)}</span>
          ${isCurrent ? '<span class="tag tag-accent">Current</span>'
    : on ? '<span class="tag tag-accent">Selected</span>' : ''}
        </span>
        <span class="tier__price">${escapeHtml(money(tier.price))}<small> /mo</small></span>
      </div>
      ${on
    ? `<div class="tier__grid">${included.map((f) => `<span>${escapeHtml(f)}</span>`).join('')}</div>
         <div class="tier__note">3-month and 12-month terms available at a discount.</div>`
    : `<div class="tier__line">${escapeHtml(included.slice(0, 2).join(' · '))}</div>`}
    </button>`;
}
