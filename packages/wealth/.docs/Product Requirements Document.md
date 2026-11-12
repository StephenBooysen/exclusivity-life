# Product Requirements Document
## Me Money Manager — Daily Wealth & Finance Management Application

| | |
|---|---|
| **Status** | v1.1 — living document, updated alongside implementation |
| **Owner** | Stephen Booysen |
| **Date** | 2026-07-31 |
| **Repo** | me-money-manager |

---

## 1. Purpose & Background

Stephen has run his household finances from a single Google Sheet for years. It works, but it is manual, easy to break, and does nothing to answer the question that actually matters: *"Am I on track, and what does my financial life look like at 90?"*

Me Money Manager replaces that sheet with a lightweight personal application that:

- Tracks the balances that move daily (credit cards, loans, home loan, debit orders, discretionary spend).
- Tracks the balances that move slowly (retirement annuities, pension/provident funds, investments).
- Projects the combination of both, compounded forward, to model long-term wealth and retirement readiness.

This is a single-user, personal-finance system (household of one, potentially extended to a spouse/family later — see §9). It is not a budgeting app for the masses; it is Stephen's financial control panel, built to his terminology and his accounts.

> This document is kept current as the app is built — sections describe actual, shipped behaviour rather than only aspirational v1 scope. Where a decision was made during implementation that isn't obvious from the original spec, it's called out inline.

## 2. Goals & Success Metrics

| Goal | Success looks like |
|---|---|
| Kill the spreadsheet | All balances, debit orders, and expenses live in the app within one month of launch; the Google Sheet is read-only/archived. |
| Daily situational awareness | Net worth, available cash, and upcoming debit orders are visible in under 5 seconds from opening the app. |
| Debt clarity | Every credit card and loan shows current balance, interest rate, minimum payment, and a payoff date at a glance. |
| Long-range confidence | A single screen answers "what is my projected net worth and retirement income at ages 60 / 65 / 90?" |
| Low admin overhead | Recurring debit orders and expense categories require entry once; monthly re-entry is data-only (balances, actuals), not structural. |

Non-goals for v1: multi-user collaboration, bank-feed aggregation/Open Banking, tax filing, investment trading.

## 3. Target User & Context

**Primary persona — "Stephen", the household CFO.**
- Manages his own finances end-to-end: bond, two credit cards, a personal loan, several debit orders, a retirement annuity, a pension fund from a previous employer, and discretionary investments.
- South African context: home loan ("bond"), debit orders (EFT-based recurring payments, not US-style ACH autopay), retirement annuity (RA), pension/provident fund, Tax-Free Savings Account (TFSA). All monetary values in **ZAR (R)**.
- Comfortable with numbers and spreadsheets; wants precision and control, not hand-holding or gamification.
- Primarily checks in on a phone, daily-to-weekly, in short sessions (commute, evening review); does deeper planning on a laptop occasionally.

**Secondary persona — future household member** (spouse/dependant), read-only or shared-edit — explicitly out of scope for v1 but the data model should not preclude it (see §9).

## 4. Scope

### 4.1 In scope (v1)
1. Net worth dashboard (assets vs liabilities, trend).
2. Credit card & short-term debt tracking.
3. Loan tracking (personal loans, vehicle finance, etc.).
4. Home loan (bond) tracking with amortization.
5. Debit order register (recurring fixed payments).
6. Discretionary expense capture & categorization.
7. Retirement fund monitoring (RA, pension, provident, preservation funds).
8. Investment/savings monitoring (TFSA, unit trusts, cash investments).
9. Wealth projection engine, present day → age 90.
10. Manual data entry and CSV import for balances/transactions.
11. Alerts & insights (upcoming debit orders, low buffer, rate changes, off-track projections).
12. Account-to-account transfers (including payments toward a credit card or loan), with both sides of the transfer recorded in each account's own ledger.
13. Pay-cycle-aligned cash flow (payday to payday, not calendar month), with an editable, reconciliation-friendly incoming/current/closing balance for the everyday spending account.
14. Overdraft and revolving-credit support: a cash account can carry an overdraft limit, and a loan-type account can carry a credit limit, both of which change how "available to spend/available credit" is presented.

