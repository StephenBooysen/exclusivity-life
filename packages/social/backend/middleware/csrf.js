'use strict';

/**
 * @fileoverview Double-submit CSRF protection.
 *
 * A token is minted into the session and echoed in a readable cookie; the
 * client sends it back in a header. An attacker's page can cause the browser
 * to send the cookie but cannot read it to set the header.
 *
 * The socket handshake reuses the session rather than a bearer token, so it
 * needs no separate CSRF path.
 */

const crypto = require('node:crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const COOKIE_NAME = 'exclusivity.csrf';
const HEADER_NAME = 'x-csrf-token';

function csrfMiddleware({ isProduction }) {
  return function csrf(req, res, next) {
    if (!req.session) return next();

    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    }

    // Readable by the app's own JS on purpose — that is the second half of
    // the double submit.
    res.cookie(COOKIE_NAME, req.session.csrfToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure: isProduction,
      path: '/'
    });

    if (SAFE_METHODS.has(req.method)) return next();

    // Stripe signs its webhooks; it cannot send a session CSRF token.
    if (req.path === '/membership/webhook') return next();

    const provided = req.get(HEADER_NAME) || req.body?._csrf;
    const expected = req.session.csrfToken;
    if (!provided || !expected || provided.length !== expected.length
      || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return res.status(403).json({ error: 'Your session expired — refresh and try again', code: 'csrf_failed' });
    }

    return next();
  };
}

module.exports = { csrfMiddleware, COOKIE_NAME, HEADER_NAME };
