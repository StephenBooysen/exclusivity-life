import { api } from '../api.js';
import { formatCurrency, formatPercent, formatShortDate, parseDecimal, amountClass } from '../format.js';
import { openModal } from '../components/modal.js';
import { showToast } from '../toast.js';
import { getTodayDate, getTodayIso } from '../cycle.js';

const INCOME_FREQUENCY_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };
const INCOME_FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' }
];
const INCOME_TYPE_OPTIONS = [
  { value: 'salary', label: 'Salary' },
  { value: 'rental', label: 'Rental' },
  { value: 'side_income', label: 'Side income' },
  { value: 'other', label: 'Other' }
];

function incomeMonthlyEquivalent(stream) {
  return (stream.amount || 0) / (INCOME_FREQUENCY_MONTHS[stream.frequency] || 1);
}

function openIncomeStreamModal(existing, onDone) {
  openModal({
    title: existing ? `Edit ${existing.name}` : 'Add income stream',
    submitLabel: existing ? 'Save changes' : 'Add income stream',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: existing?.name, required: true },
      { name: 'source', label: 'Source (e.g. employer)', type: 'text', value: existing?.source },
      { name: 'type', label: 'Type', type: 'select', options: INCOME_TYPE_OPTIONS, value: existing?.type || 'salary' },
      { name: 'amount', label: 'Amount (R)', type: 'number', value: existing?.amount, required: true },
      { name: 'frequency', label: 'Frequency', type: 'select', options: INCOME_FREQUENCY_OPTIONS, value: existing?.frequency || 'monthly' }
    ],
    onDelete: existing ? async () => {
      await api.incomeStreams.remove(existing.id);
      showToast('Income stream removed');
      await onDone();
    } : undefined,
    onSubmit: async (values) => {
      if (existing) {
        await api.incomeStreams.update(existing.id, { ...values, status: existing.status });
        showToast('Income stream updated');
      } else {
        await api.incomeStreams.create({ ...values, status: 'active' });
        showToast('Income stream added');
      }
      await onDone();
    }
  });
}

function incomeStreamRow(stream) {
  return `
    <button data-income="${stream.id}" class="unstyled-row-btn">
      <div class="list-item list-row">
        <div class="list-item__body">
          <div class="list-item__title ${stream.status !== 'active' ? 'text-faint' : ''}">${stream.name}</div>
          <div class="list-item__sub">${stream.source || ''}${stream.source ? ' · ' : ''}${stream.frequency[0].toUpperCase()}${stream.frequency.slice(1)}${stream.status !== 'active' ? ` · ${stream.status}` : ''}</div>
        </div>
        <div class="list-item__amt tabular">${formatCurrency(stream.amount)}</div>
      </div>
    </button>
  `;
}

const TRANSFER_DEST_TYPES = new Set(['cash', 'credit_card', 'loan', 'home_loan']);

/** Always launched from a specific account's own "Transfer" button, so the source is fixed — only the destination is picked. */
function openTransferModal(fromAccount, accounts, onDone) {
  const destAccounts = accounts.filter((a) => a.id !== fromAccount.id && TRANSFER_DEST_TYPES.has(a.type));
  openModal({
    title: `Transfer from ${fromAccount.name}`,
    submitLabel: 'Transfer',
    fields: [
      { name: 'toAccountId', label: 'To', type: 'select', options: destAccounts.map((a) => ({ value: a.id, label: a.type === 'cash' ? a.name : `${a.name} (${balanceLabelFor(a.type)})` })) },
      { name: 'amount', label: 'Amount (R)', type: 'number', required: true },
      { name: 'date', label: 'Date', type: 'date', value: getTodayIso() },
      { name: 'note', label: 'Note (optional)', type: 'text' }
    ],
    onSubmit: async (values) => {
      await api.transfers.create({ ...values, fromAccountId: fromAccount.id });
      showToast('Transfer complete');
      await onDone();
    }
  });
}

function transferNote(entry, accountsById) {
  if (entry.note) return entry.note;
  const counter = accountsById[entry.counterAccountId];
  return entry.direction === 'out' ? `Transfer to ${counter?.name || 'account'}` : `Transfer from ${counter?.name || 'account'}`;
}

