import { api } from '../api.js';
import { formatCurrency, formatShortDate, daysUntil, amountClass } from '../format.js';
import { sparkline } from '../charts.js';
import { cycleStartContaining, cycleEndFor, monthsInRange, getTodayIso } from '../cycle.js';

function dotColorFor(order) {
  const text = `${order.payee} ${order.category}`.toLowerCase();
  if (text.includes('loan') || text.includes('bond')) return 'var(--brand)';
  if (text.includes('insur') || text.includes('medical')) return 'var(--orange)';
  return 'var(--text-faint)';
}

function accountSummaryCard(label, value, fillPct, fillColor, caption) {
  return `
    <div class="summary-card">
      <div class="summary-card__label">${label}</div>
      <div class="summary-card__value tabular ${amountClass(value)}">${formatCurrency(value)}</div>
      <div class="bar-track" style="margin-bottom:6px;"><div class="bar-fill" style="width:${Math.min(100, Math.max(0, fillPct))}%;background:${fillColor};"></div></div>
      <div class="summary-card__caption">${caption}</div>
    </div>
  `;
}

/** Credit cards and revolving credit (a loan with a limit) both draw down/repay against a limit, so show what's left to spend alongside what's owed instead of a single balance. */
function revolvingSummaryCard(label, balance, limit) {
  const owing = balance || 0;
  const available = Math.max(0, (limit || 0) - owing);
  const fillPct = limit ? (owing / limit) * 100 : 0;
  return `
    <div class="summary-card">
      <div class="summary-card__label" style="margin-bottom:10px;">${label}</div>
      <div class="row" style="margin-bottom:6px;">
        <span style="font-size:12px;color:var(--text-soft);">Available</span>
        <span style="font-size:14px;font-weight:700;color:var(--text);" class="tabular">${formatCurrency(available)}</span>
      </div>
      <div class="row" style="margin-bottom:10px;">
        <span style="font-size:12px;color:var(--text-soft);">To pay off</span>
        <span style="font-size:14px;font-weight:700;color:var(--orange);" class="tabular">${formatCurrency(owing)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.max(0, fillPct))}%;background:var(--orange);"></div></div>
    </div>
  `;
}

/** A cash account with an overdraft facility can still spend past a zero/negative balance, so show what's actually left to spend rather than just the raw balance. */
function overdraftSummaryCard(label, balance, overdraft) {
  const bal = balance || 0;
  const available = Math.max(0, (overdraft || 0) + bal);
  const used = Math.max(0, -bal);
  const fillPct = overdraft ? (used / overdraft) * 100 : 0;
  return `
    <div class="summary-card">
      <div class="summary-card__label mb-10">${label}</div>
      <div class="row mb-6">
        <span class="fs-12 muted">Balance</span>
        <span class="value-md tabular ${amountClass(bal)}">${formatCurrency(bal)}</span>
      </div>
      <div class="row mb-10">
        <span class="fs-12 muted">Available</span>
        <span class="value-md tabular">${formatCurrency(available)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.max(0, fillPct))}%;background:var(--orange);"></div></div>
    </div>
  `;
}

/** Per-type formula for the progress bar + caption on a Home summary card. */
function summaryCardFor(account) {
  const label = (account.name || '').toUpperCase();
  if (account.type === 'cash' && account.overdraft > 0) return overdraftSummaryCard(label, account.balance, account.overdraft);
  switch (account.type) {
    case 'credit_card':
      return revolvingSummaryCard(label, account.balance, account.limit);
    case 'home_loan': {
      const equityPct = account.propertyValue ? ((account.propertyValue - account.balance) / account.propertyValue) * 100 : 0;
      return accountSummaryCard(
        label, account.balance, equityPct, 'var(--brand)',
        account.instalment ? `${formatCurrency(account.instalment)} / month` : ''
      );
    }
    case 'loan': {
      if (account.limit) return revolvingSummaryCard(label, account.balance, account.limit);
      const paidPct = account.originalAmount ? ((account.originalAmount - account.balance) / account.originalAmount) * 100 : 0;
      return accountSummaryCard(
        label, account.balance, paidPct, 'var(--brand)',
        account.instalment ? `${formatCurrency(account.instalment)} / month` : ''
      );
    }
    default:
      return accountSummaryCard(
        label, account.balance, Math.min(100, ((account.balance || 0) / 200000) * 100), 'var(--sage)',
        account.growthRateAssumed ? `${(account.growthRateAssumed * 100).toFixed(1)}% p.a.` : ''
      );
  }
}

