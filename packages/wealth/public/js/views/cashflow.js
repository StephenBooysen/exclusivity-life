import { api } from '../api.js';
import { formatCurrency, formatShortDate, parseDecimal, amountClass } from '../format.js';
import { donutChart } from '../charts.js';
import { openModal } from '../components/modal.js';
import { showToast } from '../toast.js';
import {
  pad2, clampDay, parseISODate, cycleStartContaining, cycleEndFor, shiftCycle,
  monthsInRange, monthsBetween, remainingCycleFraction, getTodayIso
} from '../cycle.js';

const FREQUENCY_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };
const FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' }
];
const CATEGORY_PALETTE = ['var(--brand)', 'var(--sage)', 'var(--orange)', 'var(--orange-light)', 'var(--text-faint)', 'var(--card-border)'];
const CYCLE_DAY_FORMATTER = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short' });
const CYCLE_DAY_YEAR_FORMATTER = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });

function cycleLabel(startIso, endIso) {
  return `${CYCLE_DAY_FORMATTER.format(parseISODate(startIso))} – ${CYCLE_DAY_YEAR_FORMATTER.format(parseISODate(endIso))}`;
}

/** Compounds the annual inflation rate by however many cycles ahead this one is; 1 for the current/past cycles. */
function inflationFactorFor(cycleMonth, currentCycleMonth, inflationRate) {
  const ahead = monthsBetween(currentCycleMonth, cycleMonth);
  return ahead > 0 ? Math.pow(1 + (inflationRate || 0), ahead / 12) : 1;
}

/** Projections always read last in the feed, regardless of the date they're pinned to. */
function sortFeed(entries) {
  return entries.sort((a, b) => {
    const aProj = a.kind === 'projection' ? 1 : 0;
    const bProj = b.kind === 'projection' ? 1 : 0;
    if (aProj !== bProj) return aProj - bProj;
    return a.date.localeCompare(b.date);
  });
}

// ---- feed synthesis ---------------------------------------------------------

/** One occurrence per active monthly debit order per calendar month in `months` — callers filter down to the exact cycle window. */
function buildDebitEntries(months, debitOrders, factor, accountsById = {}) {
  return months.flatMap((month) => debitOrders
    .filter((o) => o.status === 'active' && o.frequency === 'monthly')
    .map((o) => ({
      id: `debit-${o.id}-${month}`,
      kind: 'debit_order',
      date: `${month}-${pad2(clampDay(o.debitDay))}`,
      note: o.payee,
      category: o.category,
      accountName: accountsById[o.accountId]?.name || null,
      amount: o.amount * factor
    })));
}

/** One occurrence per loan/home-loan instalment per calendar month in `months` — these come off the Current account same as debit orders. */
function buildLoanPaymentEntries(months, accounts, factor) {
  return months.flatMap((month) => accounts
    .filter((a) => (a.type === 'loan' || a.type === 'home_loan') && a.instalment > 0 && a.paymentDay)
    .map((a) => ({
      id: `loanpay-${a.id}-${month}`,
      kind: 'loan_payment',
      loanType: a.type,
      date: `${month}-${pad2(clampDay(a.paymentDay))}`,
      note: a.name,
      category: null,
      amount: a.instalment * factor
    })));
}

/** One occurrence per active monthly income stream per calendar month in `months`, landing on the settings payday. */
function buildIncomeEntries(months, incomeStreams, paydayDay, factor) {
  return months.flatMap((month) => incomeStreams
    .filter((s) => s.status === 'active' && s.frequency === 'monthly')
    .map((s) => ({
      id: `income-${s.id}-${month}`,
      kind: 'income',
      date: `${month}-${pad2(clampDay(paydayDay))}`,
      note: s.name,
      category: null,
      amount: s.amount * factor
    })));
}

