'use strict';

/**
 * @fileoverview Pattern scanning for profiles and first messages.
 *
 * Pure functions — no I/O, no clock. The pattern sets are data so they can be
 * tuned from the admin console without a deploy.
 *
 * Findings route to human review; they never auto-block. A false positive that
 * silently swallows a message is worse than one a moderator dismisses in a
 * second, and the whole point of a curated platform is that a human is
 * already in the loop.
 */

/**
 * Transactional solicitation. This is the category that decides whether the
 * platform stays a dating product or becomes something its payment processor
 * and app stores will not carry — see .docs §2.
 */
const SOLICITATION = [
  /\ballowance[sd]?\b/i,
  /\bsugar\s*(daddy|baby|momma|mummy)\b/i,
  // The pronoun is optional: "pay per date" and "pay you per date" are the
  // same offer, and the second is the way it is actually written.
  /\bpay(ing|ment|s)?\s+(you|her|him|u)?\s*(per|for|each)\s+(date|meet\w*|hour|night|visit|time)\b/i,
  /\bppm\b/i,
  /\bgenerous\s+(gentleman|man|men|offer)\b/i,
  /\btribute[sd]?\b/i,
  /\bspoil(ed|ing)?\s+(me|you)\b/i,
  /\b(rate|price)s?\s+(per|for)\s+(hour|night|date)\b/i,
  /\bescort(s|ing)?\b/i,
  /\bcash\s*app|onlyfans|only\s*fans\b/i,
  /\bfinancial\s+(support|arrangement|assistance)\b/i,
  /\bmutually\s+beneficial\s+arrangement\b/i
];

/** Moving the conversation off-platform before a match has any history. */
const EXTERNAL_CONTACT = [
  /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/,
  /\b(?:\+?\d[\s-]?){9,14}\b/,
  /\b(whats\s*app|whatsapp|telegram|signal|snap(chat)?|insta(gram)?|wechat|kik)\b/i,
  /\b(dm|message)\s+me\s+on\b/i,
  /(https?:\/\/|www\.)\S+/i
];

/** Money movement — the strongest single signal of a romance scam. */
const FINANCIAL = [
  /\b(bitcoin|btc|crypto|ethereum|usdt|binance)\b/i,
  /\b(wire|western\s*union|money\s*gram|bank\s+transfer|eft)\b/i,
  /\b(invest(ment|ing)?\s+opportunity|trading\s+(platform|signals))\b/i,
  /\b(gift\s*card|steam\s*card|itunes\s*card)\b/i,
  /\b(send|transfer|lend)\s+(me\s+)?(some\s+)?(money|cash|funds|R\d)/i
];

const ABUSE = [
  /\b(slut|whore|bitch|cunt)\b/i,
  /\bkill\s+your\s*self\b/i,
  /\bi\s+will\s+(find|hurt|kill)\s+you\b/i
];

const CATEGORIES = [
  { name: 'solicitation', patterns: SOLICITATION, severity: 'high' },
  { name: 'external_contact', patterns: EXTERNAL_CONTACT, severity: 'low' },
  { name: 'financial', patterns: FINANCIAL, severity: 'high' },
  { name: 'abuse', patterns: ABUSE, severity: 'high' }
];

/**
 * @param {string} text
 * @param {{categories?: string[]}} options restrict to a subset of categories
 * @return {{flags: string[], severity: string|null, matched: Array}}
 */
function scan(text, { categories = null } = {}) {
  const value = String(text || '');
  const flags = [];
  const matched = [];

  for (const category of CATEGORIES) {
    if (categories && !categories.includes(category.name)) continue;
    for (const pattern of category.patterns) {
      const hit = value.match(pattern);
      if (hit) {
        flags.push(category.name);
        matched.push({ category: category.name, severity: category.severity, excerpt: hit[0].slice(0, 60) });
        break;
      }
    }
  }

  const severity = matched.some((m) => m.severity === 'high') ? 'high'
    : matched.length ? 'low' : null;

  return { flags: [...new Set(flags)], severity, matched };
}

/**
 * A first message is judged more harshly than a later one: asking for a phone
 * number in message one is a pattern, in message twenty it is a date.
 */
function scanFirstMessage(text) {
  return scan(text, { categories: ['solicitation', 'external_contact', 'financial', 'abuse'] });
}

/** Profiles never have a legitimate reason to carry contact details. */
function scanProfile(text) {
  return scan(text);
}

/** Later messages: only the categories that stay wrong at any point. */
function scanMessage(text) {
  return scan(text, { categories: ['solicitation', 'financial', 'abuse'] });
}

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'throwaway.email', 'yopmail.com', 'trashmail.com', 'sharklasers.com',
  'getnada.com', 'temp-mail.org', 'fakeinbox.com', 'maildrop.cc'
]);

function isDisposableEmail(email) {
  const domain = String(email || '').split('@')[1]?.toLowerCase();
  return Boolean(domain && DISPOSABLE_EMAIL_DOMAINS.has(domain));
}

module.exports = {
  scan, scanFirstMessage, scanProfile, scanMessage,
  isDisposableEmail, CATEGORIES, DISPOSABLE_EMAIL_DOMAINS
};
