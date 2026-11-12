/**
 * The interest taxonomy, client side.
 *
 * The keys and their display labels live in one place on the server
 * (`backend/services/interests.js`); this fetches them once per session and
 * caches them, rather than keeping a second copy here that can drift from the
 * one the deck filter actually matches on.
 */

import { api } from './api.js';

let cache = null;
let inflight = null;

export async function loadTaxonomy() {
  if (cache) return cache;
  if (!inflight) {
    inflight = api.discovery.interests({ count: false })
      .then((payload) => {
        cache = payload;
        return payload;
      })
      .catch(() => ({ groups: [], selected: [], declared: [] }))
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * Label for a stored key. Falls back to the key with underscores opened up, so
 * a category added on the server before a reload still reads as words rather
 * than as a token.
 */
export function labelFor(key) {
  for (const group of cache?.groups || []) {
    const hit = group.options.find((option) => option.key === key);
    if (hit) return hit.label;
  }
  return String(key || '').replace(/_/g, ' ');
}

export function labelsFor(keys = []) {
  return keys.map(labelFor);
}