### 4.2 Out of scope (v1)
- Live bank/account aggregation (Open Banking, screen-scraping).
- Multi-currency support.
- Multi-user accounts, permissions, sharing.
- Tax computation or SARS integration.
- Investment trading/execution.
- Native mobile apps (v1 is a mobile-responsive web app — see §8).

## 5. Core Features

### 5.1 Net Worth Dashboard
**Purpose:** the daily landing screen — the answer to "where do I stand right now?"

- Hero figure: total net worth (assets − liabilities), with delta vs. 30 days ago.
- Breakdown strip ("Where It Sits"): Cash & Savings, Investments & Retirement, Property Equity, Other Debt — negative figures always render in the app's negative-amount color (orange), positive in the standard text color, via one shared convention (`amountClass()` in `format.js`) so this can't silently drift out of sync between screens again.
- **Your Accounts:** a user-curated set of account summary cards (each account has a "Show on Home" toggle, not an automatic pick) rendered full-width, stacked. The card layout adapts to the account:
  - Credit card / revolving credit (a loan-type account with a credit limit set): **Available** and **To pay off**, with a utilisation bar.
  - Cash account with an overdraft limit set: **Balance** and **Available** (overdraft limit + balance), with a utilisation bar — this is the "available to spend" figure, and it correctly accounts for the overdraft rather than just showing a raw (possibly negative) balance.
  - Home loan: balance + equity % bar + instalment/month.
  - Everything else: balance + a simple value bar.
- Upcoming debit orders (next 7 days) with amount and date.
- **This Month's Spending:** total spend for the *current pay cycle* (payday to payday — see §5.5a), not the calendar month, against the sum of category budgets set in Cash Flow → Projections.
- Mini projection sparkline linking through to the full Wealth Projection screen (§5.9).

**Acceptance criteria**
- Net worth recalculates automatically whenever any linked balance, debt, or projection assumption changes.
- Dashboard loads and is fully rendered from cache in under 1 second on a mobile connection.

### 5.2 Credit Cards & Short-Term Debt
For each card: issuer/name, current balance, credit limit, utilisation %, APR, minimum payment, statement/due date — all editable after creation (balance/rate/limit are not creation-only fields).

- Manual balance update (date-stamped) — history retained for trend charts (`balance_snapshots`, appended on every balance change, never overwritten).
- Utilisation warning when a card crosses a configurable threshold (e.g. 70%).
- Optional payoff calculator: minimum payment vs. a target extra payment, with resulting payoff date and interest cost.

### 5.3 Loans (non-bond)
For each loan: lender, original amount, current balance, interest rate, term remaining, monthly instalment, installment payment day, end date.
- Same balance-history and trend treatment as credit cards.
- Rolls into the Debt total on the dashboard and into the projection engine as a scheduled liability that terminates on its end date.
- **Revolving credit:** a loan-type account may also carry a credit limit (e.g. an "FNB Revolving" facility). When a limit is set, it's treated like a credit card everywhere balance is shown (Home summary card shows Available/To pay off) rather than a fixed-term loan.
- **Settle date:** shown directly on the collapsed account row (e.g. "Settles Jan 2030"), computed from balance/rate/instalment. If the instalment doesn't cover the monthly interest, this reads "Not on track to settle" instead of a runaway date.
- **Amortization schedule:** expanding the account shows the next 12 months' interest/principal/balance breakdown in a scrollable panel, computed live from the account's current balance, rate, and instalment (not a stored schedule).

### 5.4 Home Loan (Bond)
- Bond details: original amount, current balance, interest rate (with support for rate changes over time — prime ± linked), term, monthly instalment, installment payment day, extra payments.
- Amortization schedule (12-month table, same mechanism as §5.3) and settle-date display.
- Property value field (manually updated, e.g. annually) to track equity growth independent of the amortization schedule.
- "What if" extra-payment modelling: additional monthly/lump-sum payments and their effect on payoff date and total interest saved.

### 5.5 Debit Orders (Recurring Payments)
A register of fixed recurring outflows distinct from discretionary spend — insurance, subscriptions, memberships, school fees, medical aid. (Loan/bond instalments are tracked on the account itself, §5.3–5.4, and merged into the same Cash Flow feed rather than duplicated as debit orders.)

