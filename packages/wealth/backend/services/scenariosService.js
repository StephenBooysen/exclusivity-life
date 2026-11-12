'use strict';

const CONTAINER = 'scenarios';

const BASE_CASE = {
  name: 'Moderate',
  isBaseCase: true,
  overrides: {}
};

function createScenariosService({ store, versionedCache }) {
  async function list() {
    const all = await store.list(CONTAINER);
    if (all.length === 0) {
      const base = await store.create(CONTAINER, BASE_CASE);
      return [base];
    }
    return all.sort((a, b) => (b.isBaseCase ? 1 : 0) - (a.isBaseCase ? 1 : 0));
  }

  async function get(id) {
    if (!id || id === 'base') {
      const all = await list();
      return all.find((s) => s.isBaseCase) || all[0];
    }
    return store.get(CONTAINER, id);
  }

  async function create(payload) {
    const record = await store.create(CONTAINER, { isBaseCase: false, overrides: {}, ...payload });
    await versionedCache.bump();
    return record;
  }

  async function update(id, patch) {
    const updated = await store.update(CONTAINER, id, patch);
    if (updated) await versionedCache.bump();
    return updated;
  }

  async function remove(id) {
    const existing = await store.get(CONTAINER, id);
    if (existing && existing.isBaseCase) {
      throw new Error('The base case scenario cannot be removed');
    }
    const removed = await store.remove(CONTAINER, id);
    if (removed) await versionedCache.bump();
    return removed;
  }

  return { list, get, create, update, remove };
}

module.exports = { createScenariosService, CONTAINER };