/** Merges logged transactions with this cycle's debit-order/salary occurrences into one dated feed, trimmed to [cycleStart, cycleEnd]. */
function buildCycleFeed(cycleStart, cycleEnd, months, transactions, debitOrders, incomeStreams, paydayDay, factor, accountsById, accounts, todayIso) {
  const remainingFraction = remainingCycleFraction(cycleStart, cycleEnd, todayIso);
  const debitEntries = buildDebitEntries(months, debitOrders, factor, accountsById);
  const loanEntries = buildLoanPaymentEntries(months, accounts, factor);
  const incomeEntries = buildIncomeEntries(months, incomeStreams, paydayDay, factor);
  const transactionEntries = transactions
    .filter((t) => t.kind !== 'opening_balance')
    .map((t) => {
      const kind = t.source === 'projected' ? 'projection' : 'expense';
      return { id: t.id, kind, date: t.date, note: t.note, category: t.category, amount: kind === 'projection' ? t.amount * remainingFraction : t.amount };
    });
  return sortFeed([...transactionEntries, ...debitEntries, ...loanEntries, ...incomeEntries]
    .filter((e) => e.date >= cycleStart && e.date <= cycleEnd));
}

/** Synthesizes a future cycle's feed from category projections + inflated debit orders/loans/salary, since no real transactions exist yet. */
function buildProjectedCycleFeed(cycleStart, cycleEnd, months, categories, debitOrders, incomeStreams, paydayDay, factor, accountsById, accounts, todayIso) {
  const remainingFraction = remainingCycleFraction(cycleStart, cycleEnd, todayIso);
  const categoryEntries = categories
    .filter((c) => c.monthlyBudget > 0)
    .map((c) => ({ id: `proj-${c.id}`, kind: 'projection', date: cycleStart, note: c.name, category: c.name, amount: c.monthlyBudget * factor * remainingFraction }));
  const debitEntries = buildDebitEntries(months, debitOrders, factor, accountsById);
  const loanEntries = buildLoanPaymentEntries(months, accounts, factor);
  const incomeEntries = buildIncomeEntries(months, incomeStreams, paydayDay, factor);
  return sortFeed([...categoryEntries, ...debitEntries, ...loanEntries, ...incomeEntries]
    .filter((e) => e.date >= cycleStart && e.date <= cycleEnd));
}

// ---- ledger reconciliation ---------------------------------------------------
// Opening-balance rows are still stored per calendar month (at the 1st), so
// they rarely land exactly on a cycle's payday boundary. balanceAt() bridges
// that gap by walking the known dated flows between whichever anchor is
// closest and the date we actually want.

function signedFlow(entry) {
  return entry.kind === 'income' ? entry.amount : -entry.amount;
}

/** Approximates the ledger balance at `targetIso` from the nearest opening-balance anchor we have on hand, plus/minus the dated flows in between. Null if no anchor was found in the fetched range. */
function balanceAt(targetIso, anchors, flowEntries) {
  if (!anchors.length) return null;
  const before = anchors.filter((a) => a.date <= targetIso).sort((a, b) => b.date.localeCompare(a.date))[0];
  const after = anchors.filter((a) => a.date > targetIso).sort((a, b) => a.date.localeCompare(b.date))[0];
  const anchor = before || after;
  if (!anchor) return null;
  if (anchor.date === targetIso) return anchor.amount;
  if (anchor.date < targetIso) {
    const delta = flowEntries.filter((e) => e.date >= anchor.date && e.date < targetIso).reduce((sum, e) => sum + signedFlow(e), 0);
    return anchor.amount + delta;
  }
  const delta = flowEntries.filter((e) => e.date >= targetIso && e.date < anchor.date).reduce((sum, e) => sum + signedFlow(e), 0);
  return anchor.amount - delta;
}

const DEBIT_SOURCE_TYPES = new Set(['cash', 'credit_card']);