- Fields: payee, amount, frequency (monthly/quarterly/annual), debit day, category, **paid-from account** (any cash account or credit card — so an international subscription billed to a credit card is distinguishable from one debited off the current account), active/paused/cancelled status.
- List view (Cash Flow → Debit Orders tab) of what debits when, with the paying account shown alongside each entry.
- Feeds directly into the "available to spend" calculation and into the Cash Flow feed, tagged and greyed out there as non-editable (locked) entries.

### 5.5a Cash Flow & the Pay Cycle
Cash Flow is organised around **pay cycles**, not calendar months — a cycle runs from payday (configurable in Settings, default the 27th) through the day before the next payday. This matters because salary lands on the 27th and reads as the start of a new period even though it falls late in the calendar month.

- **Incoming balance** (tap to set): the account's balance at the start of the cycle. Editable directly — sets that calendar month's opening-balance record.
- **Current balance**: the account's real, live balance, sourced from the account record itself. Also directly editable — capturing a new value here logs a same-day **"Balance adjustment"** transaction for the exact difference (correctly signed as a credit or debit) and updates the stored account balance to match, so reconciling against your actual bank balance doesn't require hand-calculating the delta.
- **Closing balance**: for the cycle currently in progress, this is a *trend-based forecast* — it starts from the real Current balance (not a stale monthly snapshot) and adds only the flows still ahead of today through cycle-end. Still-placeholder category projections are scaled down to whatever share of the cycle actually remains (a projection made on day 20 of a 30-day cycle only counts a third of the full month's budget as "still ahead"). For past/future cycles it falls back to the historical anchor-walk method.
- **Inflows vs outflows**: a dedicated card comparing total income against total outflows (debit orders + loans + spend) for the cycle, with an explicit "left over" / "spending more than you earn" callout — this was called out as an important personal metric, not just a nice-to-have.
- The spending feed always sorts locked entries (debit orders, loan payments, salary, projections) after real logged transactions, and projections always sort last regardless of the date they're pinned to.

### 5.6 Discretionary Expenses
- Quick-capture entry: amount, category, date, optional note/merchant — optimised for logging spend in under 10 seconds on mobile.
- Category management (Cash Flow → Projections tab): add/edit/delete categories, each with a group and a monthly budget.
- Cycle actual-vs-budget view by category (donut chart), including debit orders' categories (e.g. a "Living" debit order like a WiFi bill shows up in the same category breakdown as logged grocery spend).
- Distinction from debit orders: expenses are variable/logged; debit orders are fixed/scheduled. Both feed the same cash-flow total.

### 5.6a Account Transfers
Moving money between your own accounts, or making a payment toward a credit card or loan, is a first-class action rather than two manually-logged, unrelated expenses.

- Triggered from a specific account's own "⇄ Transfer" button (Accounts screen) — the source account is fixed by which button was pressed; only the destination and amount need to be chosen.
- Valid destinations: any other cash account, or a debt account (credit card/loan/home loan), in which case the transfer is treated as a payment and reduces what's owed rather than increasing it.
- Records one linked entry in each account's own ledger (sharing a transfer ID) and updates both accounts' balances (and their balance-history snapshot) atomically.

### 5.7 Retirement Fund Monitoring
- One entry per retirement vehicle: type (RA, pension fund, provident fund, preservation fund), provider, current value, monthly contribution, assumed annual growth rate, retirement age target.
- Historical value tracking (manual updates, e.g. quarterly, matching statement frequency).
- Projected value at retirement age using contribution + compounding assumptions, editable per fund.
- Optional drawdown modelling: projected sustainable monthly income in retirement at a configurable drawdown rate (e.g. 4%).

### 5.8 Investments & Savings
- Vehicles: TFSA, unit trusts, ETFs, cash investments/notice accounts, emergency fund.
- Same value/contribution/growth-assumption model as §5.7, distinguished by tax treatment (TFSA contribution-limit tracking: annual R36,000 / lifetime R500,000 caps, flagged if approaching).
- Rolls into net worth and into the projection engine as a compounding asset.

### 5.9 Wealth Projection Engine (the core differentiator)
**Purpose:** project net worth, year by year, from today until age 90.

- Inputs, all editable, pulled from the modules above with sensible defaults:
  - Current balances of every asset and liability.
  - Scheduled debt amortization (loans, bond) with defined end dates.
  - Retirement/investment contributions and assumed growth rates (per vehicle, so a bond can assume 0% "growth" while an RA assumes real equity returns).
  - Inflation assumption (default, editable, e.g. 5.5%) applied to expenses and debit-order escalation.
  - Salary/income growth assumption and expected changes (e.g. retirement date, when salary income stops and drawdown starts).
- Output: a single chart, present day → age 90, showing:
  - Net worth (total assets − total liabilities) as the primary line.
  - Composition beneath it: property equity, retirement & investment value, cash, minus total debt.
  - Key milestone markers: bond paid off, last loan paid off, retirement age, age 90.
- Scenario comparison: at least two named scenarios (e.g. "Base case" vs. "Retire 5 years early" or "Extra bond payment") plotted together.
- Every assumption is visible and editable from the projection screen itself — no assumption is hidden in settings.

**Acceptance criteria**
- Changing any single input (e.g. RA growth assumption) recalculates the full 90-year projection and updates the chart without a page reload.
- The projection clearly flags the age at which, under current assumptions, retirement income (drawdown + any other income) falls below a user-defined minimum.

### 5.10 Alerts & Insights
- Upcoming debit orders / low available-to-spend buffer.
- Credit utilisation above threshold.
- Bond/loan interest rate change detected (manual entry trigger) with re-projected impact.
- Retirement contribution room (TFSA) approaching annual/lifetime limit.
- Projection drift: if actual net worth falls materially behind the projected line for two consecutive updates, surface a nudge.

### 5.11 Data Entry, Import & Security
- All balances are manually entered or CSV-imported (v1 has no live bank feed — see §4.2).
- CSV import for bank/credit-card statement exports to bulk-load discretionary expenses.
- Local-first data storage (this repo already scaffolds an Express app on `nooblyjs-core`/`me-platform-core` with a data directory and a basic auth/roles system in `.application/data`) — single-user auth is sufficient for v1; no data leaves the user's own deployment.
- Regular export (CSV/JSON) of all data for backup, independent of any future migration.

## 6. High-Level Data Model

```
Account (type: cash | credit_card | loan | home_loan | retirement | investment)
  ├─ id, name, institution, type, status, showOnHome
  ├─ dataSlug            -- stable folder key for this account's transaction ledger,
  │                          set once at creation and never re-derived from `name`,
  │                          so renaming an account can't orphan its history
  ├─ BalanceSnapshot (account_id, date, balance)      -- history for every account,
  │                                                       appended on every balance
  │                                                       change, never overwritten
  └─ type-specific attributes:
       cash:        vehicleType (current|savings), growthRateAssumed, overdraft
       credit_card: limit, rate (APR), statementDay, minPayment
       loan:        originalAmount, rate, termMonths, instalment, paymentDay,
                     limit (optional — present only for a revolving-credit facility)
       home_loan:   originalAmount, rate(+history), instalment, paymentDay,
                     propertyValue(+history), appreciationRate, extra_payments[]
       retirement:  vehicleType, contributionMonthly, growthRateAssumed,
                     targetRetirementAge
       investment:  vehicleType, taxWrapper, contributionMonthly, growthRateAssumed

Transaction — stored per account, one file per calendar month:
  data/<account.dataSlug>/<year>/<month>.json
  ├─ id, accountId, date, amount, category, note, source (manual|projected)
  ├─ kind: undefined (ordinary expense) | 'opening_balance' | 'transfer'
  │        (an 'opening_balance' row leads each month's file, representing
  │         that account's starting balance for the month)
  └─ transfer-only fields: direction (out|in), counterAccountId, transferId
     (a transfer writes one linked row into each side's ledger)

DebitOrder
  ├─ payee, amount, frequency, debitDay, category, accountId (paid-from account),
     status

ProjectionScenario
  ├─ name, assumptions{ inflation, income_growth, retirement_age,
     drawdown_rate, per-account growth overrides }
  └─ derived: yearly net worth series to age 90 (computed, not stored)

Category (shared by discretionary spend and category-based projections):
  name, group, monthlyBudget
```

**Note on storage:** the file-backed store does a whole-container read/modify/write with no locking — concurrent writes to the same container (e.g. updating both sides of a transfer's account balances at once) must be sequenced, not parallelised, or one write silently clobbers the other.

## 7. Non-Functional Requirements

- **Platform:** mobile-responsive web app first (installable as a PWA); desktop-friendly for deeper projection editing. No native app in v1.
- **Performance:** dashboard interactive in <1s on a typical mobile connection; projection recalculation <300ms for a 65-year horizon.
- **Security & privacy:** single-user auth (already scaffolded via `authservice`), all financial data stored locally to the deployment; no third-party analytics on financial values.
- **Data integrity:** every balance change is a dated snapshot, never an overwrite — full history is always reconstructable.
- **Offline tolerance:** dashboard and last-known balances viewable without connectivity; writes queue and sync when back online (PWA).
- **Currency & locale:** ZAR (R) formatting, en-ZA date conventions (DD/MM/YYYY) throughout. All monetary values always show two decimal places — the app never rounds to whole rands.
- **Debug tooling:** a `?date=YYYYMMDD` URL query param overrides "today" everywhere the frontend derives it (pay-cycle boundaries, projected/settle dates, days-until calculations), with a visible banner while active. Lets a cycle, projection, or payoff date be previewed on an arbitrary date without touching the system clock. Frontend-only — the server-side projection engine still uses the real date. Remove the param to reset.

## 8. Platform Decision

Delivered as a **mobile web application** (responsive, PWA-installable) rather than a native app, consistent with the existing Express/`me-platform-core` scaffold in this repo. This gives Stephen a single codebase, home-screen install on his phone, and full desktop access for the heavier projection/scenario work — at the cost of push notifications being best-effort (web push) rather than native.

## 9. Assumptions & Open Questions

0. **Resolved — month boundaries follow payday, not the calendar.** Cash Flow, Home's "This Month's Spending," and the projection engine's discretionary-spend input all use a pay cycle (payday → day before next payday, `paydayDay` in Settings, default the 27th) rather than the calendar month. This was an explicit decision after the calendar-month approach produced confusing results around a salary landing late in the month.
1. **Single-user for v1** — the data model separates accounts/debits/expenses cleanly enough that a second user (spouse) could be added later without a schema rewrite, but shared editing/permissions are not built now. *Confirm if joint-household tracking is needed sooner.*
2. **Growth-rate assumptions are user-entered**, not fetched from a market-data source — v1 has no external market/rate feed. *Confirm this is acceptable, or whether a periodic manual "assumption review" prompt is wanted instead.*
3. **Default assumptions** (inflation 5.5%, drawdown 4%, retirement age 65) are placeholders — confirm target retirement age and preferred inflation/growth defaults.
4. **CSV import format** depends on Stephen's bank(s) export format — needs a sample export to scope the parser.
5. Life expectancy horizon fixed at **age 90** per the request; the projection engine should treat this as a configurable parameter, not a hard-coded constant, in case it needs to move.

## 10. Suggested Phasing

| Phase | Scope |
|---|---|
| **Phase 1 — Foundation** | Accounts (all types), balance history, debit order register, expense capture, net worth dashboard. |
| **Phase 2 — Debt detail** | Credit card utilisation & payoff calculator, loan and bond amortization, extra-payment modelling. |
| **Phase 3 — Long-range** | Retirement & investment modules, wealth projection engine to age 90, scenario comparison. |
| **Phase 4 — Polish** | Alerts & insights, CSV import, PWA/offline support, data export. |

## 11. Glossary

| Term | Meaning |
|---|---|
| Bond | South African term for a home loan/mortgage. |
| Debit order | A recurring, pre-authorised EFT deduction from a bank account (SA equivalent of autopay). |
| RA | Retirement Annuity — individual retirement savings vehicle. |
| Pension / Provident fund | Employer-linked retirement funds; provident funds historically allowed full lump-sum withdrawal, now aligned with pension rules. |
| TFSA | Tax-Free Savings Account — SARS-regulated, R36,000 annual / R500,000 lifetime contribution caps (2026 figures, subject to change). |
| Preservation fund | Vehicle for preserving retirement savings when leaving an employer, in lieu of cashing out. |