export async function renderHome(root) {
  const [summary, accounts] = await Promise.all([
    api.dashboard.get(),
    api.accounts.list()
  ]);

  const summaryCards = accounts.filter((a) => a.showOnHome).map(summaryCardFor);

  const upcomingHtml = summary.upcomingDebitOrders.length
    ? summary.upcomingDebitOrders.map((order) => `
        <div class="list-item">
          <div class="list-item__dot" style="background:${dotColorFor(order)};"></div>
          <div class="list-item__body">
            <div class="list-item__title">${order.payee}</div>
            <div class="list-item__sub">In ${daysUntil(order.dueDate)} days · ${formatShortDate(order.dueDate)}</div>
          </div>
          <div class="list-item__amt tabular">${formatCurrency(order.amount)}</div>
        </div>
      `).join('')
    : '<p class="muted" style="font-size:12.5px;padding:14px 16px;">Nothing due in the next 7 days.</p>';

  const currentAccount = accounts.find((a) => a.type === 'cash' && a.vehicleType !== 'savings');
  const [categories, settings] = await Promise.all([api.categories.list(), api.settings.get()]);
  const monthBudget = categories.reduce((sum, c) => sum + (c.monthlyBudget || 0), 0);

  // "This month" means the current pay cycle (payday to payday), not the calendar month — a
  // debit-order or expense dated a few days into next month can still belong to today's cycle.
  let monthSpent = 0;
  if (currentAccount) {
    const paydayDay = settings.paydayDay || 25;
    const todayIso = getTodayIso();
    const cycleStart = cycleStartContaining(todayIso, paydayDay);
    const cycleEnd = cycleEndFor(cycleStart, paydayDay);
    const lists = await Promise.all(monthsInRange(cycleStart, cycleEnd).map((m) => api.transactions.list(currentAccount.id, m)));
    monthSpent = lists.flat()
      .filter((t) => t.kind !== 'opening_balance' && t.date >= cycleStart && t.date <= cycleEnd)
      .reduce((sum, t) => sum + t.amount, 0);
  }
  const spendPct = monthBudget ? (monthSpent / monthBudget) * 100 : 0;

  const deltaPositive = summary.delta30d >= 0;
  const deltaBaseline = summary.netWorth - summary.delta30d;
  const deltaPct = deltaBaseline ? Math.abs((summary.delta30d / deltaBaseline) * 100) : 0;

  root.innerHTML = `
    <div class="hero-card">
      <div class="hero-card__label">Total Net Worth</div>
      <div class="hero-card__value tabular">${formatCurrency(summary.netWorth)}</div>
      <div class="row" style="justify-content:flex-start;gap:8px;margin-bottom:16px;">
        <span class="pill-badge">${deltaPositive ? '▲' : '▼'} ${deltaPct.toFixed(1)}%</span>
        <span style="font-size:12px;color:var(--mint-soft);">this month</span>
      </div>
      ${summary.trend.length > 1 ? sparkline(summary.trend.map((t) => ({ value: t.netWorth }))) : ''}
    </div>

    <div class="section-head"><span class="section-head__title">Where It Sits</span></div>
    <div class="card card--list">
      <div class="row-item"><span class="row-item__label">Cash &amp; savings</span><span class="row-item__value tabular ${amountClass(summary.breakdown.cash)}">${formatCurrency(summary.breakdown.cash)}</span></div>
      <div class="row-item"><span class="row-item__label">Investments &amp; retirement</span><span class="row-item__value tabular ${amountClass(summary.breakdown.investments)}">${formatCurrency(summary.breakdown.investments)}</span></div>
      <div class="row-item"><span class="row-item__label">Property equity</span><span class="row-item__value tabular ${amountClass(summary.breakdown.propertyEquity)}">${formatCurrency(summary.breakdown.propertyEquity)}</span></div>
      <div class="row-item row-item--danger"><span class="row-item__label">Other debt</span><span class="row-item__value tabular">−${formatCurrency(summary.breakdown.otherDebt)}</span></div>
    </div>

    ${summaryCards.length ? `
      <div class="section-head">
        <span class="section-head__title">Your Accounts</span>
        <button class="section-head__action" id="see-all-accounts">See all</button>
      </div>
      <div class="scroll-row">${summaryCards.join('')}</div>
    ` : ''}

    <div class="section-head"><span class="section-head__title">Upcoming Debit Orders</span></div>
    <div class="card card--list">${upcomingHtml}</div>

    <div class="section-head"><span class="section-head__title">This Month's Spending</span></div>
    <div class="card">
      <div class="row" style="align-items:baseline;margin-bottom:10px;">
        <span style="font-size:20px;font-weight:800;color:var(--text);" class="tabular">${formatCurrency(monthSpent)}</span>
        <span style="font-size:13px;color:var(--text-soft);">of ${formatCurrency(monthBudget)} budget</span>
      </div>
      <div class="bar-track bar-track--lg"><div class="bar-fill" style="width:${Math.min(100, spendPct)}%;background:${spendPct > 100 ? 'var(--orange)' : 'var(--brand)'};"></div></div>
    </div>
  `;

  root.querySelector('#see-all-accounts')?.addEventListener('click', () => {
    location.hash = '#/accounts';
  });
}