function openDebitOrderModal(categories, accounts, existing, onDone) {
  const accountOptions = accounts
    .filter((a) => DEBIT_SOURCE_TYPES.has(a.type))
    .map((a) => ({ value: a.id, label: a.type === 'credit_card' ? `${a.name} (credit card)` : a.name }));
  openModal({
    title: existing ? `Edit ${existing.payee}` : 'Add debit order',
    submitLabel: existing ? 'Save changes' : 'Add debit order',
    fields: [
      { name: 'payee', label: 'Payee', type: 'text', value: existing?.payee, required: true },
      { name: 'amount', label: 'Amount (R)', type: 'number', value: existing?.amount, required: true },
      { name: 'frequency', label: 'Frequency', type: 'select', options: FREQUENCY_OPTIONS, value: existing?.frequency || 'monthly' },
      { name: 'debitDay', label: 'Debit day (1–28)', type: 'number', value: existing?.debitDay || 1 },
      { name: 'category', label: 'Category', type: 'select', options: categories.map((c) => ({ value: c.name, label: c.name })), value: existing?.category },
      { name: 'accountId', label: 'Paid from', type: 'select', options: accountOptions, value: existing?.accountId }
    ],
    onDelete: existing ? async () => {
      await api.debitOrders.remove(existing.id);
      showToast('Debit order removed');
      await onDone();
    } : undefined,
    onSubmit: async (values) => {
      if (existing) {
        await api.debitOrders.update(existing.id, { ...values, status: existing.status });
        showToast('Debit order updated');
      } else {
        await api.debitOrders.create({ ...values, status: 'active' });
        showToast('Debit order added');
      }
      await onDone();
    }
  });
}

function openCategoryModal(existing, onDone) {
  openModal({
    title: existing ? `Edit ${existing.name}` : 'Add category projection',
    submitLabel: existing ? 'Save changes' : 'Add category',
    fields: [
      { name: 'name', label: 'Category', type: 'text', value: existing?.name, required: true },
      { name: 'group', label: 'Group', type: 'text', value: existing?.group || 'General' },
      { name: 'monthlyBudget', label: 'Projected monthly amount (R)', type: 'number', value: existing?.monthlyBudget ?? 0, required: true }
    ],
    onDelete: existing ? async () => {
      await api.categories.remove(existing.id);
      showToast('Category removed');
      await onDone();
    } : undefined,
    onSubmit: async (values) => {
      if (existing) {
        await api.categories.update(existing.id, values);
        showToast('Projection updated');
      } else {
        await api.categories.create(values);
        showToast('Category added');
      }
      await onDone();
    }
  });
}

function renderProjectionsTab(root, { categories, onEdit, onAdd, inflationRate }) {
  const total = categories.reduce((sum, c) => sum + (c.monthlyBudget || 0), 0);

  root.innerHTML = `
    <p class="muted fs-12-5 mt-neg-4 mb-12">Set an expected monthly amount per category — these drive the projected costs shown for future cycles, growing with ${((inflationRate || 0) * 100).toFixed(1)}% annual inflation.</p>
    <div class="row mb-8">
      <span></span>
      <button class="pill pill--sm" id="add-category">+ Add</button>
    </div>
    <div class="card card--list mb-16">
      ${categories.length ? categories.map((c) => `
        <button data-category="${c.id}" class="unstyled-row-btn">
          <div class="list-item list-row">
            <div class="list-item__body">
              <div class="list-item__title">${c.name}</div>
              <div class="list-item__sub">${c.group || 'General'}</div>
            </div>
            <div class="list-item__amt tabular">${formatCurrency(c.monthlyBudget || 0)}</div>
          </div>
        </button>
      `).join('') : '<p class="muted empty-hint">No categories yet.</p>'}
    </div>
    <div class="dark-summary">
      <span class="dark-summary__label">Total projected monthly costs</span>
      <span class="dark-summary__value tabular">${formatCurrency(total)}</span>
    </div>
  `;

  root.querySelectorAll('[data-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const category = categories.find((c) => c.id === btn.dataset.category);
      onEdit(category);
    });
  });
  root.querySelector('#add-category').addEventListener('click', () => onAdd());
}

