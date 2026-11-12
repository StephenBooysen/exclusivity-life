'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('../config');

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // 'YYYY-MM'
}

/** 'YYYY-MM' -> 'YYYY/MM' — the file provider treats a slash in the container name as a subfolder. */
function containerFor(accountSlug, month) {
  return `${accountSlug}/${month.replace('-', '/')}`;
}

/** Every 'YYYY-MM' that has a transactions file on disk for this account, oldest first. */
async function listMonths(accountSlug) {
  const accountDir = path.join(config.dataDir, accountSlug);
  let years;
  try {
    years = await fs.readdir(accountDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const months = [];
  for (const entry of years) {
    if (!entry.isDirectory() || !/^\d{4}$/.test(entry.name)) continue;
    const files = await fs.readdir(path.join(accountDir, entry.name)); // eslint-disable-line no-await-in-loop
    for (const file of files) {
      const match = file.match(/^(\d{2})\.json$/);
      if (match) months.push(`${entry.name}-${match[1]}`);
    }
  }
  return months.sort();
}

/**
 * Transactions live one file per account per calendar month
 * (data/<account-slug>/<year>/<month>.json), so every account has its own durable,
 * itemized ledger. Each month's file opens with a `kind: 'opening_balance'` row
 * (that account's starting balance for the month) followed by that month's
 * logged — or, for a month still ahead of us, projected — transactions.
 */
function createTransactionsService({ store, accounts, versionedCache, activity }) {
  async function slugFor(accountId) {
    const account = await accounts.get(accountId);
    if (!account) throw new Error(`Unknown account: ${accountId}`);
    return account.dataSlug;
  }

  async function forMonth(accountId, month = new Date().toISOString().slice(0, 7)) {
    const slug = await slugFor(accountId);
    const all = await store.list(containerFor(slug, month));
    return all.sort((a, b) => {
      if (a.kind === 'opening_balance') return -1;
      if (b.kind === 'opening_balance') return 1;
      return new Date(a.date) - new Date(b.date);
    });
  }

  async function list(accountId) {
    const slug = await slugFor(accountId);
    const months = await listMonths(slug);
    const all = [];
    for (const month of months) {
      all.push(...await forMonth(accountId, month)); // eslint-disable-line no-await-in-loop
    }
    return all.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  async function get(accountId, id) {
    const slug = await slugFor(accountId);
    for (const month of await listMonths(slug)) {
      const record = await store.get(containerFor(slug, month), id); // eslint-disable-line no-await-in-loop
      if (record) return record;
    }
    return null;
  }

  async function create(payload) {
    const { accountId } = payload;
    const slug = await slugFor(accountId);
    const date = payload.date || new Date().toISOString().slice(0, 10);
    const record = await store.create(containerFor(slug, monthKey(date)), {
      source: 'manual',
      ...payload,
      date
    });
    await versionedCache.bump();
    await activity.log('transaction.created', `Logged ${record.category} expense`, { transactionId: record.id, amount: record.amount });
    return record;
  }

  async function update(accountId, id, patch) {
    const slug = await slugFor(accountId);
    for (const month of await listMonths(slug)) {
      const container = containerFor(slug, month);
      const existing = await store.get(container, id); // eslint-disable-line no-await-in-loop
      if (!existing) continue;
      const updated = await store.update(container, id, patch);
      await versionedCache.bump();
      return updated;
    }
    return null;
  }

  async function remove(accountId, id) {
    const slug = await slugFor(accountId);
    for (const month of await listMonths(slug)) {
      const container = containerFor(slug, month);
      const existing = await store.get(container, id); // eslint-disable-line no-await-in-loop
      if (!existing) continue;
      const removed = await store.remove(container, id);
      if (removed) await versionedCache.bump();
      return removed;
    }
    return null;
  }

  async function totalsByCategory(accountId, month) {
    const transactions = (await forMonth(accountId, month)).filter((t) => t.kind !== 'opening_balance');
    const totals = {};
    for (const transaction of transactions) {
      totals[transaction.category] = (totals[transaction.category] || 0) + transaction.amount;
    }
    return totals;
  }

  /** Same shape as totalsByCategory, but scoped to an arbitrary [cycleStart, cycleEnd] date range instead of one calendar month — a pay cycle can straddle two month files. */
  async function totalsForCycle(accountId, cycleStart, cycleEnd) {
    const months = [...new Set([cycleStart.slice(0, 7), cycleEnd.slice(0, 7)])];
    const all = [];
    for (const month of months) {
      all.push(...await forMonth(accountId, month)); // eslint-disable-line no-await-in-loop
    }
    const inRange = all.filter((t) => t.kind !== 'opening_balance' && t.date >= cycleStart && t.date <= cycleEnd);
    const totals = {};
    for (const transaction of inRange) {
      totals[transaction.category] = (totals[transaction.category] || 0) + transaction.amount;
    }
    return totals;
  }

  /** Upserts the account's opening-balance row for that month — creates it if this is the first write to that month. */
  async function setOpeningBalance(accountId, month, amount) {
    const slug = await slugFor(accountId);
    const existing = (await forMonth(accountId, month)).find((t) => t.kind === 'opening_balance');
    if (existing) {
      const updated = await store.update(containerFor(slug, month), existing.id, { amount });
      await versionedCache.bump();
      return updated;
    }
    const record = await store.create(containerFor(slug, month), {
      kind: 'opening_balance',
      note: 'Incoming Balance',
      category: null,
      accountId,
      date: `${month}-01`,
      amount
    });
    await versionedCache.bump();
    return record;
  }

  return { list, get, create, update, remove, forMonth, totalsByCategory, totalsForCycle, setOpeningBalance, listMonths: (accountId) => slugFor(accountId).then(listMonths) };
}

module.exports = { createTransactionsService };
