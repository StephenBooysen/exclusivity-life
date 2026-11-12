'use strict';

/**
 * @fileoverview Namespaced generation-counter cache.
 *
 * The platform cache is put/get/delete only — no TTL and no pattern-delete.
 * The suite's answer is a generation counter: every write bumps a version, and
 * every cached computation keys itself off it, so a bump silently orphans the
 * previous generation instead of walking keys.
 *
 * Exclusivity namespaces the counter. A single global version would flush the
 * profile projection on every message send, and message traffic is the
 * highest-volume write in the app.
 */

const NAMESPACES = ['members', 'profiles', 'decks', 'conversations', 'moderation'];

function createVersionedCache(cache) {
  const versionKey = (ns) => `exclusivity:v:${ns}`;

  async function version(ns) {
    const value = await cache.get(versionKey(ns));
    return value || 0;
  }

  async function bump(ns) {
    const next = (await version(ns)) + 1;
    await cache.put(versionKey(ns), next);
    return next;
  }

  /** Bumps several namespaces in one go — for writes that cross read models. */
  async function bumpAll(namespaces) {
    return Promise.all(namespaces.map(bump));
  }

  async function remember(ns, keyPrefix, compute) {
    const key = `${ns}:${keyPrefix}:v${await version(ns)}`;
    const cached = await cache.get(key);
    if (cached !== undefined && cached !== null) return cached;
    const value = await compute();
    await cache.put(key, value);
    return value;
  }

  return { bump, bumpAll, version, remember, NAMESPACES };
}

module.exports = { createVersionedCache, NAMESPACES };