function renderOrdersTab(root, { debitOrders, categories, accountsById, onEdit, onAdd }) {
  const monthlyTotal = debitOrders
    .filter((o) => o.status === 'active')
    .reduce((sum, o) => sum + o.amount / (FREQUENCY_MONTHS[o.frequency] || 1), 0);

  root.innerHTML = `
    <div class="row mb-8">
      <span></span>
      <button class="pill pill--sm" id="add-order">+ Add</button>
    </div>
    <div class="card card--list mb-16">
      ${debitOrders.length ? debitOrders.map((o) => `
        <button data-order="${o.id}" class="unstyled-row-btn">
          <div class="list-item list-row">
            <div class="list-item__body">
              <div class="list-item__title ${o.status !== 'active' ? 'text-faint' : ''}">${o.payee}</div>
              <div class="list-item__sub">${o.frequency[0].toUpperCase()}${o.frequency.slice(1)} · ${o.debitDay}${ordinalSuffix(o.debitDay)}${accountsById[o.accountId] ? ` · ${accountsById[o.accountId].name}` : ''}${o.status !== 'active' ? ` · ${o.status}` : ''}</div>
            </div>
            <div class="list-item__amt tabular">${formatCurrency(o.amount)}</div>
          </div>
        </button>
      `).join('') : '<p class="muted empty-hint">No debit orders yet.</p>'}
    </div>
    <div class="dark-summary">
      <span class="dark-summary__label">Total monthly commitments</span>
      <span class="dark-summary__value tabular">${formatCurrency(monthlyTotal)}</span>
    </div>
  `;

  root.querySelectorAll('[data-order]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const order = debitOrders.find((o) => o.id === btn.dataset.order);
      onEdit(order);
    });
  });
  root.querySelector('#add-order').addEventListener('click', () => onAdd());
}