function activityRow(entry, accountsById) {
  const isTransfer = entry.kind === 'transfer';
  const isOpening = entry.kind === 'opening_balance';
  const title = isTransfer ? transferNote(entry, accountsById) : (entry.note || entry.category || 'Transaction');
  const tag = isTransfer ? ' · Transfer' : (isOpening ? ' · Opening balance' : '');
  return `
    <div class="list-item py-10">
      <div class="list-item__body">
        <div class="list-item__title fs-13">${title}</div>
        <div class="list-item__sub">${formatShortDate(entry.date)}${tag}</div>
      </div>
      <div class="list-item__amt tabular fs-13">${formatCurrency(entry.amount)}</div>
    </div>
  `;
}

function recentActivitySection(activity, accountsById) {
  if (activity == null) {
    return `<p class="muted inline-hint">Loading activity…</p>`;
  }
  return `
    <div class="section-label section-label--sub">RECENT ACTIVITY</div>
    ${activity.length
      ? `<div>${activity.slice(0, 15).map((e) => activityRow(e, accountsById)).join('')}</div>`
      : '<p class="muted inline-hint">No activity yet.</p>'}
  `;
}

const SECTION_TINTS = {
  credit_card: { bg: 'var(--orange-tint-bg)', fg: 'var(--orange)' },
  loan: { bg: 'var(--brand-tint-bg)', fg: 'var(--brand)' },
  home_loan: { bg: 'var(--brand-tint-bg)', fg: 'var(--brand)' },
  current: { bg: 'var(--brand-tint-bg)', fg: 'var(--brand)' },
  savings: { bg: 'var(--brand-tint-bg)', fg: 'var(--sage)' }
};

/** Cash accounts predate the current/savings split, so a missing vehicleType means 'current'. */
function isCurrentAccount(account) {
  return account.type === 'cash' && account.vehicleType !== 'savings';
}

const DEBT_TYPES = new Set(['credit_card', 'loan', 'home_loan']);
function growthFieldFor(type) {
  return DEBT_TYPES.has(type) ? 'rate' : 'growthRateAssumed';
}

function monogram(text) {
  return (text || '??').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '??';
}

/** Standard amortization remaining-balance formula — mirrors backend/services/projectionEngine.js. */
function monthsToPayoff(principal, annualRate, monthlyPayment) {
  if (principal <= 0) return 0;
  if (monthlyPayment <= 0) return Infinity;
  const r = annualRate / 12;
  if (r === 0) return Math.ceil(principal / monthlyPayment);
  if (monthlyPayment <= principal * r) return Infinity;
  return Math.ceil(Math.log(monthlyPayment / (monthlyPayment - principal * r)) / Math.log(1 + r));
}

function payoffDateLabel(account, currentAge, extra = 0) {
  const months = monthsToPayoff(account.balance || 0, account.rate || 0, (account.instalment || 0) + extra);
  if (!Number.isFinite(months)) return null;
  const date = getTodayDate();
  date.setMonth(date.getMonth() + months);
  const age = Math.round((currentAge + months / 12) * 10) / 10;
  return { months, date, age, label: `${date.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })} · age ${age}` };
}

function extraPaymentCallout(account, currentAge) {
  const base = payoffDateLabel(account, currentAge);
  const withExtra = payoffDateLabel(account, currentAge, 2000);
  if (!base || !withExtra) return '';
  const totalCurrent = (account.instalment || 0) * base.months;
  const totalExtra = ((account.instalment || 0) + 2000) * withExtra.months;
  const saved = Math.max(0, totalCurrent - totalExtra);
  return `<div class="callout">+ R2,000/mo extra → settle ${withExtra.label.split(' · ')[0]}, save ~${formatCurrency(saved)} interest</div>`;
}

/** Standard amortization walk: each month's interest is charged on the current balance, the rest of the instalment goes to principal. Stops early if the loan pays off before `months` is reached. */
function amortizationSchedule(account, months = 12) {
  const rows = [];
  let balance = account.balance || 0;
  const monthlyRate = (account.rate || 0) / 12;
  const payment = account.instalment || 0;
  const date = getTodayDate();
  for (let i = 0; i < months && balance > 0; i++) {
    date.setMonth(date.getMonth() + 1);
    const interest = balance * monthlyRate;
    const principal = Math.min(payment - interest, balance);
    balance = Math.max(0, balance - principal);
    rows.push({
      label: date.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }),
      interest,
      principal,
      balance
    });
  }
  return rows;
}

