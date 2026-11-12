'use strict';

const CONTAINER = 'accounts';
const SNAPSHOT_CONTAINER = 'balance_snapshots';

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'account';
}

/** Folder key for this account's transaction ledger — computed once at creation and never re-derived from `name`, so a later rename can't orphan its history. */
function dataSlugFor(name, id, existingSlugs) {
  const base = slugify(name);
  if (!existingSlugs.has(base)) return base;
  return `${base}-${id.slice(0, 4)}`;
}

/**
 * Every account type (cash, credit_card, loan, home_loan, retirement,
 * investment) lives in one container distinguished by `type` — the fields
 * that don't apply to a given type are simply absent. A balance change is
 * never an overwrite: it always appends a dated snapshot too, so history is
 * reconstructable (PRD §7 data integrity).
 */
function createAccountsService({ store, versionedCache, activity }) {
  async function list(type) {
    const all = await store.list(CONTAINER);
    const sorted = all.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return type ? sorted.filter((a) => a.type === type) : sorted;
  }

  async function get(id) {
    return store.get(CONTAINER, id);
  }

  async function recordSnapshot(accountId, balance, date) {
    await store.create(SNAPSHOT_CONTAINER, { accountId, balance, date });
  }

  async function create(payload) {
    const now = new Date().toISOString();
    const existing = await store.list(CONTAINER);
    const existingSlugs = new Set(existing.map((a) => a.dataSlug).filter(Boolean));
    const record = await store.create(CONTAINER, {
      status: 'active',
      ...payload,
      createdAt: now,
      updatedAt: now
    });
    record.dataSlug = dataSlugFor(record.name, record.id, existingSlugs);
    await store.update(CONTAINER, record.id, { dataSlug: record.dataSlug });
    if (typeof record.balance === 'number') {
      await recordSnapshot(record.id, record.balance, now);
    }
    await versionedCache.bump();
    await activity.log('account.created', `Added ${record.name}`, { accountId: record.id, type: record.type });
    return record;
  }

  async function update(id, patch) {
    const existing = await store.get(CONTAINER, id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const balanceChanged = typeof patch.balance === 'number' && patch.balance !== existing.balance;

    const updated = await store.update(CONTAINER, id, { ...patch, updatedAt: now });

    if (balanceChanged) {
      await recordSnapshot(id, patch.balance, now);
      await activity.log(
        'account.balance-updated',
        `${existing.name} balance ${patch.balance > existing.balance ? 'increased' : 'decreased'} to ${patch.balance}`,
        { accountId: id, from: existing.balance, to: patch.balance }
      );
    }

    await versionedCache.bump();
    return updated;
  }

  async function remove(id) {
    const existing = await store.get(CONTAINER, id);
    const removed = await store.remove(CONTAINER, id);
    if (removed) {
      await versionedCache.bump();
      if (existing) await activity.log('account.removed', `Removed ${existing.name}`, { accountId: id });
    }
    return removed;
  }

  async function history(accountId) {
    const all = await store.list(SNAPSHOT_CONTAINER);
    return all
      .filter((s) => s.accountId === accountId)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  return { list, get, create, update, remove, history };
}

module.exports = { createAccountsService, CONTAINER, SNAPSHOT_CONTAINER };
