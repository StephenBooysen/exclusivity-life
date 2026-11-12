'use strict';

/**
 * @fileoverview Background jobs.
 *
 * These run in-process rather than through the platform `scheduling` service.
 * That service executes isolated activity scripts in a worker with only a data
 * directory passed in, which suits self-contained tasks; every job here is a
 * domain operation that needs the live service graph (entitlements, media,
 * notifications). Rebuilding that graph inside a worker would duplicate the
 * composition root for no benefit at this scale.
 *
 * Every job is idempotent and restart-safe: none of them assume they ran, and
 * each recomputes from persisted state, so a missed window is caught up rather
 * than skipped.
 */

const config = require('../config');
const { C, decksContainer, allLikeShards, messagesContainer } = require('../services/containers');
const { todayIso } = require('../services/utils');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function createJobs(services) {
  const { logger, store, discovery, matching, membership, applications, admin,
    media, verification, notifications, versionedCache, searchIndex } = services;

  const definitions = [
    {
      name: 'dailyDecks',
      intervalMs: DAY,
      runAtBoot: true,
      description: "Generates every active member's introductions for the day",
      async run() {
        return discovery.generateAll();
      }
    },
    {
      name: 'matchExpiry',
      intervalMs: HOUR,
      description: 'Expires matches with no first message, sends reminders, repairs conversations',
      async run() {
        return matching.sweepExpiries();
      }
    },
    {
      name: 'subscriptionSweep',
      intervalMs: HOUR,
      description: 'Advances past_due through grace to dormant',
      async run() {
        return membership.sweep();
      }
    },
    {
      name: 'reviewSla',
      intervalMs: 15 * MINUTE,
      description: 'Alerts on applications approaching the review SLA',
      async run() {
        const breaches = await applications.slaBreaches();
        if (breaches.length) {
          logger.warn(`[sla] ${breaches.length} application(s) within 6h of the ${config.review.slaHours}h SLA`);
        }
        return { atRisk: breaches.length };
      }
    },
    {
      name: 'retentionSweep',
      intervalMs: DAY,
      description: 'Applies the retention windows in .docs §9',
      async run() {
        return retentionSweep();
      }
    },
    {
      name: 'metricsSnapshot',
      intervalMs: HOUR,
      description: 'Captures funnel, ratio and safety metrics for the ops dashboard',
      async run() {
        await admin.snapshot();
        const ratio = await admin.ratios();
        if (ratio.alarm) {
          logger.warn(`[ops] gender ratio ${ratio.ratio} in ${ratio.city} — ${ratio.recommendation}`);
        }
        return ratio;
      }
    }
  ];

  /** Applies every retention window. Deletion here is real, not a flag. */
  async function retentionSweep() {
    const now = Date.now();
    const result = { liveness: 0, notifications: 0, decks: 0, messages: 0, allowances: 0, orphanMedia: 0 };

    // Liveness selfies: the fact of the check outlives the biometric artefact.
    const livenessRecords = await store.findAll(
      C.VERIFICATIONS,
      (v) => v.type === 'liveness' && !v.purgedAt
    );
    for (const record of livenessRecords) {
      const age = (now - new Date(record.capturedAt)) / DAY;
      if (age > config.retention.livenessDays) {
        await verification.purgeLiveness(record);
        result.liveness += 1;
      }
    }

    const notificationRecords = await store.list(C.NOTIFICATIONS);
    for (const record of notificationRecords) {
      if ((now - new Date(record.createdAt)) / DAY > config.retention.notificationDays) {
        await store.remove(C.NOTIFICATIONS, record.id);
        result.notifications += 1;
      }
    }

    // Decks older than the window; the container is emptied record by record
    // because the file provider has no drop-container operation.
    for (let i = config.retention.deckDays; i < config.retention.deckDays + 14; i += 1) {
      const date = todayIso(config.timezone, new Date(now - i * DAY));
      const records = await store.list(decksContainer(date));
      for (const record of records) {
        await store.remove(decksContainer(date), record.id);
        result.decks += 1;
      }
    }

    const allowances = await store.list(C.ALLOWANCES);
    const cutoff = todayIso(config.timezone, new Date(now - 14 * DAY));
    for (const record of allowances) {
      if (record.date < cutoff) {
        await store.remove(C.ALLOWANCES, record.id);
        result.allowances += 1;
      }
    }

    // Messages from long-closed matches, unless a report still references them.
    const closed = await store.findAll(
      C.MATCHES,
      (m) => ['unmatched', 'expired'].includes(m.state)
    );
    const openReports = await store.findAll(C.REPORTS, (r) => r.state === 'open');
    const protectedMatches = new Set(openReports.map((r) => r.matchId).filter(Boolean));
    for (const match of closed) {
      const closedAt = match.unmatchedAt || match.expiredAt;
      if (!closedAt) continue;
      if (protectedMatches.has(match.id)) continue;
      if ((now - new Date(closedAt)) / DAY <= config.retention.unmatchedMessagesDays) continue;
      const container = messagesContainer(match.id);
      const messages = await store.list(container);
      for (const message of messages) {
        await store.remove(container, message.id);
        result.messages += 1;
      }
    }

    // Photo binaries whose metadata was deleted.
    const deletedPhotos = await store.findAll(C.PHOTOS, (p) => p.deletedAt);
    for (const photo of deletedPhotos) {
      const age = (now - new Date(photo.deletedAt)) / DAY;
      if (age > 30) {
        await media.destroyBinaries(photo);
        await store.remove(C.PHOTOS, photo.id);
        result.orphanMedia += 1;
      }
    }

    logger.info(`[retention] ${JSON.stringify(result)}`);
    return result;
  }

  const state = new Map();
  const timers = [];

  async function runJob(definition) {
    const started = Date.now();
    try {
      const result = await definition.run();
      state.set(definition.name, {
        name: definition.name,
        lastRunAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        ok: true,
        result
      });
      logger.info(`[jobs] ${definition.name} ok (${Date.now() - started}ms)`);
      return result;
    } catch (err) {
      state.set(definition.name, {
        name: definition.name,
        lastRunAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        ok: false,
        error: err.message
      });
      logger.error(`[jobs] ${definition.name} failed: ${err.message}`);
      throw err;
    }
  }

  function start() {
    for (const definition of definitions) {
      const timer = setInterval(() => {
        runJob(definition).catch(() => {});
      }, definition.intervalMs);
      timer.unref?.();
      timers.push(timer);
      state.set(definition.name, { name: definition.name, lastRunAt: null, ok: null });
    }

    // Boot-time catch-up, staggered so a cold start does not do everything at
    // once while the first request is being served.
    setTimeout(() => {
      Promise.resolve()
        .then(() => searchIndex.reindexAll())
        .then((indexed) => logger.info(`[search] indexed ${indexed} profiles`))
        .then(() => runJob(definitions.find((d) => d.name === 'matchExpiry')))
        .then(() => runJob(definitions.find((d) => d.name === 'subscriptionSweep')))
        .then(() => runJob(definitions.find((d) => d.name === 'dailyDecks')))
        .catch(() => {});
    }, 3000).unref?.();

    logger.info(`[jobs] ${definitions.length} background jobs registered`);
  }

  function stop() {
    for (const timer of timers) clearInterval(timer);
  }

  async function runNow(name) {
    const definition = definitions.find((d) => d.name === name);
    if (!definition) throw new Error(`Unknown job: ${name}`);
    return runJob(definition);
  }

  function status() {
    return definitions.map((definition) => ({
      name: definition.name,
      description: definition.description,
      intervalMs: definition.intervalMs,
      ...(state.get(definition.name) || {})
    }));
  }

  return { start, stop, runNow, status, definitions };
}

module.exports = { createJobs };
