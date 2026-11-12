'use strict';

/**
 * @fileoverview Audit and activity trail.
 *
 * Write-behind by default: `log()` only enqueues, and a drain loop persists on
 * its own cadence, so sending a message never waits on an extra disk write.
 *
 * Two categories bypass the queue. The in-memory queue is not durable across a
 * crash, and moderation, verification and billing records must be complete —
 * losing "member liked a card" is acceptable, losing "reviewer banned a
 * member" is not. Those are written synchronously.
 *
 * The container is append-only. Corrections are new records referencing the
 * original; `store.update` is never called on it.
 */

const QUEUE_NAME = 'exclusivity:activity';
const CONTAINER = 'activity_log';

/** Event prefixes that must survive a crash — written straight through. */
const DURABLE_PREFIXES = ['moderation.', 'verification.', 'billing.', 'application.decided', 'member.banned', 'member.suspended', 'admin.'];

function isDurable(type) {
  return DURABLE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

function createActivityService({ store, queue, logger }) {
  function record(type, message, meta) {
    return {
      type,
      message,
      meta: meta || {},
      createdAt: new Date().toISOString()
    };
  }

  async function log(type, message, meta = {}) {
    const entry = record(type, message, meta);
    if (isDurable(type)) {
      await store.create(CONTAINER, entry);
      logger.info(`[audit] ${type}: ${message}`);
      return entry;
    }
    await queue.enqueue(QUEUE_NAME, entry);
    return entry;
  }

  async function drainOnce() {
    const pending = await queue.size(QUEUE_NAME);
    for (let i = 0; i < pending; i += 1) {
      const item = await queue.dequeue(QUEUE_NAME);
      if (!item) break;
      await store.create(CONTAINER, item);
    }
    return pending;
  }

  function startDrainLoop(intervalMs = 2000) {
    const timer = setInterval(() => {
      drainOnce().catch((err) => logger.error('[activity] drain failed', err.message));
    }, intervalMs);
    timer.unref?.();
    return timer;
  }

  async function recent(limit = 50, filter = null) {
    const all = await store.list(CONTAINER);
    const filtered = filter ? all.filter(filter) : all;
    return filtered
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }

  /** Audit trail for one subject, oldest first — the member-detail timeline. */
  async function forSubject(subjectId, limit = 100) {
    const all = await store.list(CONTAINER);
    return all
      .filter((entry) => entry.meta?.memberId === subjectId || entry.meta?.targetId === subjectId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(-limit);
  }

  async function between(fromIso, toIso) {
    const all = await store.list(CONTAINER);
    return all
      .filter((entry) => entry.createdAt >= fromIso && entry.createdAt <= toIso)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  return { log, drainOnce, startDrainLoop, recent, forSubject, between };
}

module.exports = { createActivityService };
