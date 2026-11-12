'use strict';

/**
 * @fileoverview Composition root: platform wiring, the domain service graph,
 * middleware, API routes and the static frontend.
 *
 * A few services genuinely reference each other (profiles <-> search index,
 * entitlements <-> membership, realtime <-> matching/messaging). Rather than
 * resolve those with lazy requires, the cycle is made explicit: a placeholder
 * object is passed at construction and filled once the real service exists.
 * Constructors destructure at build time, so the placeholder must be the same
 * object identity the caller keeps calling into.
 */

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');

const config = require('./config');
const { initPlatform } = require('./services/platform');
const { FileSessionStore } = require('./services/sessionStore');
const { createStore } = require('./services/store');
const { createVersionedCache } = require('./services/cacheVersion');
const { createActivityService } = require('./services/activityService');
const { createEmailService } = require('./services/emailService');
const { createMemberService } = require('./services/memberService');
const { createMediaService } = require('./services/mediaService');
const { createProfileService } = require('./services/profileService');
const { createSearchIndexService } = require('./services/searchIndexService');
const { createNotificationService } = require('./services/notificationService');
const { createModerationService } = require('./services/moderationService');
const { createVerificationService } = require('./services/verificationService');
const { createEntitlementService } = require('./services/entitlementService');
const { createBillingService } = require('./services/billingService');
const { createMembershipService } = require('./services/membershipService');
const { createDiscoveryService } = require('./services/discoveryService');
const { createMatchingService } = require('./services/matchingService');
const { createMessagingService } = require('./services/messagingService');
const { createApplicationService } = require('./services/applicationService');
const { createAdminService } = require('./services/adminService');
const { createAuthService } = require('./services/authService');
const { createRealtime } = require('./realtime');
const { createJobs } = require('./jobs');
const { createAuthMiddleware } = require('./middleware/auth');
const { csrfMiddleware } = require('./middleware/csrf');
const rateLimits = require('./middleware/rateLimits');
const { buildApiRouter } = require('./routes');

function ensureDirectories() {
  for (const dir of [config.dataDir, config.logDir, config.mediaDir, config.cacheDir,
    config.searchDir, config.authDir, path.join(config.rootDir, '.application', 'sessions')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createApp() {
  if (config.isProduction && !config.session.secret) {
    // A generated fallback would silently invalidate every session on restart.
    throw new Error('SESSION_SECRET must be set in production');
  }

  ensureDirectories();
  const app = express();
  app.set('trust proxy', 1);

  const platform = initPlatform(app);
  const { logger, cache, dataService, queue, filing, searching } = platform;

  // ---- middleware that must run before anything reads the session ---------

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  }));
  app.use(compression());

  const sessionStore = new FileSessionStore({
    dir: path.join(config.rootDir, '.application', 'sessions'),
    ttlMs: config.session.maxAgeDays * 864e5
  });

  const sessionMiddleware = session({
    name: 'exclusivity.sid',
    secret: config.session.secret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: config.session.maxAgeDays * 864e5
    }
  });
  app.use(sessionMiddleware);

  /**
   * No API response is cacheable.
   *
   * Express attaches an ETag to JSON by default, so the browser revalidates
   * and can be answered with a 304 — at which point it reuses whatever body it
   * already had. That is wrong for every endpoint here and actively broken for
   * /auth/me: a response cached before sign-in ("member": null) is replayed
   * after sign-in, and the member lands back on the gate holding a valid
   * session. It is also a privacy matter, since it would leave member data in
   * the browser cache after sign-out.
   */
  app.use('/api', (req, res, next) => {
    // The photo route replaces this with a short private max-age of its own.
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Stripe signs the raw body, so the webhook must not be JSON-parsed here.
  app.use('/api', (req, res, next) => {
    if (req.path === '/membership/webhook') return next();
    return express.json({ limit: '1mb' })(req, res, next);
  });
  app.use('/api', csrfMiddleware({ isProduction: config.isProduction }));
  app.use('/api', rateLimits.general);

  // ---- domain service graph ----------------------------------------------

  const store = createStore(dataService, logger);
  const versionedCache = createVersionedCache(cache);
  const activity = createActivityService({ store, queue, logger });
  const email = createEmailService({ logger });

  const members = createMemberService({ store, versionedCache, activity });
  const media = createMediaService({ filing, store, activity, versionedCache });

  // profiles <-> search index
  const searchIndexRef = {
    index: async () => false, remove: async () => false,
    query: async () => null, reindexAll: async () => 0
  };
  const profiles = createProfileService({
    store, media, versionedCache, activity, searchIndex: searchIndexRef
  });
  const searchIndex = createSearchIndexService({ searching, profiles, media, members, logger });
  Object.assign(searchIndexRef, searchIndex);

  // realtime <-> matching / messaging
  const matchingRef = {};
  const messagingRef = {};
  const realtime = createRealtime({
    sessionMiddleware, members, matching: matchingRef, messaging: messagingRef, profiles, logger
  });

  const notifications = createNotificationService({
    store, members, profiles, email, logger, realtime, versionedCache
  });
  const moderation = createModerationService({
    store, members, media, profiles, activity, versionedCache, notifications
  });
  const verification = createVerificationService({
    store, filing, members, activity, versionedCache
  });

  // entitlements <-> membership
  const membershipRef = {};
  const entitlements = createEntitlementService({ store, membership: membershipRef });
  const billing = createBillingService({ store, logger });
  const membership = createMembershipService({
    store, members, billing, notifications, activity, versionedCache
  });
  Object.assign(membershipRef, membership);

  const discovery = createDiscoveryService({
    store, members, profiles, media, moderation, entitlements, versionedCache, searchIndex, logger
  });
  const matching = createMatchingService({
    store, members, discovery, entitlements, moderation, notifications, activity, versionedCache, realtime
  });
  Object.assign(matchingRef, matching);

  const messaging = createMessagingService({
    store, members, matching, moderation, entitlements, profiles, media,
    notifications, activity, versionedCache, realtime
  });
  Object.assign(messagingRef, messaging);

  const applications = createApplicationService({
    store, members, profiles, media, verification, notifications, activity, versionedCache
  });
  const admin = createAdminService({
    store, members, profiles, media, applications, moderation, membership, messaging, activity, versionedCache
  });
  const auth = createAuthService({ auth: platform.auth, members, activity, logger });

  const services = {
    logger, cache, dataService, store, versionedCache, activity, email,
    members, media, profiles, searchIndex, notifications, moderation, verification,
    entitlements, billing, membership, discovery, matching, messaging,
    applications, admin, auth, realtime, sessionStore, platform
  };

  const jobs = createJobs(services);
  services.jobs = jobs;

  const middleware = createAuthMiddleware({ members, entitlements });

  // ---- routes and static frontend ----------------------------------------

  app.use('/api', buildApiRouter(services, middleware));

  app.use(express.static(config.publicDir, {
    setHeaders(res, filePath) {
      // The shell must not be cached or a deploy never reaches the client.
      if (filePath.endsWith('index.html')) res.set('Cache-Control', 'no-cache');
    }
  }));

  // Hash routing: every non-API path serves the shell.
  app.get(/^(?!\/api|\/platform-core|\/rt).*/, (req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  activity.startDrainLoop();

  return { app, services, sessionMiddleware, realtime, jobs, logger };
}

module.exports = { createApp };
