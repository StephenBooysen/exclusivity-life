'use strict';

const CONTAINER = 'categories';

function createCategoriesService({ store, versionedCache }) {
  async function list() {
    const all = await store.list(CONTAINER);
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function create(payload) {
    const record = await store.create(CONTAINER, payload);
    await versionedCache.bump();
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

  return { list, create, update, remove };
}

module.exports = { createCategoriesService, CONTAINER };