function amortizationRow(row) {
  return `
    <div class="list-item py-10">
      <div class="list-item__body">
        <div class="list-item__title fs-13">${row.label}</div>
        <div class="list-item__sub">Interest ${formatCurrency(row.interest)} · Principal ${formatCurrency(row.principal)}</div>
      </div>
      <div class="list-item__amt tabular fs-13">${formatCurrency(row.balance)}</div>
    </div>
  `;
}

function amortizationSection(account) {
  if (!(account.instalment > 0)) {
    return `
      <div class="section-label section-label--sub">AMORTIZATION</div>
      <p class="muted inline-hint">Set an installment to see the amortization schedule.</p>
    `;
  }
  const rows = amortizationSchedule(account, 12);
  return `
    <div class="section-label section-label--sub">AMORTIZATION (NEXT ${rows.length} MONTHS)</div>
    <div class="amortization-scroll">${rows.map(amortizationRow).join('')}</div>
  `;
}

function detailField(label, value) {
  return `<div><div class="detail-grid__label">${label}</div><div class="detail-grid__value tabular">${value}</div></div>`;
}

function detailsFor(account, currentAge) {
  switch (account.type) {
    case 'credit_card':
      return [
        detailField('Credit limit', formatCurrency(account.limit)),
        detailField('Interest rate', formatPercent(account.rate || 0)),
        detailField('Min. payment', formatCurrency(account.minPayment)),
        detailField('Statement day', account.statementDay ? `${account.statementDay}th monthly` : '—')
      ].join('');
    case 'loan':
      return [
        detailField('Original amount', formatCurrency(account.originalAmount || account.balance)),
        detailField('Interest rate', formatPercent(account.rate || 0)),
        detailField('Installment', `${formatCurrency(account.instalment)} / mo${account.paymentDay ? ` · ${account.paymentDay}${ordinalSuffix(account.paymentDay)}` : ''}`),
        detailField('Remaining term', account.termMonths ? `${account.termMonths} months` : '—')
      ].join('');
    case 'home_loan': {
      const payoff = payoffDateLabel(account, currentAge);
      return [
        detailField('Original amount', formatCurrency(account.originalAmount || account.balance)),
        detailField('Interest rate', formatPercent(account.rate || 0)),
        detailField('Installment', `${formatCurrency(account.instalment)} / mo${account.paymentDay ? ` · ${account.paymentDay}${ordinalSuffix(account.paymentDay)}` : ''}`),
        detailField('Payoff (current)', payoff ? payoff.label : '—')
      ].join('');
    }
    default: {
      const goalLabel = account.target
        ? 'Emergency fund'
        : isCurrentAccount(account) ? 'Everyday spending' : (account.vehicleType || 'General savings');
      return [
        detailField('Interest rate', formatPercent(account.growthRateAssumed || 0)),
        detailField('Linked goal', goalLabel),
        ...(account.overdraft > 0 ? [
          detailField('Overdraft limit', formatCurrency(account.overdraft)),
          detailField('Available to spend', formatCurrency((account.overdraft || 0) + (account.balance || 0)))
        ] : [])
      ].join('');
    }
  }
}

function subtitleFor(account) {
  if (account.type === 'credit_card') return account.last4 ? `•••• ${account.last4}` : (account.institution || '');
  if (account.type === 'home_loan') {
    const equityPct = account.propertyValue ? Math.round(((account.propertyValue - account.balance) / account.propertyValue) * 100) : 0;
    return `${account.institution || ''} · ${equityPct}% equity`;
  }
  if (account.type === 'loan') return account.institution || '';
  if (account.vehicleType === 'emergency_fund') return '32-Day Notice';
  return account.institution || (isCurrentAccount(account) ? 'Current account' : 'Savings');
}

function ordinalSuffix(day) {
  if (day % 10 === 1 && day !== 11) return 'st';
  if (day % 10 === 2 && day !== 12) return 'nd';
  if (day % 10 === 3 && day !== 13) return 'rd';
  return 'th';
}

const INSTALMENT_TYPES = new Set(['loan', 'home_loan']);

function balanceLabelFor(type) {
  if (type === 'credit_card') return 'owing';
  if (type === 'loan' || type === 'home_loan') return 'remaining';
  return 'balance';
}

