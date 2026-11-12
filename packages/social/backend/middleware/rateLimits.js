'use strict';

/**
 * @fileoverview Per-route-class rate limits.
 *
 * Keyed by member id where there is a session and by IP otherwise, so one
 * member on a shared network cannot exhaust another's budget.
 */

const rateLimit = require('express-rate-limit');

function keyBy(req) {
  return req.session?.memberId || req.ip;
}

function limiter({ windowMs, max, message, code }) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: keyBy,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: message, code: code || 'rate_limited' })
  });
}

const auth = limiter({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Too many attempts — wait a minute and try again',
  code: 'rate_limited_auth'
});

const upload = limiter({
  windowMs: 60 * 60 * 1000,
  max: 40,
  message: 'Too many uploads — try again later',
  code: 'rate_limited_upload'
});

const messaging = limiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "You're sending messages very quickly",
  code: 'rate_limited_messaging'
});

const discovery = limiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Slow down a moment',
  code: 'rate_limited_discovery'
});

/**
 * Read volume is the scraping signal for a pool like this one — a verified,
 * affluent membership is worth harvesting.
 */
const profileReads = limiter({
  windowMs: 60 * 1000,
  max: 90,
  message: 'Slow down a moment',
  code: 'rate_limited_reads'
});

const reports = limiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  message: 'You have filed several reports today',
  code: 'rate_limited_reports'
});

const general = limiter({
  windowMs: 60 * 1000,
  max: 300,
  message: 'Slow down a moment'
});

module.exports = { auth, upload, messaging, discovery, profileReads, reports, general };
