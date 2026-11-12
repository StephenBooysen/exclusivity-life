'use strict';

/**
 * @fileoverview CRUD over the platform-core file dataService, with
 * per-container write serialisation.
 *
 * Two properties of the file provider drive this whole module:
 *
 *  1. `add()` returns only the generated key, so every record is patched with
 *     its own `id` right after creation — every other method can then treat
 *     `id` as an ordinary field already present on the stored JSON.
 *
 *  2. Mutations are read-modify-write over a whole-file JSON document, and the
 *     write is a plain `fs.writeFile` — truncate, then write. That creates two
 *     distinct hazards, and both are real: two overlapping writes interleave
 *     at their await points and one is silently lost, and a read that lands
 *     mid-write sees a truncated file and fails to parse.
 *
 *     The process is single-threaded but not single-tasked, and a dating app —
 *     unlike the read-mostly apps in this suite — has genuinely concurrent
 *     requests touching shared containers. Every operation, read included,
 *     therefore queues on a per-container promise chain. Serialising reads as
 *     well as writes is what closes the torn-read hazard; the cost is that a
 *     read waits behind an in-flight write to the same container, which at
 *     this scale is microseconds.
 *
 * A missing container reads as `{}` rather than throwing, so absence is
 * already represented without an error. Anything this module does throw is a
 * genuine failure and must propagate — masking it as "not found" would turn a
 * transient disk error into a member who appears not to exist.
 */

/**
 * @param {Object} dataService platform-core dataService (file provider)
 * @param {Object=} logger
 */
function createStore(dataService, logger) {
  /** @type {Map<string, Promise<*>>} container name -> tail of its write chain */
  const chains = new Map();

  function serialise(container, task) {
    const previous = chains.get(container) || Promise.resolve();
    // Run the task whether the previous one resolved or rejected — one
    // failure must not wedge the container forever.
    const next = previous.then(task, task);
    // Park a swallowed copy as the chain tail so an unhandled rejection from
    // a caller who never awaited does not crash the process.
    chains.set(container, next.catch(() => {}));
    return next;
  }

  return {
    /** Whole-container read. `find` with an empty term returns every record. */
    list(container) {
      return serialise(container, () => dataService.find(container, ''));
    },

    get(container, id) {
      if (!id) return Promise.resolve(null);
      return serialise(container, () => dataService.getByUuid(container, id));
    },

    count(container) {
      return serialise(container, () => dataService.count(container));
    },

    create(container, data) {
      return serialise(container, async () => {
        const id = await dataService.add(container, data);
        const record = { ...data, id };
        await dataService.update(container, id, record);
        return record;
      });
    },

    update(container, id, patch) {
      return serialise(container, async () => {
        const existing = await dataService.getByUuid(container, id);
        if (!existing) return null;
        const updated = { ...existing, ...patch, id };
        await dataService.update(container, id, updated);
        return updated;
      });
    },

    /**
     * Read-modify-write under the container lock. Use when the new value
     * depends on the current one (counters, array appends) — a get() followed
     * by an update() is not atomic against a concurrent writer.
     */
    mutate(container, id, mutator) {
      return serialise(container, async () => {
        const existing = await dataService.getByUuid(container, id);
        if (!existing) return null;
        const updated = { ...mutator(existing), id };
        await dataService.update(container, id, updated);
        return updated;
      });
    },

    remove(container, id) {
      return serialise(container, () => dataService.remove(container, id));
    },

    /** Convenience: first record in a container matching a predicate. */
    async findOne(container, predicate) {
      const all = await this.list(container);
      return all.find(predicate) || null;
    },

    /** Convenience: every record in a container matching a predicate. */
    async findAll(container, predicate) {
      const all = await this.list(container);
      return all.filter(predicate);
    }
  };
}

module.exports = { createStore };