/** Short "Settles <month> <year>" caption for the collapsed loan/home-loan row — null when there's not enough set up to compute one. */
function settleLabelFor(account, currentAge) {
  if (!INSTALMENT_TYPES.has(account.type) || !(account.instalment > 0)) return null;
  const payoff = payoffDateLabel(account, currentAge);
  return payoff ? `Settles ${payoff.label.split(' · ')[0]}` : 'Not on track to settle';
}

function accountRow(account, section, expandedIds, editingId, currentAge, activityCache, accountsById) {
  const tint = SECTION_TINTS[section];
  const expanded = expandedIds.has(account.id);
  const editing = editingId === account.id;
  const settleLabel = settleLabelFor(account, currentAge);

  return `
    <div class="card" data-account-card="${account.id}">
      <div class="accordion" data-toggle="${account.id}">
        <div class="accordion__head">
          <div class="monogram" style="background:${tint.bg};color:${tint.fg};">${monogram(account.institution || account.name)}</div>
          <div class="list-item__body">
            <div class="list-item__title fs-14">${account.name}</div>
            <div class="list-item__sub">${subtitleFor(account)}</div>
          </div>
          <div class="text-right">
            <div class="fs-15 fw-bold tabular ${amountClass(account.balance)}">${formatCurrency(account.balance)}</div>
            <div class="fs-11 muted">${balanceLabelFor(account.type)}</div>
            ${settleLabel ? `<div class="fs-11 muted">${settleLabel}</div>` : ''}
          </div>
        </div>
      </div>
      ${expanded ? `
        <div class="accordion__body">
          ${editing ? `
            <form data-edit-form="${account.id}">
              <div class="field-row mb-10">
                <div class="field mb-0">
                  <label>Balance</label>
                  <input name="balance" type="text" inputmode="decimal" value="${account.balance ?? ''}" />
                </div>
                <div class="field mb-0">
                  <label>${DEBT_TYPES.has(account.type) ? 'Interest rate %' : 'Growth rate %'}</label>
                  <input name="ratePct" type="text" inputmode="decimal" value="${account[growthFieldFor(account.type)] != null ? (account[growthFieldFor(account.type)] * 100).toFixed(2) : ''}" />
                </div>
              </div>
              ${(account.type === 'credit_card' || account.type === 'loan') ? `
                <div class="field mb-10">
                  <label>Credit limit (R)${account.type === 'loan' ? ' — only for revolving credit' : ''}</label>
                  <input name="limit" type="text" inputmode="decimal" value="${account.limit ?? ''}" />
                </div>
              ` : ''}
              ${INSTALMENT_TYPES.has(account.type) ? `
                <div class="field-row mb-10">
                  <div class="field mb-0">
                    <label>Installment (R/mo)</label>
                    <input name="instalment" type="text" inputmode="decimal" value="${account.instalment ?? ''}" />
                  </div>
                  <div class="field mb-0">
                    <label>Payment day (1–28)</label>
                    <input name="paymentDay" type="text" inputmode="numeric" value="${account.paymentDay ?? ''}" />
                  </div>
                </div>
              ` : ''}
              ${account.type === 'home_loan' ? `
                <div class="field-row mb-10">
                  <div class="field mb-0">
                    <label>Property value (R)</label>
                    <input name="propertyValue" type="text" inputmode="decimal" value="${account.propertyValue ?? ''}" />
                  </div>
                  <div class="field mb-0">
                    <label>Appreciation rate %</label>
                    <input name="appreciationRatePct" type="text" inputmode="decimal" value="${account.appreciationRate != null ? (account.appreciationRate * 100).toFixed(2) : ''}" />
                  </div>
                </div>
              ` : ''}
              ${account.type === 'cash' ? `
                <div class="field mb-10">
                  <label>Overdraft limit (R)</label>
                  <input name="overdraft" type="text" inputmode="decimal" value="${account.overdraft ?? ''}" />
                </div>
              ` : ''}
              <div class="field">
                <label class="checkbox-label">
                  <input name="showOnHome" type="checkbox" ${account.showOnHome ? 'checked' : ''} />
                  Show on Home
                </label>
              </div>
              <div class="modal-actions">
                <button type="button" class="btn btn--ghost btn--danger" data-delete="${account.id}">Delete account</button>
                <button type="submit" class="btn btn--primary">Save</button>
              </div>
            </form>
          ` : `
            <div class="detail-grid">${detailsFor(account, currentAge)}</div>
            ${account.type === 'home_loan' ? extraPaymentCallout(account, currentAge) : ''}
            ${(account.type === 'loan' || account.type === 'home_loan') ? amortizationSection(account) : ''}
            <button class="btn btn--outline" data-edit="${account.id}">Update balance &amp; rate</button>
            ${account.type === 'cash' ? `<button class="btn btn--outline mt-8" data-transfer="${account.id}">⇄ Transfer</button>` : ''}
            ${recentActivitySection(activityCache[account.id], accountsById)}
          `}
        </div>
      ` : ''}
    </div>
  `;
}

