'use strict';

/**
 * @fileoverview me-platform-core bootstrap. The only module in the app that
 * requires the framework — every other module receives services by injection,
 * which is what keeps the migration in .docs §25 to a single-file change.
 */

const config = require('../config');

let platform = null;

/**
 * Initializes the me-platform-core service registry once per process and
 * returns the services this app depends on. The registry resolves
 * cross-service dependencies (scheduling -> working, dataservice -> filing,
 * authservice -> dataservice) automatically, so callers only ask for the
 * top-level services they use.
 * @param {import('express').Express} app
 */
function initPlatform(app) {
  if (platform) return platform;

  // me-platform-core's entry point exports an already-constructed
  // ServiceRegistry instance, not a namespace object — there is no
  // `.serviceRegistry` to reach for.
  const serviceRegistry = require('me-platform-core');
  const EventEmitter = require('node:events');
  const eventEmitter = new EventEmitter();
  // Services fan out to every listener on this bus; the default cap of 10
  // trips once a dozen domain services subscribe.
  eventEmitter.setMaxListeners(50);

  serviceRegistry.initialize(app, eventEmitter, {
    baseUrl: '/platform-core',
    name: config.name,
    logDir: config.logDir,
    dataDir: config.dataDir,
    cacheDir: config.cacheDir,
    activitiesFolder: config.activitiesFolder,
    security: {
      // The member API carries its own session auth; the platform's own
      // dashboards are gated separately in production.
      apiKeyAuth: { requireApiKey: false, apiKeys: [] },
      servicesAuth: { requireLogin: config.isProduction }
    }
  });

  const logger = serviceRegistry.logger('file');
  const cache = serviceRegistry.cache();
  const dataService = serviceRegistry.dataService('file');
  const queue = serviceRegistry.queue();
  const scheduler = serviceRegistry.scheduling();
  // The local provider reads `baseDir` (not `basePath`) and resolves every
  // path within it, which is what keeps media off the static route.
  const filing = serviceRegistry.filing('local', {
    baseDir: config.mediaDir,
    maxFileSize: config.media.maxUploadBytes
  });
  const searching = serviceRegistry.searching();
  const measuring = serviceRegistry.measuring();
  const auth = serviceRegistry.authservice('file', { dataDir: config.authDir });

  platform = {
    registry: serviceRegistry,
    eventEmitter,
    logger,
    cache,
    dataService,
    queue,
    scheduler,
    filing,
    searching,
    measuring,
    auth
  };
  return platform;
}

/** Returns the already-initialized platform bundle; throws if called too early. */
function getPlatform() {
  if (!platform) {
    throw new Error('Platform not initialized — call initPlatform(app) first');
  }
  return platform;
}

module.exports = { initPlatform, getPlatform };
