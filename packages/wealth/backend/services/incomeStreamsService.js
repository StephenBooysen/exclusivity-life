'use strict';

const CONTAINER = 'income_streams';
const SNAPSHOT_CONTAINER = 'income_snapshots';

const FREQUENCY_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };

/** Normalises any frequency to an equivalent monthly amount, for cash-flow totals. */
function monthlyEquivalent(stream) {
  const divisor = FREQUENCY_MONTHS[stream.frequency] || 1;
  return (stream.amount || 0) / divisor;
}

/**
 * Income streams live alongside accounts as a first-class, editable entity
 * rather than a single static number in settings — an amount change is never
 * an overwrite, it always appends a dated snapshot too, mirroring how
 * accountsService tracks balance history.
 */
function createIncomeStreamsService({ store, versionedCache, activity }) {
  async function list() {
    const all = await store.list(CONTAINER);
    return all.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  async function get(id) {
    return store.get(CONTAINER, id);
  }

  async function recordSnapshot(streamId, amount, date) {
    await store.create(SNAPSHOT_CONTAINER, { streamId, amount, date });
  }

  async function create(payload) {
    const now = new Date().toISOString();
    const record = await store.create(CONTAINER, {
      status: 'active',
      frequency: 'monthly',
      ...payload,
      createdAt: now,
      updatedAt: now
    });
    if (typeof record.amount === 'number') {
      await recordSnapshot(record.id, record.amount, now);
    }
    await versionedCache.bump();
    await activity.log('income-stream.created', `Added income stream ${record.name}`, { streamId: record.id });
    return record;
  }

  async function update(id, patch) {
    const existing = await store.get(CONTAINER, id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const amountChanged = typeof patch.amount === 'number' && patch.amount !== existing.amount;

    const updated = await store.update(CONTAINER, id, { ...patch, updatedAt: now });

    if (amountChanged) {
      await recordSnapshot(id, patch.amount, now);
      await activity.log(
        'income-stream.amount-updated',
        `${existing.name} amount ${patch.amount > existing.amount ? 'increased' : 'decreased'} to ${patch.amount}`,
        { streamId: id, from: existing.amount, to: patch.amount }
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
      if (existing) await activity.log('income-stream.removed', `Removed ${existing.name}`, { streamId: id });
    }
    return removed;
  }

  async function history(streamId) {
    const all = await store.list(SNAPSHOT_CONTAINER);
    return all
      .filter((s) => s.streamId === streamId)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  async function monthlyTotal() {
    const all = (await list()).filter((s) => s.status === 'active');
    return all.reduce((sum, s) => sum + monthlyEquivalent(s), 0);
  }

  return { list, get, create, update, remove, history, monthlyTotal, monthlyEquivalent };
}

module.exports = { createIncomeStreamsService, CONTAINER, SNAPSHOT_CONTAINER };