const ADD_TITLES = { home_loan: 'home loan', current: 'current account', savings: 'savings account' };
const CASH_KEYS = new Set(['current', 'savings']);

function openAddAccountModal(type, onDone) {
  const isDebt = !CASH_KEYS.has(type);
  const realType = CASH_KEYS.has(type) ? 'cash' : type;
  const vehicleType = CASH_KEYS.has(type) ? type : undefined;
  openModal({
    title: `Add ${ADD_TITLES[type] || type.replace('_', ' ')}`,
    submitLabel: 'Add account',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'institution', label: 'Institution', type: 'text' },
      { name: 'balance', label: isDebt ? 'Current balance (R)' : 'Current value (R)', type: 'number', required: true },
      ...(realType === 'credit_card' ? [
        { name: 'limit', label: 'Credit limit (R)', type: 'number' },
        { name: 'rate', label: 'APR (e.g. 0.215 = 21.5%)', type: 'number', step: '0.001' },
        { name: 'minPayment', label: 'Minimum payment (R)', type: 'number' }
      ] : []),
      ...(realType === 'loan' || realType === 'home_loan' ? [
        { name: 'rate', label: 'Interest rate (e.g. 0.11 = 11%)', type: 'number', step: '0.001' },
        { name: 'instalment', label: 'Monthly instalment (R)', type: 'number' },
        { name: 'paymentDay', label: 'Payment day (1–28)', type: 'number' },
        ...(realType === 'loan' ? [{ name: 'limit', label: 'Credit limit (R) — only for revolving credit', type: 'number' }] : []),
        ...(realType === 'home_loan' ? [
          { name: 'propertyValue', label: 'Property value (R)', type: 'number' },
          { name: 'appreciationRate', label: 'Appreciation rate', type: 'number', step: '0.001', value: 0.06 }
        ] : [{ name: 'termMonths', label: 'Months remaining', type: 'number' }])
      ] : []),
      ...(realType === 'cash' ? [
        { name: 'growthRateAssumed', label: 'Interest rate p.a.', type: 'number', step: '0.001' },
        { name: 'overdraft', label: 'Overdraft limit (R)', type: 'number' }
      ] : []),
      { name: 'showOnHome', label: 'Show on Home', type: 'checkbox', value: true }
    ],
    onSubmit: async (values) => {
      await api.accounts.create({ type: realType, ...(vehicleType ? { vehicleType } : {}), ...values });
      showToast('Account added');
      await onDone();
    }
  });
}