/** Simple side-by-side bar comparison so overspending a cycle is obvious at a glance. */
function inflowOutflowCard(inflows, outflows) {
  const max = Math.max(inflows, outflows, 1);
  const diff = inflows - outflows;
  const overspending = diff < 0;
  return `
    <div class="card mb-16">
      <div class="fs-12 muted mb-10">Inflows vs outflows this cycle</div>
      <div class="mb-10">
        <div class="row mb-4">
          <span class="fs-12 muted">Inflows</span>
          <span class="fs-13 fw-bold text-brand tabular">${formatCurrency(inflows)}</span>
        </div>
        <div class="bar-track bar-track--lg"><div class="bar-fill bg-brand" style="width:${(inflows / max) * 100}%;"></div></div>
      </div>
      <div>
        <div class="row mb-4">
          <span class="fs-12 muted">Outflows</span>
          <span class="fs-13 fw-bold text-orange tabular">${formatCurrency(outflows)}</span>
        </div>
        <div class="bar-track bar-track--lg"><div class="bar-fill bg-orange" style="width:${(outflows / max) * 100}%;"></div></div>
      </div>
      <div class="mt-12 fs-12-5 fw-semibold ${overspending ? 'text-orange' : 'text-brand'}">
        ${overspending ? `Spending ${formatCurrency(Math.abs(diff))} more than you're earning this cycle` : `${formatCurrency(diff)} left over this cycle`}
      </div>
    </div>
  `;
}

function ordinalSuffix(day) {
  if (day % 10 === 1 && day !== 11) return 'st';
  if (day % 10 === 2 && day !== 12) return 'nd';
  if (day % 10 === 3 && day !== 13) return 'rd';
  return 'th';
}

function renderSpendingTab(root, {
  cycleStart, cycleEnd, months, transactions, debitOrders, categories, incomeStreams, paydayDay,
  isFuture, isCurrentCycle, cyclesAhead, factor, inflationRate, openingBalance, closingBalance, accountsById, accounts, todayIso,
  income, outflows, currentBalance,
  showForm, onToggleForm, onSubmitExpense, onDelete, onPrevCycle, onNextCycle, onSetOpeningBalance, onSetCurrentBalance
}) {
  const hasStoredData = transactions.some((t) => t.kind !== 'opening_balance' && t.date >= cycleStart && t.date <= cycleEnd);
  const feed = (!hasStoredData && isFuture)
    ? buildProjectedCycleFeed(cycleStart, cycleEnd, months, categories, debitOrders, incomeStreams, paydayDay, factor, accountsById, accounts, todayIso)
    : buildCycleFeed(cycleStart, cycleEnd, months, transactions, debitOrders, incomeStreams, paydayDay, factor, accountsById, accounts, todayIso);

  const byCategory = {};
  feed.filter((e) => e.category).forEach((e) => { byCategory[e.category] = (byCategory[e.category] || 0) + e.amount; });
  const segments = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] }));
  const donut = donutChart(segments);
  const donutCaption = isFuture ? 'projected' : (isCurrentCycle ? 'this cycle' : 'past cycle');

  root.innerHTML = `
    <div class="row mb-12">
      <button type="button" class="icon-btn" id="prev-cycle" aria-label="Previous cycle">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <span class="fs-14 fw-bold">${cycleLabel(cycleStart, cycleEnd)}</span>
      <button type="button" class="icon-btn" id="next-cycle" aria-label="Next cycle">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>

    ${isFuture ? `<p class="muted fs-12-5 mt-neg-6 mb-12">Projected from your category projections and debit orders, growing at ${((inflationRate || 0) * 100).toFixed(1)}% p.a. (${cyclesAhead} cycle${cyclesAhead === 1 ? '' : 's'} away).</p>` : ''}

    <div class="card mb-16">
      <button type="button" id="edit-opening-balance" class="row unstyled-row-btn mb-8">
        <span class="muted fs-12">Incoming balance</span>
        <span class="fs-13 fw-bold tabular ${openingBalance != null ? amountClass(openingBalance) : ''}">${openingBalance != null ? formatCurrency(openingBalance) : 'Tap to set'}</span>
      </button>
      ${currentBalance != null ? `
        <button type="button" id="edit-current-balance" class="row unstyled-row-btn ${closingBalance != null ? 'mb-8' : ''}">
          <span class="muted fs-12">Current balance</span>
          <span class="fs-13 fw-bold tabular ${amountClass(currentBalance)}">${formatCurrency(currentBalance)}</span>
        </button>
      ` : ''}
      ${closingBalance != null ? `
        <div class="row">
          <span class="muted fs-12">${isFuture ? 'Projected closing balance' : 'Closing balance'}</span>
          <span class="fs-13 fw-bold tabular ${amountClass(closingBalance)}">${formatCurrency(closingBalance)}</span>
        </div>
      ` : ''}
    </div>

    ${inflowOutflowCard(income, outflows)}

    <div class="card donut-wrap">
      <div class="donut" style="background:${donut.gradient};">
        <div class="donut__hole"><b class="tabular">${formatCurrency(donut.total)}</b><span>${donutCaption}</span></div>
      </div>
      <div class="donut-legend">
        ${donut.segments.slice(0, 5).map((s) => `
          <div class="donut-legend__row"><div style="width:8px;height:8px;border-radius:2px;background:${s.color};"></div><div>${s.label}</div><div>${s.pct}%</div></div>
        `).join('') || '<p class="muted fs-12">No spending logged yet.</p>'}
      </div>
    </div>

    ${showForm ? `
      <div class="inline-form">
        <div class="inline-form__title">Log an expense</div>
        <form id="add-expense-form">
          <div class="field mb-8"><input name="note" placeholder="Description (e.g. Petrol)" required /></div>
          <div class="field mb-8"><input name="amount" type="text" inputmode="decimal" placeholder="Amount (R)" required /></div>
          <div class="field mb-12"><label for="expense-date" class="fs-12 muted">Date</label><input id="expense-date" name="date" type="date" value="${getTodayIso()}" required /></div>
          <div class="row gap-10">
            <button type="button" class="btn btn--ghost" id="cancel-expense">Cancel</button>
            <button type="submit" class="btn btn--primary">Add</button>
          </div>
        </form>
      </div>
    ` : ''}

    <div class="card card--list mb-16">
      ${feed.length ? feed.map((entry) => {
        const idx = segments.findIndex((s) => s.label === entry.category);
        const isDebitOrder = entry.kind === 'debit_order';
        const isLoanPayment = entry.kind === 'loan_payment';
        const isProjection = entry.kind === 'projection';
        const isIncome = entry.kind === 'income';
        const isLocked = isDebitOrder || isIncome || isLoanPayment;
        const color = isLocked ? 'var(--text-faint)' : CATEGORY_PALETTE[idx >= 0 ? idx % CATEGORY_PALETTE.length : 0];
        const tag = isDebitOrder ? ` · Debit order${entry.accountName ? ` · ${entry.accountName}` : ''}`
          : (isIncome ? ' · Salary'
          : (isLoanPayment ? ` · ${entry.loanType === 'home_loan' ? 'Home loan' : 'Loan'} payment`
          : (isProjection ? ' · Projected' : '')));
        const inner = `
          <div class="list-item w-100">
            <div style="width:8px;height:8px;border-radius:2px;background:${color};flex:0 0 auto;"></div>
            <div class="list-item__body">
              <div class="list-item__title ${isLocked ? 'text-faint fw-medium' : ''}">${entry.note || entry.category}${tag ? `<span class="fs-10-5 text-faint">${tag}</span>` : ''}</div>
              <div class="list-item__sub">${formatShortDate(entry.date)}</div>
            </div>
            <div class="list-item__amt tabular ${isLocked ? 'text-faint' : ''}">${formatCurrency(entry.amount)}</div>
          </div>
        `;
        return (isDebitOrder || isProjection || isIncome || isLoanPayment)
          ? `<div class="w-100">${inner}</div>`
          : `<button data-expense="${entry.id}" class="unstyled-row-btn">${inner}</button>`;
      }).join('') : `<p class="muted empty-hint">${(!hasStoredData && isFuture) ? 'No category projections set yet — add some in the Projections tab.' : 'Nothing logged for this cycle yet.'}</p>`}
    </div>
    ${isFuture ? '' : '<button class="btn btn--primary btn--cta" id="open-add-expense">+ Log an Expense</button>'}
  `;

  root.querySelector('#prev-cycle').addEventListener('click', onPrevCycle);
  root.querySelector('#next-cycle').addEventListener('click', onNextCycle);
  root.querySelector('#edit-opening-balance').addEventListener('click', () => {
    openModal({
      title: 'Set incoming balance',
      submitLabel: 'Save',
      fields: [
        { name: 'amount', label: 'Incoming balance (R)', type: 'number', value: openingBalance ?? undefined, required: true }
      ],
      onSubmit: async (values) => {
        await onSetOpeningBalance(values.amount);
      }
    });
  });
  root.querySelector('#edit-current-balance')?.addEventListener('click', () => {
    openModal({
      title: 'Update current balance',
      submitLabel: 'Save',
      fields: [
        { name: 'balance', label: 'Current balance (R)', type: 'number', value: currentBalance, required: true }
      ],
      onSubmit: async (values) => {
        await onSetCurrentBalance(values.balance);
      }
    });
  });
  root.querySelector('#open-add-expense')?.addEventListener('click', () => onToggleForm(true));
  root.querySelector('#cancel-expense')?.addEventListener('click', () => onToggleForm(false));
  root.querySelector('#add-expense-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    onSubmitExpense({ note: form.elements.note.value, amount: parseDecimal(form.elements.amount.value), date: form.elements.date.value });
  });
  root.querySelectorAll('[data-expense]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const transaction = transactions.find((t) => t.id === btn.dataset.expense);
      if (!confirm(`Delete "${transaction.note || transaction.category}"? This cannot be undone.`)) return;
      onDelete(btn.dataset.expense);
    });
  });
}

export async function renderCashflow(root) {
  const [debitOrders, categories, incomeStreams, settings, accounts] = await Promise.all([
    api.debitOrders.list(),
    api.categories.list(),
    api.incomeStreams.list(),
    api.settings.get(),
    api.accounts.list()
  ]);
  const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const currentAccount = accounts.find((a) => a.type === 'cash' && a.vehicleType !== 'savings');
  const currentAccountId = currentAccount?.id;

  const paydayDay = settings.paydayDay || 25;
  const todayIso = getTodayIso();
  const currentCycleStart = cycleStartContaining(todayIso, paydayDay);
  let cycleStart = currentCycleStart;

  const transactions = [];

  let subTab = 'spending';
  let showAddExpense = false;

  async function reloadTransactions() {
    const cycleEnd = cycleEndFor(cycleStart, paydayDay);
    const months = monthsInRange(cycleStart, cycleEnd);
    const lists = await Promise.all(months.map((m) => api.transactions.list(currentAccountId, m)));
    transactions.length = 0;
    transactions.push(...lists.flat());
  }
  await reloadTransactions();

  async function reloadDebitOrders() {
    const fresh = await api.debitOrders.list();
    debitOrders.length = 0;
    debitOrders.push(...fresh);
  }

  async function reloadCategories() {
    const fresh = await api.categories.list();
    categories.length = 0;
    categories.push(...fresh);
  }

  async function changeCycle(delta) {
    cycleStart = shiftCycle(cycleStart, delta);
    await reloadTransactions();
    draw();
  }

  function draw() {
    const cycleEnd = cycleEndFor(cycleStart, paydayDay);
    const months = monthsInRange(cycleStart, cycleEnd);
    const cyclesAhead = monthsBetween(currentCycleStart.slice(0, 7), cycleStart.slice(0, 7));
    const isFuture = cyclesAhead > 0;
    const isCurrentCycle = cycleStart === currentCycleStart;
    const factor = inflationFactorFor(cycleStart.slice(0, 7), currentCycleStart.slice(0, 7), settings.inflationRate);

    const inRangeTransactions = transactions.filter((t) => t.kind !== 'opening_balance' && t.date >= cycleStart && t.date <= cycleEnd);
    const hasStoredData = inRangeTransactions.length > 0;
    const monthlyDebitOrderTotal = debitOrders
      .filter((o) => o.status === 'active')
      .reduce((sum, o) => sum + (o.amount / (FREQUENCY_MONTHS[o.frequency] || 1)) * factor, 0)
      + accounts
        .filter((a) => (a.type === 'loan' || a.type === 'home_loan') && a.instalment > 0 && a.paymentDay)
        .reduce((sum, a) => sum + a.instalment * factor, 0);
    const spentTotal = hasStoredData
      ? inRangeTransactions.reduce((sum, t) => sum + t.amount, 0)
      : (isFuture ? categories.reduce((sum, c) => sum + (c.monthlyBudget || 0), 0) * factor : 0);
    const income = incomeStreams
      .filter((s) => s.status === 'active')
      .reduce((sum, s) => sum + (s.amount || 0) / (FREQUENCY_MONTHS[s.frequency] || 1), 0);
    const left = Math.max(0, income - monthlyDebitOrderTotal - spentTotal);
    const debitPct = income ? (monthlyDebitOrderTotal / income) * 100 : 0;
    const spentPct = income ? (spentTotal / income) * 100 : 0;
    const leftPct = Math.max(0, 100 - debitPct - spentPct);
    const spentLabel = isFuture ? 'Projected' : 'Spent';

    // Ledger reconciliation: opening-balance rows live at the 1st of a calendar month, which
    // rarely lines up with a payday boundary, so bridge the gap using the dated flows we have
    // on hand for the calendar months this cycle touches.
    const anchors = transactions.filter((t) => t.kind === 'opening_balance').map((t) => ({ date: t.date, amount: t.amount }));
    const flowEntries = [
      ...transactions.filter((t) => t.kind !== 'opening_balance').map((t) => ({ date: t.date, kind: t.source === 'projected' ? 'projection' : 'expense', amount: t.amount })),
      ...buildDebitEntries(months, debitOrders, factor, accountsById),
      ...buildLoanPaymentEntries(months, accounts, factor),
      ...buildIncomeEntries(months, incomeStreams, paydayDay, factor)
    ];
    const openingBalance = balanceAt(cycleStart, anchors, flowEntries);
    // For the cycle in progress, ground the forecast in today's actual account balance rather
    // than walking forward from a possibly-stale monthly snapshot: only flows still ahead of
    // today can move that real number, and any still-placeholder category projection is scaled
    // down to whatever share of the cycle is actually still left to run.
    const closingBalance = (isCurrentCycle && currentAccount)
      ? currentAccount.balance + flowEntries
        .filter((e) => e.date > todayIso && e.date <= cycleEnd)
        .reduce((sum, e) => sum + signedFlow(e.kind === 'projection' ? { ...e, amount: e.amount * remainingCycleFraction(cycleStart, cycleEnd, todayIso) } : e), 0)
      : balanceAt(shiftCycle(cycleStart, 1), anchors, flowEntries);

    root.innerHTML = `
      <h2 class="view-heading">Cash Flow</h2>

      <div class="card">
        <div class="row row--baseline mb-10">
          <span class="muted fs-12">${isFuture ? 'Projected income' : 'Income'}</span>
          <span class="fs-15 fw-bold tabular">${formatCurrency(income)}</span>
        </div>
        <div class="bar-split">
          <div style="width:${debitPct}%;background:var(--brand);"></div>
          <div style="width:${spentPct}%;background:var(--orange-light);"></div>
          <div style="width:${leftPct}%;background:var(--card-border);"></div>
        </div>
        <div class="legend">
          <span><i class="bg-brand"></i>Debit orders &amp; loans ${formatCurrency(monthlyDebitOrderTotal)}</span>
          <span><i class="bg-orange-light"></i>${spentLabel} ${formatCurrency(spentTotal)}</span>
          <span><i class="bg-card-border"></i>Left ${formatCurrency(left)}</span>
        </div>
      </div>

      <div class="segmented">
        <button class="segmented__item ${subTab === 'spending' ? 'active' : ''}" data-sub="spending">Spending</button>
        <button class="segmented__item ${subTab === 'orders' ? 'active' : ''}" data-sub="orders">Debit Orders</button>
        <button class="segmented__item ${subTab === 'projections' ? 'active' : ''}" data-sub="projections">Projections</button>
      </div>
      <div id="cashflow-sub"></div>
    `;

    root.querySelectorAll('[data-sub]').forEach((btn) => {
      btn.addEventListener('click', () => { subTab = btn.dataset.sub; draw(); });
    });

    const subRoot = root.querySelector('#cashflow-sub');
    if (subTab === 'orders') {
      renderOrdersTab(subRoot, {
        debitOrders,
        categories,
        accountsById,
        onEdit: (order) => openDebitOrderModal(categories, accounts, order, async () => { await reloadDebitOrders(); draw(); }),
        onAdd: () => openDebitOrderModal(categories, accounts, null, async () => { await reloadDebitOrders(); draw(); })
      });
    } else if (subTab === 'projections') {
      renderProjectionsTab(subRoot, {
        categories,
        inflationRate: settings.inflationRate,
        onEdit: (category) => openCategoryModal(category, async () => { await reloadCategories(); draw(); }),
        onAdd: () => openCategoryModal(null, async () => { await reloadCategories(); draw(); })
      });
    } else {
      renderSpendingTab(subRoot, {
        cycleStart,
        cycleEnd,
        months,
        transactions,
        debitOrders,
        categories,
        incomeStreams,
        paydayDay,
        isFuture,
        isCurrentCycle,
        cyclesAhead,
        factor,
        inflationRate: settings.inflationRate,
        openingBalance,
        closingBalance,
        currentBalance: currentAccount?.balance,
        accountsById,
        accounts,
        todayIso,
        income,
        outflows: monthlyDebitOrderTotal + spentTotal,
        showForm: showAddExpense,
        onToggleForm: (show) => { showAddExpense = show; draw(); },
        onSubmitExpense: async ({ note, amount, date }) => {
          await api.transactions.create({ note, amount, date, category: 'Other', accountId: currentAccountId });
          showToast('Expense logged');
          showAddExpense = false;
          await reloadTransactions();
          draw();
        },
        onDelete: async (id) => {
          await api.transactions.remove(id, currentAccountId);
          showToast('Expense removed');
          await reloadTransactions();
          draw();
        },
        onPrevCycle: () => changeCycle(-1),
        onNextCycle: () => changeCycle(1),
        onSetOpeningBalance: async (amount) => {
          await api.transactions.setOpeningBalance(currentAccountId, cycleStart.slice(0, 7), amount);
          showToast('Incoming balance updated');
          await reloadTransactions();
          draw();
        },
        onSetCurrentBalance: async (newBalance) => {
          const diff = currentAccount.balance - newBalance;
          if (diff !== 0) {
            await api.transactions.create({
              accountId: currentAccountId,
              date: todayIso,
              category: 'Adjustment',
              note: 'Balance adjustment',
              amount: diff
            });
          }
          await api.accounts.update(currentAccountId, { balance: newBalance });
          currentAccount.balance = newBalance;
          showToast('Current balance updated');
          await reloadTransactions();
          draw();
        }
      });
    }
  }

  draw();
}
