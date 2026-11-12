'use strict';

const CONTAINER = 'debit_orders';

const FREQUENCY_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };

/** Normalises any frequency to an equivalent monthly amount, for cash-flow totals. */
function monthlyEquivalent(order) {
  const divisor = FREQUENCY_MONTHS[order.frequency] || 1;
  return order.amount / divisor;
}

/** Next occurrence on/after `from`, given a fixed day-of-month debit day. */
function nextDueDate(order, from = new Date()) {
  const day = Math.min(Math.max(order.debitDay || 1, 1), 28);
  const candidate = new Date(from.getFullYear(), from.getMonth(), day);
  if (candidate < from) candidate.setMonth(candidate.getMonth() + 1);
  return candidate;
}

function createDebitOrdersService({ store, versionedCache, activity }) {
  async function list() {
    const all = await store.list(CONTAINER);
    return all.sort((a, b) => (a.debitDay || 0) - (b.debitDay || 0));
  }

  async function get(id) {
    return store.get(CONTAINER, id);
  }

  async function create(payload) {
    const record = await store.create(CONTAINER, { status: 'active', ...payload });
    await versionedCache.bump();
    await activity.log('debit-order.created', `Added debit order ${record.payee}`, { debitOrderId: record.id });
    return record;
  }

  async function update(id, patch) {
    const updated = await store.update(CONTAINER, id, patch);
    if (updated) await versionedCache.bump();
    return updated;
  }

  async function remove(id) {
    const removed = await store.remove(CONTAINER, id);
    if (removed) await versionedCache.bump();
    return removed;
  }

  async function upcoming(days = 7, from = new Date()) {
    const all = (await list()).filter((o) => o.status === 'active');
    const horizon = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
    return all
      .map((order) => ({ ...order, dueDate: nextDueDate(order, from) }))
      .filter((order) => order.dueDate <= horizon)
      .sort((a, b) => a.dueDate - b.dueDate);
  }

  async function monthlyTotal() {
    const all = (await list()).filter((o) => o.status === 'active');
    return all.reduce((sum, o) => sum + monthlyEquivalent(o), 0);
  }

  return { list, get, create, update, remove, upcoming, monthlyTotal, nextDueDate, monthlyEquivalent };
}

module.exports = { createDebitOrdersService, CONTAINER };
