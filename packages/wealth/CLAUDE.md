# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Me Money Manager — a single-user personal finance app (South African household finances: ZAR, home loan/"bond", debit orders, retirement annuity, pension/provident fund, TFSA) replacing a spreadsheet. See `.docs/Product Requirements Document.md` for full product intent and terminology. There is no multi-user support and none is planned.

## Commands

```
npm install
npm run dev     # nodemon ./index.js — auto-restarts on backend file changes; serves on PORT (default 11001)
npm run kill     # scripts/kill-port.js — force-kills whatever is listening on port 11001
```

There is no test suite (`npm test` is a stub that exits 1) and no lint/build step — the frontend is plain ES modules served as-is, no bundler.

`digital-technologies-core` is a **local sibling dependency** (`"../me-platform-core/"` in package.json) — that repo must be checked out next to this one for `npm install` to resolve.

## Architecture

### Backend shape
`index.js` → `backend/app.js#createApp()` wires everything:
- `backend/services/platform.js` initializes the `digital-technologies-core` service registry once per process, exposing `logger`, `cache`, `dataService` (file-backed), `queue`, and `scheduler`.
- `backend/services/store.js` is a thin CRUD wrapper (`list/get/create/update/remove`) over the raw `dataService` — every domain service takes this `store` rather than talking to `dataService` directly.
- `backend/services/cacheVersion.js` implements a generation-counter cache: any write calls `versionedCache.bump()`, and expensive computations (e.g. projections) call `versionedCache.remember(key, compute)` which keys itself off the current version — no pattern-delete needed, a bump just orphans the previous generation.
- Each domain has a paired `backend/services/<x>Service.js` (business logic) + `backend/routes/<x>.js` (thin Express handlers), instantiated in `app.js` and wired together in `backend/routes/index.js`. Routes destructure only the services they need from the shared `services` bag.

### Data storage — read this before touching persistence
Everything lives as JSON under `.application/data/`. One "container" = one `.json` file holding a plain object keyed by uuid (id is duplicated onto the record itself). Container names may contain `/`, which the file provider treats as a subfolder (created via recursive `mkdir` on write) — this is how nested layouts like account-scoped transaction ledgers work without any platform-core changes.

**No locking, no partial writes.** Every read/write is a whole-file read → modify → write of the entire container. Two `store.update()`/`store.create()` calls against the *same* container must never run concurrently (e.g. `Promise.all([...])`) — the second write's stale in-memory read silently clobbers the first's change. Sequence same-container writes with plain `await`. (This bit a real transfer-balance bug during development — see `backend/services/transfersService.js` for the fix and the comment explaining it.)

Key containers/layout:
- `accounts` — one record per account; `type` (`cash` / `credit_card` / `loan` / `home_loan` / `retirement` / `investment`) drives which fields apply and how the frontend renders it. Every account gets a `dataSlug` computed once at creation (never re-derived from `name`, so renaming an account can't orphan its history) — this slug is the folder key for its transactions.
- `balance_snapshots` — every balance change on an account appends a dated snapshot here (see `accountsService.recordSnapshot`), so balance history is reconstructable even though `accounts` only stores the current value.
- `data/<account.dataSlug>/<year>/<month>.json` — one file per account per calendar month. Every transactions-service method (`list`, `get`, `create`, `update`, `remove`, `forMonth`, `totalsByCategory`, `setOpeningBalance`) is scoped by `accountId` — there is no "all transactions" global view. Each month's file leads with a `kind: 'opening_balance'` row representing that account's starting balance for the month.
- Transfers between accounts (`backend/services/transfersService.js`) write one linked `kind:'transfer'` row into each side's ledger (`direction: 'out'`/`'in'`, shared `transferId`) and update both accounts' balances — a transfer *into* a debt-type account (`credit_card`/`loan`/`home_loan`) reduces its balance instead of increasing it, since that balance represents money owed.

### Cash Flow view's pay-cycle model
`public/js/views/cashflow.js` does not use calendar months. It defines cycles running from `settings.paydayDay` (default 27) of one month to the day before the next month's payday, computed client-side (`cycleStartContaining`, `cycleEndFor`, `shiftCycle`). Because `opening_balance` rows are still anchored to the 1st of a calendar month, `balanceAt()` bridges the mismatch by walking the dated flows (transactions + synthesized debit-order/loan-instalment/salary occurrences) between whichever `opening_balance` anchor is closest and the cycle boundary being asked about.

Debit orders and loan/home-loan instalments (accounts with `instalment` + `paymentDay` set) are both synthesized into the feed as locked/greyed, non-editable entries alongside salary — only real logged expenses are user-editable/deletable. Future cycles with no stored transactions fall back to a projection built from category budgets (`categories` container) + inflated debit orders/instalments/salary (`settings.inflationRate`).

### Frontend shape
No build step, no framework — plain ES modules loaded directly by the browser.
- `public/js/router.js` is a hash router (`#/<route>`) mapping to a `renderX(root)` function per view in `public/js/views/*.js`.
- Views are plain async functions: fetch data via `public/js/api.js` (a thin `fetch` wrapper), render raw template-string HTML into the DOM, then imperatively attach event listeners. No virtual DOM, no reactivity — every state change re-renders by calling the view's local `draw()`/re-render function again.
- `public/js/components/modal.js` is the generic bottom-sheet form used by nearly every create/edit flow: pass a declarative `fields` array (`text`/`number`/`date`/`select`/`checkbox`) plus `onSubmit`/`onDelete` callbacks.
- `public/js/format.js#formatCurrency` always shows 2 decimal places (never rounds to whole rands) — this app's convention, don't "simplify" it back to whole-rand rounding.

## Docs worth reading before larger features
- `.docs/Product Requirements Document.md` — product intent, terminology, target user.
- `.docs/Design/` — the visual design handoff the frontend was built against.