export async function renderAccounts(root) {
  const [accounts, settings, incomeStreams] = await Promise.all([api.accounts.list(), api.settings.get(), api.incomeStreams.list()]);
  const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const expandedIds = new Set();
  const activityCache = {};
  let editingId = null;

  function section(title, list, key) {
    return `
      <div class="row mb-8">
        <span class="section-label">${title}</span>
        <button class="pill pill--sm" data-add="${key}">+ Add</button>
      </div>
      ${list.map((a) => accountRow(a, key, expandedIds, editingId, settings.currentAge, activityCache, accountsById)).join('')}
    `;
  }

  function draw() {
    const creditCards = accounts.filter((a) => a.type === 'credit_card');
    const loans = accounts.filter((a) => a.type === 'loan');
    const homeLoans = accounts.filter((a) => a.type === 'home_loan');
    const currentAccounts = accounts.filter(isCurrentAccount);
    const savings = accounts.filter((a) => (a.type === 'cash' && a.vehicleType === 'savings') || a.type === 'investment');

    root.innerHTML = `
      <h2 class="view-heading">Accounts</h2>
      <p class="view-subheading">${accounts.length} linked account${accounts.length === 1 ? '' : 's'}</p>

      <div class="row mb-8">
        <span class="section-label">INCOME STREAMS</span>
        <button class="pill pill--sm" id="add-income">+ Add</button>
      </div>
      <div class="card card--list mb-16">
        ${incomeStreams.length ? incomeStreams.map(incomeStreamRow).join('') : '<p class="muted empty-hint">No income streams yet.</p>'}
      </div>
      ${section('CURRENT ACCOUNTS', currentAccounts, 'current')}
      ${section('SAVINGS', savings, 'savings')}
      ${section('CREDIT CARDS', creditCards, 'credit_card')}
      ${section('LOANS', loans, 'loan')}
      ${section('HOME LOAN', homeLoans, 'home_loan')}
      ${!accounts.length ? '<div class="empty-state"><p>No accounts yet.</p></div>' : ''}
    `;

    root.querySelectorAll('[data-toggle]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.toggle;
        if (expandedIds.has(id)) {
          expandedIds.delete(id);
          if (editingId === id) editingId = null;
        } else {
          expandedIds.add(id);
          if (!activityCache[id]) {
            api.transactions.list(id).then((list) => { activityCache[id] = list; draw(); });
          }
        }
        draw();
      });
    });

    root.querySelectorAll('[data-transfer]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const account = accounts.find((a) => a.id === btn.dataset.transfer);
        openTransferModal(account, accounts, async () => { location.reload(); });
      });
    });

    root.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        editingId = btn.dataset.edit;
        draw();
      });
    });

    root.querySelectorAll('[data-edit-form]').forEach((form) => {
      form.addEventListener('click', (e) => e.stopPropagation());
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = form.dataset.editForm;
        const account = accounts.find((a) => a.id === id);
        const balance = parseDecimal(form.elements.balance.value);
        const ratePct = parseDecimal(form.elements.ratePct.value);
        const patch = { balance, showOnHome: form.elements.showOnHome.checked };
        if (ratePct !== null) patch[growthFieldFor(account.type)] = ratePct / 100;
        if (account.type === 'credit_card' || account.type === 'loan') {
          const limit = parseDecimal(form.elements.limit.value);
          if (limit !== null) patch.limit = limit;
        }
        if (INSTALMENT_TYPES.has(account.type)) {
          const instalment = parseDecimal(form.elements.instalment.value);
          const paymentDay = parseDecimal(form.elements.paymentDay.value);
          if (instalment !== null) patch.instalment = instalment;
          if (paymentDay !== null) patch.paymentDay = Math.min(Math.max(Math.round(paymentDay), 1), 28);
        }
        if (account.type === 'home_loan') {
          const propertyValue = parseDecimal(form.elements.propertyValue.value);
          const appreciationRatePct = parseDecimal(form.elements.appreciationRatePct.value);
          if (propertyValue !== null) patch.propertyValue = propertyValue;
          if (appreciationRatePct !== null) patch.appreciationRate = appreciationRatePct / 100;
        }
        if (account.type === 'cash') {
          const overdraft = parseDecimal(form.elements.overdraft.value);
          if (overdraft !== null) patch.overdraft = overdraft;
        }
        const updated = await api.accounts.update(id, patch);
        Object.assign(account, updated);
        editingId = null;
        showToast('Account updated');
        draw();
      });
    });

    root.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.delete;
        const account = accounts.find((a) => a.id === id);
        if (!confirm(`Delete "${account.name}"? This cannot be undone.`)) return;
        await api.accounts.remove(id);
        const idx = accounts.findIndex((a) => a.id === id);
        if (idx !== -1) accounts.splice(idx, 1);
        expandedIds.delete(id);
        if (editingId === id) editingId = null;
        showToast('Account deleted');
        draw();
      });
    });

    root.querySelectorAll('[data-add]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAddAccountModal(btn.dataset.add, async () => {
          location.reload();
        });
      });
    });

    root.querySelectorAll('[data-income]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const stream = incomeStreams.find((s) => s.id === btn.dataset.income);
        openIncomeStreamModal(stream, async () => { location.reload(); });
      });
    });

    root.querySelector('#add-income').addEventListener('click', () => {
      openIncomeStreamModal(null, async () => { location.reload(); });
    });
  }

  draw();
}
